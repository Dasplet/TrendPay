import { prisma } from '../index';
import { logger } from './logger';
import { procesarAvisoTerminal, fechaDelAviso, type OpcionesAviso } from './ventasTerminal';
import { terminalSinIdentificar } from './sincronizarVentas';

// Importa un reporte de transacciones de la consola de Kushki (archivo .csv con columnas separadas por "|"): sirve para reflejar en
// TrendPay las ventas y anulaciones que ya ocurrieron y no se vieron (antes de la sincronización, o porque se borraron al limpiar).
// Usa exactamente la misma lógica que el webhook y la sincronización: cada transacción se registra una sola vez (por su ticket), una
// anulación se liga a la venta que dice anular, y cada movimiento conserva la fecha real en que se hizo.

type Fila = Record<string, string>;

const limpiar = (s: string) => s.trim().replace(/^"/, '').replace(/"$/, '');

export function parsearCsvKushki(texto: string): Fila[] {
  const lineas = texto.replace(/^\uFEFF/, '').split(/\r?\n/).filter((l) => l.trim() !== '');
  if (lineas.length < 2) return [];
  const cabecera = lineas[0].split('|').map(limpiar);
  return lineas.slice(1).map((linea) => {
    const valores = linea.split('|').map(limpiar);
    return Object.fromEntries(cabecera.map((c, i) => [c, valores[i] ?? '']));
  });
}

function filaAAviso(f: Fila): Record<string, any> | null {
  const ticket = f.ticket_number;
  if (!/^\d{6,30}$/.test(ticket ?? '')) return null;
  const estado = (f.transaction_status || '').toUpperCase();
  return {
    transaction_status: estado === 'APPROVED' ? 'APPROVAL' : estado,
    transaction_type: (f.transaction_type || '').toUpperCase(),
    ticket_number: ticket, transaction_id: ticket,
    sale_ticket_number: f.sale_ticket_number || undefined,
    approved_transaction_amount: Number(f.approved_transaction_amount),
    request_amount: Number(f.request_amount),
    created: f.created, merchant_id: f.merchant_id, merchant_name: f.merchant_name,
    payment_brand: f.payment_brand, masked_credit_card: f.masked_credit_card,
  };
}

export interface ResumenImportacion {
  filas: number; ventas: number; reembolsos: number; repetidas: number; ignoradas: number; errores: number;
  montoVentas: number; montoReembolsos: number; desde?: string; hasta?: string;
}

export async function importarVentasCsv(titularId: string, texto: string, opciones: OpcionesAviso = {}): Promise<ResumenImportacion> {
  const resumen: ResumenImportacion = { filas: 0, ventas: 0, reembolsos: 0, repetidas: 0, ignoradas: 0, errores: 0, montoVentas: 0, montoReembolsos: 0 };
  const filas = parsearCsvKushki(texto);
  resumen.filas = filas.length;

  const avisos = filas.map(filaAAviso);
  resumen.ignoradas += avisos.filter((a) => a === null).length; // filas sin ticket válido (encabezados repetidos, líneas rotas)
  // Primero lo más viejo: una anulación encuentra la venta que la precede
  const validos = (avisos.filter((a) => a !== null) as Record<string, any>[]).sort((a, b) => fechaDelAviso(a).getTime() - fechaDelAviso(b).getTime());
  if (validos.length === 0) return resumen;
  resumen.desde = fechaDelAviso(validos[0]).toISOString();
  resumen.hasta = fechaDelAviso(validos[validos.length - 1]).toISOString();

  // El reporte no dice en qué datáfono se hizo cada venta: van al "sin identificar" (y a la tienda si la empresa solo tiene una)
  const terminal = await terminalSinIdentificar(titularId);
  for (const aviso of validos) {
    try {
      const r = await procesarAvisoTerminal(terminal, aviso, opciones);
      if (r.detalle.startsWith('venta aprobada')) { resumen.ventas += 1; resumen.montoVentas += Number(aviso.approved_transaction_amount); }
      else if (r.detalle.startsWith('reembolso aprobado')) { resumen.reembolsos += 1; resumen.montoReembolsos += Number(aviso.approved_transaction_amount); }
      else if (r.detalle.includes('repetid')) resumen.repetidas += 1;
      else resumen.ignoradas += 1;
    } catch (err: any) {
      resumen.errores += 1;
      logger.error('Error importando una venta de datáfono', { err: err.message });
    }
  }
  logger.info('Importación de ventas de datáfono', { titularId, ...resumen });
  return resumen;
}
