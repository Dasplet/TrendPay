import { timingSafeEqual, createHash } from 'node:crypto';
import type { CobroDatafono, TerminalKushki } from '@prisma/client';
import { prisma } from '../index';
import { genCodigo } from './security';
import { logger } from './logger';
import { buscarTransaccion, kushkiOneConfigurado } from './kushkiOne';

// ══════════════════════════════════════
// COBROS CON DATÁFONO (Kushki One)
// ══════════════════════════════════════
// TrendPay manda el cobro al terminal y Kushki avisa cada cambio de estado por webhook. El aviso NO lleva firma, así
// que solo sirve para saber que hay novedades: el saldo se acredita únicamente cuando la consulta de transacciones de
// Kushki confirma la aprobación, y una sola vez (el cobro se "reclama" con un UPDATE condicional).

export type CobroConTerminal = CobroDatafono & { terminal: TerminalKushki };

const ESTADOS_ABIERTOS = ['pendiente', 'expirado']; // un "expirado" todavía puede aprobarse si el terminal estaba sin red
const MIN_OCUPADO_MS = 10 * 60_000;                 // un cobro pendiente mantiene ocupado el terminal este tiempo
const CLAVE_COMISION = 'comision_datafono_pct';

export async function comisionDatafonoPct(): Promise<number> {
  const cfg = await prisma.config.findUnique({ where: { clave: CLAVE_COMISION } });
  const pct = cfg ? Number.parseFloat(cfg.valor) : 0;
  return Number.isFinite(pct) && pct >= 0 ? pct : 0;
}

export async function guardarComisionDatafonoPct(pct: number): Promise<void> {
  await prisma.config.upsert({ where: { clave: CLAVE_COMISION }, create: { clave: CLAVE_COMISION, valor: String(pct) }, update: { valor: String(pct) } });
}

