import axios from 'axios';
import { prisma } from '../index';
import { AMBIENTES_KUSHKI, KushkiError } from './kushki';

// ══════════════════════════════════════
// PAGOS DE LA PÁGINA WEB (Kushki, tarjeta no presente)
// ══════════════════════════════════════
// La tienda en línea cobra con Kushki (tarjeta, PSE, efectivo) en un Branch de "card not present". Cada pago aprobado en ese Branch se
// refleja en la cuenta "Página web" con la misma lógica de las ventas del datáfono: el mismo ticket nunca se acredita dos veces, la
// comisión es la de datáfonos y una anulación o reembolso descuenta el monto completo.
//
// La consulta es la de Analytics de Kushki (transacciones en línea), con la llave privada de ese Branch. Como la respuesta puede traer los
// nombres en snake_case o camelCase, aquí se normaliza al mismo formato que usa el resto del sistema.

const TAMANO_PAGINA = 100;
const MAX_PAGINAS = 30;

const baseUrl = () => (process.env.KUSHKI_WEB_BASE_URL || AMBIENTES_KUSHKI.produccion).replace(/\/+$/, '');
// La ruta se puede cambiar sin tocar el código si Kushki la modifica o si hay que usar la versión 1
const rutaTransacciones = () => process.env.KUSHKI_WEB_TRANSACCIONES_PATH || '/analytics/v2/transactions-list';

function listaDe(data: any): any[] {
  if (Array.isArray(data)) return data;
  for (const k of ['data', 'items', 'transactions', 'results', 'content']) if (Array.isArray(data?.[k])) return data[k];
  if (Array.isArray(data?.data?.items)) return data.data.items;
  return [];
}

export async function buscarTransaccionesWeb(llavePrivada: string, desdeMs: number, hastaMs: number): Promise<any[]> {
  const items: any[] = [];
  for (let pagina = 0; pagina < MAX_PAGINAS; pagina++) {
    let respuesta;
    try {
      respuesta = await axios.get(`${baseUrl()}${rutaTransacciones()}`, {
        params: { from: new Date(desdeMs).toISOString(), to: new Date(hastaMs).toISOString(), limit: TAMANO_PAGINA, offset: pagina * TAMANO_PAGINA },
        headers: { 'Private-Merchant-Id': llavePrivada, 'Content-Type': 'application/json' },
        timeout: 30_000,
      });
    } catch (err: any) {
      const data = err.response?.data;
      throw new KushkiError(data?.message || data?.error || err.message || 'No se pudo consultar a Kushki', err.response?.status ?? 502, { codigo: data?.code, respuesta: data });
    }
    const lote = listaDe(respuesta.data);
    items.push(...lote);
    if (lote.length < TAMANO_PAGINA) break;
  }
  return items;
}

const primero = (...valores: unknown[]) => valores.find((v) => v !== undefined && v !== null && v !== '');
const num = (v: unknown) => { const n = Number(v); return Number.isFinite(n) ? n : 0; };

const ESTADOS_APROBADOS = new Set(['APPROVAL', 'APPROVED', 'APROBADO', 'APROBADA', 'COMPLETED', 'PAID', 'SUCCESS']);
const TIPOS_REEMBOLSO = new Set(['REFUND', 'VOID', 'REVERSE', 'REVERSAL', 'CHARGEBACK']);

// Lleva una transacción de Kushki (snake_case o camelCase) al formato de aviso que entiende procesarAvisoTerminal
export function itemWebAAviso(it: any): Record<string, any> {
  const estado = String(primero(it?.transaction_status, it?.transactionStatus, it?.status, '') ).toUpperCase();
  const tipoCrudo = String(primero(it?.transaction_type, it?.transactionType, it?.type, 'SALE')).toUpperCase();
  const monto = it?.amount && typeof it.amount === 'object'
    ? ['subtotal_iva', 'subtotalIva', 'subtotal_iva0', 'subtotalIva0', 'iva', 'ice'].reduce((s, k) => s + num(it.amount[k]), 0)
    : it?.amount;
  const aprobado = primero(it?.approved_transaction_amount, it?.approvedTransactionAmount, it?.approved_amount, it?.total_amount, it?.totalAmount, monto);
  return {
    transaction_status: ESTADOS_APROBADOS.has(estado) ? 'APPROVAL' : estado || 'DESCONOCIDO',
    transaction_type: TIPOS_REEMBOLSO.has(tipoCrudo) ? tipoCrudo : 'SALE',
    ticket_number: primero(it?.ticket_number, it?.ticketNumber),
    transaction_reference: primero(it?.transaction_reference, it?.transactionReference, it?.transaction_id, it?.transactionId),
    transaction_id: primero(it?.transaction_id, it?.transactionId),
    sale_ticket_number: primero(it?.sale_ticket_number, it?.saleTicketNumber),
    approved_transaction_amount: aprobado,
    request_amount: primero(it?.request_amount, it?.requestAmount, aprobado),
    created: primero(it?.created, it?.created_at, it?.createdAt, it?.transaction_date, it?.date),
    merchant_id: primero(it?.merchant_id, it?.merchantId),
    merchant_name: primero(it?.merchant_name, it?.merchantName),
    payment_brand: primero(it?.payment_brand, it?.paymentBrand),
    payment_method: primero(it?.payment_method, it?.paymentMethod),
  };
}

// "Terminal" virtual de la página web: sirve para reutilizar todo lo del datáfono (ventas, reembolsos, historial por tienda)
export async function terminalWeb(titularId: string, sede?: { id: string; nombre: string }) {
  const clave = (sede?.id ?? titularId).slice(0, 8);
  const serial = `WEB-${clave}`;
  return prisma.terminalKushki.upsert({
    where: { serial }, update: { sedeId: sede?.id ?? null, titularId },
    create: { serial, alias: 'Página web', modelo: 'WEB', titularId, sedeId: sede?.id ?? null },
  });
}
