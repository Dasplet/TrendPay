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

// ── Configuración de consignaciones por transferencia (Transfer In) ──
// GET /transfer/v1/config?paymentType=PAYMENT (Beta). Dice qué procesadores tiene habilitados el comercio:
// PSE (tradicional, sin canales) y Bre-B (APM, canal "QR"). Es de solo lectura y usa la llave pública.
export interface ProcesadorTransferencia {
  name: string;
  currency: string;
  tipo: 'pse' | 'bre-b' | 'apm' | 'tradicional';
  canales: string[];
}

export interface ConfigTransferencias {
  procesadores: ProcesadorTransferencia[];
  respuesta: unknown;
}

function canalesDeFlujos(flujos: unknown): string[] {
  if (!Array.isArray(flujos)) return [];
  const canales = new Set<string>();
  for (const f of flujos as { channels?: unknown }[]) {
    if (Array.isArray(f?.channels)) for (const c of f.channels) if (typeof c === 'string') canales.add(c);
  }
  return [...canales];
}

function tipoDeProcesador(nombre: string, flujos: unknown): ProcesadorTransferencia['tipo'] {
  const n = nombre.toLowerCase();
  if (n.includes('pse')) return 'pse';
  if (n.includes('bre')) return 'bre-b';
  return Array.isArray(flujos) && flujos.length > 0 ? 'apm' : 'tradicional';
}

export async function getConfigTransferencias(): Promise<ConfigTransferencias> {
  try {
    const { data } = await axios.get(`${BASE_URL}/transfer/v1/config`, {
      params: { paymentType: 'PAYMENT' },
      headers: { 'Public-Merchant-Id': PUBLIC_MERCHANT_ID },
    });
    const lista: { name?: unknown; currency?: unknown; supportedFlows?: unknown }[] = Array.isArray(data?.processors) ? data.processors : [];
    const procesadores = lista
      .filter((p) => typeof p?.name === 'string')
      .map((p) => ({
        name: p.name as string,
        currency: typeof p.currency === 'string' ? p.currency : '',
        tipo: tipoDeProcesador(p.name as string, p.supportedFlows),
        canales: canalesDeFlujos(p.supportedFlows),
      }));
    return { procesadores, respuesta: data };
  } catch (err: any) {
    const kushkiMessage = err.response?.data?.message;
    throw new KushkiError(kushkiMessage || err.message || 'Error comunicando con Kushki', err.response?.status || 502, { respuesta: err.response?.data });
  }
}

// Bre-B (Colombia, QR en tiempo real). Se pide el token desde el backend (Kushki.js todavía no soporta
// "processor"). El nombre del procesador y el canal NO se escriben a mano: se copian de lo que devuelve
// /transfer/v1/config, como exige Kushki. Pedir el token no cobra nada; el token caduca a los 30 minutos y
// sirve para una sola transacción.
export interface TokenBreB {
  token: string | null;
  procesador: { name: string; channel: string };
  respuesta: unknown;
}

export async function solicitarTokenBreB(montoCop: number): Promise<TokenBreB> {
  const config = await getConfigTransferencias();
  const breb = config.procesadores.find((p) => p.tipo === 'bre-b' && p.canales.includes('QR'));
  if (!breb) {
    throw new KushkiError('Tu comercio no tiene Bre-B (canal QR) habilitado en Kushki; pídele a tu ejecutivo que lo active', 422, { respuesta: { etapa: 'config', procesadores: config.procesadores } });
  }
  const procesador = { name: breb.name, channel: 'QR' };
  try {
    const { data } = await axios.post(
      `${BASE_URL}/transfer/v1/tokens`,
      { amount: { subtotalIva: 0, subtotalIva0: montoCop, iva: 0 }, currency: 'COP', processor: procesador },
      { headers: { 'Public-Merchant-Id': PUBLIC_MERCHANT_ID, 'Content-Type': 'application/json' } },
    );
    return { token: typeof data?.token === 'string' ? data.token : null, procesador, respuesta: data };
  } catch (err: any) {
    throw errorDeKushki(err, 'token-bre-b');
  }
}

// Abre el pago Bre-B: pide el token y lo confirma en /transfer/v1/init. A diferencia de PSE no hay redirección
// al banco: Kushki devuelve el QR (PNG en base64 como data URI) que el cliente escanea con su app bancaria.
// El QR vence a los 10 minutos; pasado ese tiempo hay que pedir otro token y repetir. El estado final se
// consulta con getTransferStatus (el mismo de PSE) y se acredita igual que PSE.
export interface PagoBreB {
  token: string;
  qr: string;
  ticketNumber?: string;
  transactionReference?: string;
}