// Dirección pública a la que Kushki avisa: lleva un código secreto en el camino porque el aviso no trae firma
export function webhookDatafonoUrl(): string | null {
  const token = process.env.KUSHKI_ONE_WEBHOOK_TOKEN;
  if (!token) return null;
  const base = (process.env.KUSHKI_ONE_WEBHOOK_URL || (process.env.KUSHKI_WEBHOOK_URL || '').replace(/\/api\/kushki\/webhooks\/payout\/?$/, '')).replace(/\/+$/, '');
  if (!/^https?:\/\//.test(base)) return null;
  const raiz = base.endsWith('/api/datafonos/webhooks') ? base : `${base}/api/datafonos/webhooks`;
  return `${raiz}/${token}`;
}

export function tokenWebhookValido(recibido: string): boolean {
  const esperado = process.env.KUSHKI_ONE_WEBHOOK_TOKEN;
  if (!esperado) return false;
  const a = createHash('sha256').update(recibido).digest();
  const b = createHash('sha256').update(esperado).digest();
  return timingSafeEqual(a, b);
}

export async function terminalOcupado(terminalId: string): Promise<boolean> {
  const n = await prisma.cobroDatafono.count({
    where: { terminalId, estado: 'pendiente', createdAt: { gte: new Date(Date.now() - MIN_OCUPADO_MS) } },
  });
  return n > 0;
}

export interface ConfirmacionAprobacion {
  transactionReference?: string;
  ticketNumber?: string;
  montoAprobado: number;
}

export type ResultadoCobro = { estado: string; saldo?: number };

// Acredita el neto en la billetera de la empresa. Seguro ante llamadas simultáneas (webhook + conciliación + consulta).
export async function acreditarCobro(cobro: CobroConTerminal, conf: ConfirmacionAprobacion): Promise<ResultadoCobro> {
  const monto = Number(cobro.monto);

  // Kushki aprobó un monto distinto al pedido (aprobación parcial o inconsistencia): no se acredita sola, que lo revise una persona
  if (conf.montoAprobado !== monto) {
    await prisma.cobroDatafono.updateMany({
      where: { id: cobro.id, estado: { in: ESTADOS_ABIERTOS } },
      data: { estado: 'revision', detalle: `Kushki aprobó ${conf.montoAprobado} y se pidió ${monto}`, transactionReference: conf.transactionReference },
    });
    logger.warn('Cobro de datáfono con monto distinto al pedido', { cobroId: cobro.id, pedido: monto, aprobado: conf.montoAprobado });
    return { estado: 'revision' };
  }

  const pct = Number(cobro.comisionPct);
  const comision = Math.round((monto * pct) / 100);
  const neto = monto - comision;

  const resultado = await prisma.$transaction(async (tx): Promise<ResultadoCobro> => {
    const reclamo = await tx.cobroDatafono.updateMany({
      where: { id: cobro.id, estado: { in: ESTADOS_ABIERTOS } },
      data: { estado: 'aprobado', detalle: null, transactionReference: conf.transactionReference, ticketNumber: conf.ticketNumber },
    });
    if (reclamo.count === 0) {
      const actual = await tx.cobroDatafono.findUnique({ where: { id: cobro.id } });
      return { estado: actual?.estado ?? 'pendiente' };
    }

    const wallet = await tx.wallet.findUnique({ where: { userId: cobro.terminal.titularId } });
    if (!wallet) throw new Error('Billetera no encontrada');

    const actualizada = await tx.wallet.update({ where: { id: wallet.id }, data: { saldo: { increment: neto } } });
    const saldoDespues = Number.parseFloat(actualizada.saldo.toString());

    await tx.transaction.create({
      data: {
        walletId: wallet.id,
        userId: cobro.userId,
        codigo: genCodigo('DTF'),
        categoria: 'datafono',
        descripcion: `Cobro con datáfono · ${cobro.terminal.alias}`,
        montoBruto: monto,
        comisionPct: pct,
        comisionValor: comision,
        montoNeto: neto,
        saldoAntes: saldoDespues - neto,
        saldoDespues,
        status: 'exitosa',
        metadata: {
          terminal: cobro.terminal.serial,
          clientTransactionId: cobro.clientTransactionId,
          transactionReference: conf.transactionReference ?? null,
          ticketNumber: conf.ticketNumber ?? null,
        },
      },
    });

    const destinatarios = new Set([cobro.userId, cobro.terminal.titularId]);
    for (const userId of destinatarios) {
      await tx.notification.create({
        data: { userId, tipo: 'ok', titulo: 'Cobro con datáfono aprobado', mensaje: `Se acreditaron ${neto.toLocaleString('es-CO')} COP por un cobro en ${cobro.terminal.alias}` },
      });
    }
    return { estado: 'aprobado', saldo: saldoDespues };
  });

  if (resultado.saldo !== undefined) {
    logger.info('Cobro de datáfono acreditado', { cobroId: cobro.id, terminal: cobro.terminal.serial, neto, ticketNumber: conf.ticketNumber });
  }
  return resultado;
}

async function cerrarSinSaldo(cobro: CobroDatafono, estado: 'rechazado' | 'cancelado' | 'expirado', detalle: string): Promise<ResultadoCobro> {
  await prisma.cobroDatafono.updateMany({ where: { id: cobro.id, estado: { in: ['pendiente', ...(estado === 'expirado' ? [] : ['expirado'])] } }, data: { estado, detalle } });
  return { estado };
}

// Pregunta a Kushki por el cobro y lo resuelve. Lo usan el webhook (al llegar una aprobación) y la conciliación.
export async function resolverCobro(cobro: CobroConTerminal): Promise<ResultadoCobro> {
  const t = await buscarTransaccion(cobro.terminal.serial, cobro.clientTransactionId);
  if (!t) return { estado: cobro.estado };
  if (t.estado === 'aprobada') return acreditarCobro(cobro, t);
  if (t.estado === 'anulada') return cerrarSinSaldo(cobro, 'cancelado', 'Transacción anulada en Kushki');
  return cerrarSinSaldo(cobro, 'rechazado', 'Rechazada por el banco emisor');
}

// ── Webhook ──
export interface EventoKushkiOne {
  event_id?: unknown;
  status?: unknown;
  client_transaction_id?: unknown;
  terminal?: { serial_number?: unknown } | null;
  failure_reason?: { code?: unknown; message?: unknown } | null;
}

const texto = (v: unknown, max = 200): string | null => (typeof v === 'string' && v.length > 0 && v.length <= max ? v : null);

export interface ResultadoEvento { http: number; detalle: string }

export async function procesarEvento(evento: EventoKushkiOne): Promise<ResultadoEvento> {
  const eventId = texto(evento.event_id, 80);
  const status = texto(evento.status, 40);
  const clientId = texto(evento.client_transaction_id, 80);
  if (!eventId || !status || !clientId) return { http: 400, detalle: 'evento inválido' };

  const cobro = await prisma.cobroDatafono.findUnique({ where: { clientTransactionId: clientId }, include: { terminal: true } });
  if (!cobro) return { http: 200, detalle: 'no coincide con ningún cobro' };

  // Solo se aceptan avisos del terminal al que TrendPay mandó el cobro
  const serial = texto(evento.terminal?.serial_number, 80);
  if (serial && serial !== cobro.terminal.serial) {
    logger.warn('Aviso de datáfono de un terminal distinto al del cobro', { cobroId: cobro.id, esperado: cobro.terminal.serial, recibido: serial });
    return { http: 200, detalle: 'el terminal no coincide con el del cobro' };
  }

  // Kushki repite avisos (reintentos, o el terminal reenvía lo que tenía en cola tras quedarse sin red)
  if (await prisma.eventoDatafono.findUnique({ where: { eventId } })) return { http: 200, detalle: 'evento repetido' };

  let detalle = status;
  if (status === 'APPROVAL') {
    // Si no se puede confirmar con Kushki se lanza el error: responde 500 y Kushki reintenta (la conciliación también lo cubre)
    const r = await resolverCobro(cobro);
    detalle = `APPROVAL → ${r.estado}`;
  } else if (status === 'DECLINED' || status === 'TERMINAL_REJECTED') {
    const motivo = texto(evento.failure_reason?.message, 200) ?? (status === 'DECLINED' ? 'Rechazada por el banco emisor' : 'Rechazada en el terminal');
    await cerrarSinSaldo(cobro, 'rechazado', motivo);
  } else if (status === 'TERMINAL_CANCELED') {
    await cerrarSinSaldo(cobro, 'cancelado', 'Cancelada en el terminal');
  }

  await prisma.cobroDatafono.updateMany({ where: { id: cobro.id }, data: { estadoTerminal: status } });
  // Se registra al final: si el procesamiento falló, el reintento de Kushki no se descarta como repetido
  await prisma.eventoDatafono.create({ data: { eventId, cobroId: cobro.id, status } }).catch(() => {});
  return { http: 200, detalle };
}

// ── Conciliación ──
export interface ResumenConciliacionDatafonos { revisados: number; aprobados: number; cerrados: number; pendientes: number; errores: number }

// Revisa los cobros que siguen abiertos: cubre avisos que nunca llegaron. Un cobro sin rastro en Kushki a los 10 minutos
// se marca "expirado" (libera el terminal), pero si más tarde aparece aprobado todavía se acredita.
export async function conciliarCobrosDatafono(opts: { minEdadSeg?: number; maxEdadHoras?: number; limite?: number } = {}): Promise<ResumenConciliacionDatafonos> {
  const { minEdadSeg = 90, maxEdadHoras = 24, limite = 50 } = opts;
  const ahora = Date.now();
  const cobros = await prisma.cobroDatafono.findMany({
    where: { estado: { in: ESTADOS_ABIERTOS }, createdAt: { lte: new Date(ahora - minEdadSeg * 1000), gte: new Date(ahora - maxEdadHoras * 3_600_000) } },
    include: { terminal: true },
    orderBy: { createdAt: 'asc' },
    take: limite,
  });

  const resumen: ResumenConciliacionDatafonos = { revisados: 0, aprobados: 0, cerrados: 0, pendientes: 0, errores: 0 };
  for (const cobro of cobros) {
    resumen.revisados += 1;
    try {
      const r = await resolverCobro(cobro);
      if (r.estado === 'aprobado' && cobro.estado !== 'aprobado') resumen.aprobados += 1;
      else if (r.estado === 'rechazado' || r.estado === 'cancelado' || r.estado === 'revision') resumen.cerrados += 1;
      else {
        resumen.pendientes += 1;
        if (cobro.estado === 'pendiente' && ahora - cobro.createdAt.getTime() > MIN_OCUPADO_MS) {
          await cerrarSinSaldo(cobro, 'expirado', 'Sin respuesta del terminal');
        }
      }
    } catch (err: any) {
      resumen.errores += 1;
      logger.error('Error conciliando cobro de datáfono', { err: err.message, id: cobro.id });
    }
  }
  if (resumen.revisados > 0) logger.info('Conciliación de cobros de datáfono', { ...resumen });
  return resumen;
}

export function iniciarConciliacionDatafonos(): void {
  if (process.env.NODE_ENV === 'test' || !kushkiOneConfigurado()) return;
  const timer = setInterval(() => {
    conciliarCobrosDatafono().catch((err: any) => logger.error('Falló la conciliación de datáfonos', { err: err.message }));
  }, 2 * 60_000);
  timer.unref();
  logger.info('🔁 Conciliación de cobros de datáfono activa (cada 2 minutos)');
}
