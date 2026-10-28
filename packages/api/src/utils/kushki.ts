import axios from 'axios';

const BASE_URL            = process.env.KUSHKI_BASE_URL || 'https://api-uat.kushkipagos.com';
const PRIVATE_MERCHANT_ID = process.env.KUSHKI_PRIVATE_MERCHANT_ID || '';
const PUBLIC_MERCHANT_ID  = process.env.KUSHKI_PUBLIC_MERCHANT_ID || '';

export class KushkiError extends Error {
  status: number;
  codigo?: string;
  respuesta?: unknown;
  constructor(mensaje: string, status = 502, extra: { codigo?: string; respuesta?: unknown } = {}) {
    super(mensaje);
    this.status = status;
    this.codigo = extra.codigo;
    this.respuesta = extra.respuesta;
  }
}

// Mensaje en español para mostrar según la respuesta de Kushki. El texto
// original queda guardado en las respuestas del retiro para soporte.
export function mensajeKushki(err: KushkiError): string {
  if (err.codigo === 'PT001') return 'Kushki rechazó los datos de la cuenta destino (banco, tipo, número o documento)';
  if (err.status === 401 || err.status === 403) return 'Las credenciales de Kushki no son válidas o no tienen dispersión habilitada';
  if (err.status === 422) return err.message;
  if (err.status >= 500) return 'Kushki no respondió; no se pudo confirmar el envío';
  return 'Kushki no pudo procesar el envío';
}

export interface KushkiChargeResult {
  ticketNumber: string;
  transactionReference: string;
}

export interface KushkiTransferInitResult {
  redirectUrl: string;
  transactionReference: string;
}

export interface KushkiTransferContact {
  fullName: string;
  email: string;
  phoneNumber?: string;
}

// Cobra un token de tarjeta generado en el navegador con Kushki.js
// (kushki.requestToken) — el número de tarjeta nunca toca nuestro servidor,
// solo recibimos el token de un solo uso. Confirmado contra el sandbox UAT:
// éxito = 2xx con { ticketNumber, transactionReference }; rechazo/error =
// 4xx con { code, message }.
export async function chargeCardToken(token: string, montoCop: number): Promise<KushkiChargeResult> {
  try {
    const { data } = await axios.post(
      `${BASE_URL}/v1/charges`,
      {
        token,
        amount: { subtotalIva: 0, subtotalIva0: montoCop, iva: 0, currency: 'COP' },
      },
      { headers: { 'Private-Merchant-Id': PRIVATE_MERCHANT_ID, 'Content-Type': 'application/json' } }
    );
    return { ticketNumber: data.ticketNumber, transactionReference: data.transactionReference };
  } catch (err: any) {
    const kushkiMessage = err.response?.data?.message;
    throw new KushkiError(kushkiMessage || err.message || 'Error comunicando con Kushki', err.response?.status || 502);
  }
}

// Confirma un token de transferencia PSE generado en el navegador (kushki.
// requestTransferToken) e inicia la transacción — a diferencia de la
// tarjeta, esto no cobra nada todavía: devuelve una redirectUrl a la que hay
// que mandar al usuario para que autorice el débito en su banco. El endpoint
// /transfer/v1/init no está en el spec no oficial ni en el SDK cliente (solo
// /transfer/v1/tokens lo está); se confirmó contra el sandbox UAT siguiendo
// la doc oficial de Kushki para "Receive Wire Transfers".
export async function initTransfer(token: string, montoCop: number, contact: KushkiTransferContact): Promise<KushkiTransferInitResult> {
  try {
    const { data } = await axios.post(
      `${BASE_URL}/transfer/v1/init`,
      {
        token,
        amount: { subtotalIva: 0, subtotalIva0: montoCop, iva: 0 },
        contactDetails: { fullName: contact.fullName, email: contact.email, phoneNumber: contact.phoneNumber },
      },
      { headers: { 'Private-Merchant-Id': PRIVATE_MERCHANT_ID, 'Content-Type': 'application/json' } }
    );
    return { redirectUrl: data.redirectUrl, transactionReference: data.transactionReference };
  } catch (err: any) {
    const kushkiMessage = err.response?.data?.message;
    throw new KushkiError(kushkiMessage || err.message || 'Error comunicando con Kushki', err.response?.status || 502);
  }
}