const QR_VALIDO = /^data:image\/(png|jpeg);base64,[A-Za-z0-9+/=]+$/;

export async function iniciarPagoBreB(montoCop: number): Promise<PagoBreB> {
  const t = await solicitarTokenBreB(montoCop);
  if (!t.token) throw new KushkiError('Kushki no entregó el token de Bre-B', 502, { respuesta: { etapa: 'token-bre-b', data: t.respuesta } });
  try {
    const { data } = await axios.post(
      `${BASE_URL}/transfer/v1/init`,
      { token: t.token, amount: { subtotalIva: 0, subtotalIva0: montoCop, iva: 0 } },
      { headers: { 'Private-Merchant-Id': PRIVATE_MERCHANT_ID, 'Content-Type': 'application/json' } },
    );
    // Solo se acepta una imagen en data URI: el valor termina en el atributo src del navegador del cliente
    if (typeof data?.qr !== 'string' || !QR_VALIDO.test(data.qr)) {
      throw new KushkiError('Kushki no devolvió el código QR', 502, { respuesta: { etapa: 'init-bre-b', httpStatus: 201, campos: Object.keys(data ?? {}) } });
    }
    return { token: t.token, qr: data.qr, ticketNumber: data.ticketNumber, transactionReference: data.transactionReference };
  } catch (err: any) {
    if (err instanceof KushkiError) throw err;
    throw errorDeKushki(err, 'init-bre-b');
  }
}

// Anula un QR Bre-B antes de que llegue a un estado final (PATCH /transfer/v1/cancel/{token}, Private-Merchant-Id).
// 204 sin cuerpo = cancelado y el QR queda inválido. Si la transacción ya terminó Kushki responde 400 T023: en
// ese caso devuelve false (no se pudo cancelar porque ya se resolvió) y quien llama debe consultar el estado real.
export async function cancelarPagoBreB(token: string): Promise<boolean> {
  try {
    await axios.patch(`${BASE_URL}/transfer/v1/cancel/${encodeURIComponent(token)}`, undefined, {
      headers: { 'Private-Merchant-Id': PRIVATE_MERCHANT_ID },
    });
    return true;
  } catch (err: any) {
    if (err.response?.status === 400 && err.response?.data?.code === 'T023') return false;
    throw errorDeKushki(err, 'cancel-bre-b');
  }
}

// ¿Tiene el comercio Bre-B (QR) activo? Se consulta a Kushki y se recuerda 5 minutos. Si Kushki no responde
// se considera apagado (la opción simplemente no se muestra), sin guardar ese resultado.
let cacheBreB: { hasta: number; activo: boolean } | null = null;

export async function brebHabilitado(): Promise<boolean> {
  if (cacheBreB && cacheBreB.hasta > Date.now()) return cacheBreB.activo;
  try {
    const { procesadores } = await getConfigTransferencias();
    const activo = procesadores.some((p) => p.tipo === 'bre-b' && p.canales.includes('QR'));
    cacheBreB = { hasta: Date.now() + 5 * 60_000, activo };
    return activo;
  } catch {
    return false;
  }
}

export function olvidarCacheBreB(): void {
  cacheBreB = null;
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
// Webhook por API: Kushki permite indicar en el init la URL a la que avisar cuando la dispersión se aprueba o
// se rechaza (se suma al que haya registrado la consola). Es opcional y solo se envía si KUSHKI_WEBHOOK_URL
// existe, así un sandbox que no lo acepte no afecta los retiros: basta con quitar la variable.
export const EVENTOS_WEBHOOK_DISPERSION = ['approvedTransaction', 'declinedTransaction'];

export function webhooksDeInit(): { webhooks?: { events: string[]; urls: string[] }[] } {
  const url = process.env.KUSHKI_WEBHOOK_URL?.trim().replace(/^["']|["']$/g, '');
  if (!url) return {};
  if (!/^https?:\/\//i.test(url)) return {};
  return { webhooks: [{ events: EVENTOS_WEBHOOK_DISPERSION, urls: [url] }] };
}

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
      { token: tk.token, amount: { subtotalIva: 0, subtotalIva0: datos.monto, iva: 0 }, ...webhooksDeInit() },
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
