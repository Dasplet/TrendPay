import axios from 'axios';
import { prisma } from '../index';
import { KushkiError } from './kushki';
import { prepararSolicitud } from './kushkiOneAuth';
import { decrypt } from './security';

// Cliente de Kushki One (datáfonos Sunmi) por la nube de Kushki: TrendPay le manda al terminal, por su número de serie,
// la orden de cobro; el resultado llega después por webhook (ver utils/datafonos.ts). Está en Beta en Colombia.

export function baseUrlKushkiOne(): string {
  return (process.env.KUSHKI_ONE_BASE_URL || 'https://cloudt.kushkipagos.com').replace(/\/+$/, '');
}

// Business-Code de la empresa (el Private Merchant ID de su Branch de card present), guardado cifrado por el administrador.
// Cada empresa tiene el suyo: null = esa empresa todavía no tiene Kushki One configurado.
export async function businessCodeDeTitular(titularId: string): Promise<string | null> {
  const c = await prisma.comercioKushkiOne.findUnique({ where: { userId: titularId } });
  if (!c?.activo) return null;
  const codigo = decrypt(c.businessCodeCif);
  return codigo === '****' ? null : codigo; // no se pudo descifrar (llave de cifrado distinta)
}

// El código con el que se firma un mensaje a un terminal: el de la empresa a la que pertenece
async function businessCodeDeTerminal(serial: string): Promise<string> {
  const t = await prisma.terminalKushki.findUnique({ where: { serial }, select: { titularId: true } });
  const codigo = t ? await businessCodeDeTitular(t.titularId) : null;
  if (!codigo) throw new KushkiError('Esta empresa todavía no tiene el Business-Code de Kushki One configurado', 503);
  return codigo;
}

// Los pagos responden SIEMPRE 200: hay que leer el cuerpo. Los errores vienen planos: { type, code, param, message }
function errorDeCuerpo(data: any): KushkiError | null {
  if (data && typeof data === 'object' && data.code && !data.status && (data.type || data.message)) {
    return new KushkiError(String(data.message || 'Kushki One rechazó la solicitud'), 409, { codigo: String(data.code), respuesta: data });
  }
  return null;
}

async function llamar(serial: string, ruta: string, payload: unknown, opciones: { timeoutMs?: number } = {}): Promise<any> {
  const { headers, body } = prepararSolicitud(serial, payload, await businessCodeDeTerminal(serial));
  let respuesta;
  try {
    // El relay de la nube suma latencia a lo que tarda el terminal: Kushki recomienda 90 s como mínimo
    respuesta = await axios.post(`${baseUrlKushkiOne()}/terminal/v1/${encodeURIComponent(serial)}/${ruta}`, body, {
      headers: { 'Content-Type': 'application/json', ...headers },
      timeout: opciones.timeoutMs ?? 95_000,
    });
  } catch (err: any) {
    const data = err.response?.data;
    throw new KushkiError(data?.message || err.message || 'No se pudo hablar con Kushki One', err.response?.status ?? 502, {
      codigo: data?.code, respuesta: data,
    });
  }
  const error = errorDeCuerpo(respuesta.data);
  if (error) throw error;
  return respuesta.data;
}

export interface InfoTerminal { modelo: string | null; version: string | null; serial: string | null }

// Pregunta al terminal por sus datos (modelo, versión de la aplicación y serial) sin mover dinero. Sirve para comprobar que
// Kushki alcanza al aparato, que el Business-Code es el correcto y que el serial existe.
export async function infoTerminal(serial: string): Promise<InfoTerminal> {
  const datos = await llamar(serial, 'sync/config/terminal_info', {}, { timeoutMs: 40_000 });
  return { modelo: datos?.model ?? null, version: datos?.room ?? null, serial: datos?.serialNumber ?? null };
}

export interface OrdenCobro {
  monto: number;               // pesos enteros (COP no lleva decimales: nunca multiplicar por 100)
  clientTransactionId: string; // UUID que une todos los avisos de Kushki con este cobro
  eventsWebhookUrl: string;
  referencia: string;
}

