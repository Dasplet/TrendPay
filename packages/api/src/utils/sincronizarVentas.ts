import axios from 'axios';
import { prisma } from '../index';
import { logger } from './logger';
import { AMBIENTES_KUSHKI, KushkiError } from './kushki';
import { businessCodeDeTitular } from './kushkiOne';
import { procesarAvisoTerminal, terminalDelAviso, serialesDelAviso } from './ventasTerminal';

// ══════════════════════════════════════
// SINCRONIZAR LAS VENTAS DEL DATÁFONO (sin webhook)
// ══════════════════════════════════════
// Alternativa a los avisos de Kushki: cada pocos minutos TrendPay le pregunta a Kushki las transacciones hechas en los datáfonos
// de la empresa (API de consulta de card present, con la llave privada de su Branch) y refleja las nuevas con la misma lógica
// que el webhook: la misma referencia de transacción nunca se acredita dos veces, así que pueden convivir los dos caminos.
//
// Limitación: la consulta no dice con certeza en qué datáfono se hizo cada venta. Si la respuesta trae el serial del aparato
// se asigna a su tienda; si no, queda en un datáfono "sin identificar" de la empresa (solo la ve la cuenta principal).

const TAMANO_PAGINA = 500;
const MAX_PAGINAS = 20;
const SOLAPE_MS = 15 * 60_000; // se vuelve a mirar un poco hacia atrás por si Kushki tarda en publicar; la referencia evita duplicados

const baseUrl = () => (process.env.KUSHKI_POS_BASE_URL || AMBIENTES_KUSHKI.produccion).replace(/\/+$/, '');

export async function buscarTransaccionesPos(llavePrivada: string, desdeMs: number, hastaMs: number): Promise<any[]> {
  const items: any[] = [];
  for (let pagina = 1; pagina <= MAX_PAGINAS; pagina++) {
    let respuesta;
    try {
      respuesta = await axios.post(
        `${baseUrl()}/pos-analytics/v1/transactions/search`,
        { page: pagina, size: TAMANO_PAGINA, filters: { start_date: desdeMs, end_date: hastaMs } },
        { headers: { 'Private-Credential-Id': llavePrivada, 'Content-Type': 'application/json' }, timeout: 30_000 },
      );
    } catch (err: any) {
      const data = err.response?.data;
      throw new KushkiError(data?.message || err.message || 'No se pudo consultar a Kushki', err.response?.status ?? 502, { codigo: data?.code, respuesta: data });
    }
    const lote: any[] = Array.isArray(respuesta.data?.items) ? respuesta.data.items : [];
    items.push(...lote);
    if (lote.length < TAMANO_PAGINA) break;
  }
  return items;
}

// Los movimientos que no se pueden atribuir a un aparato concreto van a un datáfono "sin identificar" de la empresa
async function terminalSinIdentificar(titularId: string) {
  const serial = `SIN-IDENTIFICAR-${titularId.slice(0, 8)}`;
  return prisma.terminalKushki.upsert({
    where: { serial }, update: {}, create: { serial, alias: 'Datáfono sin identificar', modelo: 'Sunmi', titularId, sedeId: null },
  });
}

export interface ResumenSincronizacion {
  omitida?: string;
  revisadas: number; ventas: number; reembolsos: number; repetidas: number; ignoradas: number; sinAparato: number; errores: number;
  conSerial: boolean; // ¿la respuesta de Kushki trae el serial del aparato? (si no, las ventas no se pueden asignar a una tienda)
  desde?: string; hasta?: string;
}

const vacio = (): ResumenSincronizacion => ({ revisadas: 0, ventas: 0, reembolsos: 0, repetidas: 0, ignoradas: 0, sinAparato: 0, errores: 0, conSerial: false });
const claveMarca = (titularId: string) => `ventas_pos_desde_${titularId}`;

export async function sincronizarEmpresa(titularId: string, opciones: { desdeMs?: number } = {}): Promise<ResumenSincronizacion> {
  const llave = await businessCodeDeTitular(titularId);
  if (!llave) return { ...vacio(), omitida: 'la empresa no tiene la llave privada de Kushki guardada' };

  const hasta = Date.now();
  const marca = await prisma.config.findUnique({ where: { clave: claveMarca(titularId) } });
  // La primera vez solo se deja constancia de "desde cuándo": no se acreditan ventas anteriores (pruebas, días previos al lanzamiento)
  if (!marca && opciones.desdeMs === undefined) {
    await prisma.config.create({ data: { clave: claveMarca(titularId), valor: String(hasta) } });
    return { ...vacio(), omitida: 'primera sincronización: se contarán las ventas desde ahora' };
  }
  const desde = opciones.desdeMs ?? Number(marca!.valor) - SOLAPE_MS;

  const resumen: ResumenSincronizacion = { ...vacio(), desde: new Date(desde).toISOString(), hasta: new Date(hasta).toISOString() };
  const items = await buscarTransaccionesPos(llave, desde, hasta);
  resumen.revisadas = items.length;

  // Primero las más viejas, para que un reembolso encuentre la venta que lo precede
  const ordenadas = [...items].sort((a, b) => Number(a?.created ?? 0) - Number(b?.created ?? 0));
  const huerfano = { terminal: null as Awaited<ReturnType<typeof terminalSinIdentificar>> | null };

  for (const item of ordenadas) {
    try {
      if (serialesDelAviso(item).length > 0) resumen.conSerial = true;
      let terminal = await terminalDelAviso(item);
      if (!terminal) {
        resumen.sinAparato += 1;
        huerfano.terminal ??= await terminalSinIdentificar(titularId);
        terminal = huerfano.terminal;
      }
      // Solo se procesan los aparatos de esta empresa
      if (terminal.titularId !== titularId) { resumen.ignoradas += 1; continue; }
      const r = await procesarAvisoTerminal(terminal, item);
      if (r.detalle.startsWith('venta aprobada')) resumen.ventas += 1;
      else if (r.detalle.startsWith('reembolso aprobado')) resumen.reembolsos += 1;
      else if (r.detalle.includes('repetid')) resumen.repetidas += 1;
      else resumen.ignoradas += 1;
    } catch (err: any) {
      resumen.errores += 1;
      logger.error('Error reflejando una venta de datáfono sincronizada', { err: err.message });
    }
  }

  // La marca solo avanza si no hubo errores: lo que falló se vuelve a intentar en la próxima vuelta
  if (resumen.errores === 0) {
    await prisma.config.upsert({ where: { clave: claveMarca(titularId) }, create: { clave: claveMarca(titularId), valor: String(hasta) }, update: { valor: String(hasta) } });
  }
  if (resumen.ventas + resumen.reembolsos > 0) logger.info('Ventas de datáfono sincronizadas', { ...resumen });
  return resumen;
}

export async function sincronizarTodas(): Promise<void> {
  const empresas = await prisma.comercioKushkiOne.findMany({ where: { activo: true, businessCodeCif: { not: null } }, select: { userId: true } });
  for (const { userId } of empresas) {
    try { await sincronizarEmpresa(userId); }
    catch (err: any) { logger.warn('No se pudieron sincronizar las ventas de datáfono de una empresa', { err: err.message, status: err.status }); }
  }
}

export function iniciarSincronizacionVentas(): void {
  if (process.env.NODE_ENV === 'test') return;
  const timer = setInterval(() => { sincronizarTodas().catch((err: any) => logger.error('Falló la sincronización de ventas de datáfono', { err: err.message })); }, 2 * 60_000);
  timer.unref();
  logger.info('🔄 Sincronización de ventas de datáfono activa (cada 2 minutos)');
}