export type KushkiTransferState = 'aprobada' | 'pendiente' | 'rechazada';

export interface KushkiTransferStatus {
  estado: KushkiTransferState;
  ticketNumber?: string;
}

// El código de estado real que Kushki devuelve para PSE aprobado no está
// documentado con un valor exacto — solo "PENDING" fue observado en vivo en
// sandbox (la transacción de prueba tarda ~10 min en resolverse, según la
// propia doc de Kushki). Por seguridad, solo se acredita saldo si el estado
// coincide claramente con uno de estos indicadores de aprobación; cualquier
// valor no reconocido se trata como pendiente, nunca como aprobado.
const ESTADOS_APROBADOS = ['OK', 'APPROVED', 'AUTHORIZED', 'SUCCESS', 'APROBAD'];
const ESTADOS_RECHAZADOS = ['NOT_AUTHORIZED', 'DECLINED', 'FAILED', 'REJECTED', 'RECHAZAD', 'FALLID', 'EXPIRED', 'CANCELLED'];

export async function getTransferStatus(token: string): Promise<KushkiTransferStatus> {
  try {
    const { data } = await axios.get(`${BASE_URL}/transfer/v1/status/${token}`, {
      headers: { 'Private-Merchant-Id': PRIVATE_MERCHANT_ID },
    });
    const raw = String(data.processorState || data.status || '').toUpperCase();
    let estado: KushkiTransferState = 'pendiente';
    if (ESTADOS_APROBADOS.some((s) => raw.includes(s))) estado = 'aprobada';
    else if (ESTADOS_RECHAZADOS.some((s) => raw.includes(s))) estado = 'rechazada';
    return { estado, ticketNumber: data.ticketNumber };
  } catch (err: any) {
    const kushkiMessage = err.response?.data?.message;
    throw new KushkiError(kushkiMessage || err.message || 'Error comunicando con Kushki', err.response?.status || 502);
  }
}

// ── Dispersión (retiros a cuenta bancaria vía ACH) ──
// Endpoints confirmados contra el sandbox UAT. A diferencia de los pagos
// entrantes, el token de dispersión lleva los datos de la cuenta destino y se
// crea con la llave pública; el init y la consulta usan la privada.