// Envía el cobro al terminal. La respuesta (TERMINAL_ACKNOWLEDGED) solo confirma que el terminal recibió la orden:
// el resultado real llega por el webhook y se confirma con buscarTransaccion().
export async function enviarCobroAsync(serial: string, orden: OrdenCobro): Promise<void> {
  const datos = await llamar(serial, 'async/charge', {
    events_webhook_url: orden.eventsWebhookUrl,
    amount: { subtotal_iva0: orden.monto, subtotal_iva: 0, iva: 0, tip: 0 },
    client_transaction_id: orden.clientTransactionId,
    cashback_amount: 0,
    metadata: { reference: orden.referencia, device: 'TrendPay' },
  });
  if (datos?.status !== 'TERMINAL_ACKNOWLEDGED') {
    throw new KushkiError('El datáfono no aceptó el cobro', 502, { respuesta: datos });
  }
}

export interface OrdenReembolso {
  monto: number;                // el monto de la venta original, en pesos enteros (la anulación es total)
  transactionReference: string; // la referencia de la venta original (raw_response.transaction_reference)
  clientTransactionId: string;  // UUID nuevo que une los avisos de la anulación con el cobro
  eventsWebhookUrl: string;
}

// Anula la venta (void). El mismo día es una cancelación; desde la medianoche entra al ciclo de devoluciones. Sin pedir
// la tarjeta otra vez (omit_card). Igual que el cobro: la respuesta solo confirma que el terminal recibió la orden.
export async function enviarReembolsoAsync(serial: string, orden: OrdenReembolso): Promise<void> {
  const datos = await llamar(serial, 'async/void', {
    events_webhook_url: orden.eventsWebhookUrl,
    amount: { subtotal_iva0: orden.monto, subtotal_iva: 0, iva: 0 },
    client_transaction_id: orden.clientTransactionId,
    transaction_reference: orden.transactionReference,
    omit_card: true,
  });
  if (datos?.status !== 'TERMINAL_ACKNOWLEDGED') {
    throw new KushkiError('El datáfono no aceptó la anulación', 502, { respuesta: datos });
  }
}

export interface TransaccionTerminal {
  estado: 'aprobada' | 'rechazada' | 'anulada';
  tipo: string;
  transactionReference?: string;
  ticketNumber?: string;
  montoAprobado: number;
}

const TIPOS_ANULACION = new Set(['VOID', 'REVERSE', 'REFUND']);

// Consulta el historial del terminal por el client_transaction_id del cobro. Es la fuente de verdad para acreditar:
// el aviso del webhook no lleva firma, así que nunca se confía en él a secas. null = Kushki todavía no lo registra.
export async function buscarTransaccion(serial: string, clientTransactionId: string): Promise<TransaccionTerminal | null> {
  const datos = await llamar(serial, 'sync/transaction_search_online', {
    page: 1,
    size: 10,
    filters: { client_transaction_id: clientTransactionId, start_date: 0, end_date: 0 },
  });
  const items: any[] = Array.isArray(datos?.items) ? datos.items.filter((i: any) => i?.client_transaction_id === clientTransactionId) : [];
  if (items.length === 0) return null;

  const anulada = items.find((i) => TIPOS_ANULACION.has(String(i.transaction_type).toUpperCase()) && i.transaction_status === 'APPROVAL');
  const venta = items.find((i) => !TIPOS_ANULACION.has(String(i.transaction_type).toUpperCase())) ?? items[0];
  const fuente = anulada ?? venta;
  const aprobada = venta.transaction_status === 'APPROVAL';

  return {
    estado: anulada ? 'anulada' : aprobada ? 'aprobada' : 'rechazada',
    tipo: String(fuente.transaction_type ?? ''),
    transactionReference: venta.transaction_reference,
    ticketNumber: venta.ticket_number ?? venta.transaction_id,
    montoAprobado: Number(venta.approved_transaction_amount ?? 0),
  };
}
