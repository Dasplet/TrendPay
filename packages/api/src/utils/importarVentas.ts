import { prisma } from '../index';
import { logger } from './logger';
import { procesarAvisoTerminal, fechaDelAviso, type OpcionesAviso } from './ventasTerminal';
import { terminalSinIdentificar } from './sincronizarVentas';
import { terminalWeb } from './ventasWeb';

// Importa un reporte de transacciones de la consola de Kushki (archivo .csv con columnas separadas por "|"): sirve para reflejar en
// TrendPay lo que ya ocurrió y no se vio (antes de la sincronización, o porque se borró al limpiar).
// Usa exactamente la misma lógica que el webhook y la sincronización: cada transacción se registra una sola vez (por su ticket), una
// anulación se liga a la venta que dice anular, y cada movimiento conserva la fecha real en que se hizo.
//
// El propio archivo dice de dónde viene cada fila (payment_submethod_type): "CARD PRESENT" es un datáfono; "CARD NO PRESENT",
// "TRANSFER IN" (PSE) o efectivo son pagos en línea de la página web. Todo queda en la cuenta destino que elija el administrador.

type Fila = Record<string, string>;

const limpiar = (s: string) => s.trim().replace(/^"/, '').replace(/"$/, '');

export function parsearCsvKushki(texto: string): Fila[] {
  const lineas = texto.replace(/^﻿/, '').split(/\r?\n/).filter((l) => l.trim() !== '');
  if (lineas.length < 2) return [];
  const cabecera = lineas[0].split('|').map(limpiar);
  return lineas.slice(1).map((linea) => {
    const valores = linea.split('|').map(limpiar);
    return Object.fromEntries(cabecera.map((c, i) => [c, valores[i] ?? '']));
  });
}

export type CanalFila = 'datafono' | 'web';

// Datáfono (tarjeta presente) o página web (tarjeta no presente, PSE, efectivo). Sin dato, se trata como datáfono.
export function canalDeFila(f: Fila): CanalFila {
  const sub = (f.payment_submethod_type || '').toUpperCase();
  const metodo = (f.payment_method || '').toLowerCase();
  if (sub.includes('NO PRESENT') || sub.includes('TRANSFER') || sub.includes('CASH') || metodo === 'transfer' || metodo === 'cash') return 'web';
  return 'datafono';
}

function filaAAviso(f: Fila): (Record<string, any> & { canal: CanalFila }) | null {
  const ticket = f.ticket_number;
  if (!/^\d{6,30}$/.test(ticket ?? '')) return null;
  const estado = (f.transaction_status || '').toUpperCase();
  return {
    canal: canalDeFila(f),
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
  montoVentas: number; montoReembolsos: number; ventasWeb: number; ventasDatafono: number; desde?: string; hasta?: string;
}

// `duenoId` es la cuenta donde queda todo: una empresa (cuenta principal) o una de sus tiendas
export async function importarVentasCsv(duenoId: string, texto: string, opciones: OpcionesAviso = {}): Promise<ResumenImportacion> {
  const resumen: ResumenImportacion = { filas: 0, ventas: 0, reembolsos: 0, repetidas: 0, ignoradas: 0, errores: 0, montoVentas: 0, montoReembolsos: 0, ventasWeb: 0, ventasDatafono: 0 };
  const filas = parsearCsvKushki(texto);
  resumen.filas = filas.length;

  const avisos = filas.map(filaAAviso);
  resumen.ignoradas += avisos.filter((a) => a === null).length; // filas sin ticket válido (rechazadas sin número, líneas rotas)
  // Primero lo más viejo: una anulación encuentra la venta que la precede
  const validos = (avisos.filter((a) => a !== null) as (Record<string, any> & { canal: CanalFila })[]).sort((a, b) => fechaDelAviso(a).getTime() - fechaDelAviso(b).getTime());
  if (validos.length === 0) return resumen;
  resumen.desde = fechaDelAviso(validos[0]).toISOString();
  resumen.hasta = fechaDelAviso(validos[validos.length - 1]).toISOString();

  const dueno = await prisma.user.findUniqueOrThrow({ where: { id: duenoId }, select: { id: true, nombre: true, cuentaPadreId: true } });
  const titularId = dueno.cuentaPadreId ?? dueno.id;
  const sede = dueno.cuentaPadreId ? { id: dueno.id, nombre: dueno.nombre } : undefined;

  // Un reporte de datáfonos no dice en qué aparato se hizo cada venta: van al "sin identificar" (de la tienda, o de la empresa)
  const terminales: Partial<Record<CanalFila, Awaited<ReturnType<typeof terminalWeb>>>> = {};
  for (const aviso of validos) {
    try {
      const canal = aviso.canal;
      const terminal = (terminales[canal] ??= canal === 'web' ? await terminalWeb(titularId, sede) : await terminalSinIdentificar(titularId, sede));
      const r = await procesarAvisoTerminal(terminal, aviso, opciones);
      if (r.detalle.startsWith('venta aprobada')) {
        resumen.ventas += 1; resumen.montoVentas += Number(aviso.approved_transaction_amount);
        if (canal === 'web') resumen.ventasWeb += 1; else resumen.ventasDatafono += 1;
      } else if (r.detalle.startsWith('reembolso aprobado')) { resumen.reembolsos += 1; resumen.montoReembolsos += Number(aviso.approved_transaction_amount); }
      else if (r.detalle.includes('repetid')) resumen.repetidas += 1;
      else resumen.ignoradas += 1;
    } catch (err: any) {
      resumen.errores += 1;
      logger.error('Error importando una transacción del reporte de Kushki', { err: err.message });
    }
  }
  logger.info('Importación del reporte de Kushki', { duenoId, ...resumen });
  return resumen;
}