export function dispersionHabilitada(): boolean {
  const activa = (process.env.KUSHKI_PAYOUTS_ENABLED ?? '').trim().replace(/^["']|["']$/g, '').toLowerCase() === 'true';
  return activa && !!PRIVATE_MERCHANT_ID && !!PUBLIC_MERCHANT_ID;
}

interface BancoKushki {
  code: string;
  name: string;
}

// Los nombres de nuestros bancos (seed) no coinciden con los de Kushki, así que
// cada uno se busca por un fragmento distintivo del nombre normalizado.
const FRAGMENTOS_BANCO: Array<[string, string]> = [
  ['bancolombia', 'bancolombia'],
  ['nequi', 'nequi'],
  ['bbva', 'bbva'],
  ['bogota', 'bogota'],
  ['davi', 'davivienda'],
  ['falabella', 'falabella'],
  ['occidente', 'occidente'],
  ['popular', 'popular'],
  ['av villas', 'av villas'],
  ['itau', 'itau'],
];

const normalizar = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim();

let cacheBancos: { lista: BancoKushki[]; hasta: number } | null = null;

async function listarBancosDispersion(): Promise<BancoKushki[]> {
  if (cacheBancos && cacheBancos.hasta > Date.now()) return cacheBancos.lista;
  const { data } = await axios.get<BancoKushki[]>(`${BASE_URL}/payouts/transfer/v1/bankList`, {
    headers: { 'Public-Merchant-Id': PUBLIC_MERCHANT_ID },
  });
  cacheBancos = { lista: data, hasta: Date.now() + 6 * 3_600_000 };
  return data;
}

export async function codigoBancoKushki(bancoNombre: string): Promise<string | null> {
  const nombre = normalizar(bancoNombre);
  const fragmento = FRAGMENTOS_BANCO.find(([clave]) => nombre.includes(clave))?.[1];
  if (!fragmento) return null;
  const lista = await listarBancosDispersion();
  return lista.find((b) => normalizar(b.name).includes(fragmento))?.code ?? null;
}

export interface DatosDispersion {
  bancoNombre: string;
  tipoCuenta: string;
  numeroCuenta: string;
  cedulaTitular: string;
  monto: number;
}

export interface KushkiPayoutResult {
  ticketNumber: string;
  transactionReference: string;
  respuestas: Record<string, unknown>;
}

function errorDeKushki(err: any, etapa: string): KushkiError {
  const data = err.response?.data;
  return new KushkiError(data?.message || err.message || 'Error comunicando con Kushki', err.response?.status || 502, {
    codigo: data?.code,
    respuesta: { etapa, httpStatus: err.response?.status ?? null, data: data ?? err.message },
  });
}

// Crea el token con la cuenta destino y lo confirma. Si lanza, no se envió
// dinero: el error ocurrió antes de que Kushki aceptara la dispersión.
export async function iniciarDispersion(datos: DatosDispersion): Promise<KushkiPayoutResult> {
  let bankId: string | null;
  try {
    bankId = await codigoBancoKushki(datos.bancoNombre);
  } catch (err: any) {
    throw errorDeKushki(err, 'bankList');
  }
  if (!bankId) {
    throw new KushkiError(`Kushki no soporta dispersiones al banco "${datos.bancoNombre}"`, 422, { respuesta: { etapa: 'bankList', banco: datos.bancoNombre } });
  }

  // El número de cuenta y la cédula no se guardan en las respuestas: ya viven cifrados en el retiro.
  let tk: any;
  try {
    ({ data: tk } = await axios.post(
      `${BASE_URL}/payouts/transfer/v1/tokens`,
      {
        documentType: 'CC',
        documentNumber: datos.cedulaTitular,
        accountType: normalizar(datos.tipoCuenta).startsWith('corriente') ? 'CC' : 'CA',
        accountNumber: datos.numeroCuenta,
        bankId,
        totalAmount: datos.monto,
        currency: 'COP',
      },
      { headers: { 'Public-Merchant-Id': PUBLIC_MERCHANT_ID, 'Content-Type': 'application/json' } }
    ));
  } catch (err: any) {
    throw errorDeKushki(err, 'tokens');
  }

  try {
    const { data } = await axios.post(
      `${BASE_URL}/payouts/transfer/v1/init`,
      { token: tk.token, amount: { subtotalIva: 0, subtotalIva0: datos.monto, iva: 0 } },
      { headers: { 'Private-Merchant-Id': PRIVATE_MERCHANT_ID, 'Content-Type': 'application/json' } }
    );
    return {
      ticketNumber: data.ticketNumber,
      transactionReference: data.transactionReference,
      respuestas: { tokens: { recibido: !!tk.token, bankId }, init: data },
    };
  } catch (err: any) {
    throw errorDeKushki(err, 'init');
  }
}

// Valores observados en sandbox: APPROVAL y DECLINED. Cualquier otro valor se
// trata como pendiente: nunca se da por pagado ni se devuelve el saldo sin una
// respuesta clara de Kushki.
export interface KushkiPayoutDetalle {
  estadoKushki: string;
  estado: KushkiTransferState;
  responseCode: string;
  responseText: string;
  creado?: string;
  respuesta?: unknown;
}

export async function getPayoutDetalle(ticketNumber: string): Promise<KushkiPayoutDetalle> {
  try {
    const { data } = await axios.get(`${BASE_URL}/payouts/transfer/v1/transaction/${ticketNumber}`, {
      headers: { 'Private-Merchant-Id': PRIVATE_MERCHANT_ID },
    });
    const raw = String(data.transactionStatus || data.status || '').toUpperCase();
    let estado: KushkiTransferState = 'pendiente';
    if (raw.includes('APPROVAL') || raw === 'APPROVED') estado = 'aprobada';
    else if (['DECLINED', 'REJECTED', 'FAILED'].some((s) => raw.includes(s))) estado = 'rechazada';
    return {
      estadoKushki: raw,
      estado,
      responseCode: data.responseCode || '',
      responseText: data.responseText || '',
      creado: data.created ? new Date(data.created).toISOString() : undefined,
      respuesta: data,
    };
  } catch (err: any) {
    throw errorDeKushki(err, 'transaction');
  }
}
