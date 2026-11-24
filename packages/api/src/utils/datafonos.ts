import { timingSafeEqual, createHash } from 'node:crypto';
import type { CobroDatafono, TerminalKushki } from '@prisma/client';
import { prisma } from '../index';
import { genCodigo, encrypt, decrypt } from './security';
import { logger } from './logger';
import { randomBytes } from 'node:crypto';
import { buscarTransaccion, businessCodeDeTitular } from './kushkiOne';

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

// Cada empresa puede tener su PROPIA comisión de datáfonos (lo pactado con ella); si no tiene, se usa la general.
const claveComisionEmpresa = (titularId: string) => `${CLAVE_COMISION}:${titularId}`;
const pctValido = (v: string | undefined | null): number | null => {
  if (v === undefined || v === null) return null;
  const n = Number.parseFloat(v);
  return Number.isFinite(n) && n >= 0 ? n : null;
};

export async function comisionDatafonoDeEmpresa(titularId: string): Promise<number> {
  const propia = await prisma.config.findUnique({ where: { clave: claveComisionEmpresa(titularId) } });
  return pctValido(propia?.valor) ?? (await comisionDatafonoPct());
}

// Comisiones propias de varias empresas de una vez (null = usa la general)
export async function comisionesPropias(titularIds: string[]): Promise<Map<string, number | null>> {
  const filas = titularIds.length ? await prisma.config.findMany({ where: { clave: { in: titularIds.map(claveComisionEmpresa) } } }) : [];
  const porClave = new Map(filas.map((f) => [f.clave, pctValido(f.valor)]));
  return new Map(titularIds.map((id) => [id, porClave.get(claveComisionEmpresa(id)) ?? null]));
}

export async function guardarComisionDatafonoEmpresa(titularId: string, pct: number | null): Promise<void> {
  const clave = claveComisionEmpresa(titularId);
  if (pct === null) await prisma.config.deleteMany({ where: { clave } });
  else await prisma.config.upsert({ where: { clave }, create: { clave, valor: String(pct) }, update: { valor: String(pct) } });
}

export async function guardarComisionDatafonoPct(pct: number): Promise<void> {
  await prisma.config.upsert({ where: { clave: CLAVE_COMISION }, create: { clave: CLAVE_COMISION, valor: String(pct) }, update: { valor: String(pct) } });
}

// Código secreto que va en la URL del webhook (los avisos de Kushki One no traen firma). Si no se define la variable
// KUSHKI_ONE_WEBHOOK_TOKEN, TrendPay lo crea solo la primera vez y lo guarda cifrado en su base de datos.
const CLAVE_TOKEN_WEBHOOK = 'kushki_one_webhook_token';
let tokenEnMemoria: string | null = null;

export async function tokenWebhookDatafono(): Promise<string> {
  if (process.env.KUSHKI_ONE_WEBHOOK_TOKEN) return process.env.KUSHKI_ONE_WEBHOOK_TOKEN;
  if (tokenEnMemoria) return tokenEnMemoria;
  const cfg = await prisma.config.findUnique({ where: { clave: CLAVE_TOKEN_WEBHOOK } });
  const guardado = cfg ? decrypt(cfg.valor) : null;
  if (guardado && guardado !== '****') return (tokenEnMemoria = guardado);
  const nuevo = randomBytes(24).toString('hex');
  // Si dos procesos lo crean a la vez gana el primero que se guarda; todos releen el ganador
  await prisma.config.upsert({ where: { clave: CLAVE_TOKEN_WEBHOOK }, create: { clave: CLAVE_TOKEN_WEBHOOK, valor: encrypt(nuevo) }, update: {} });
  const final = await prisma.config.findUnique({ where: { clave: CLAVE_TOKEN_WEBHOOK } });
  return (tokenEnMemoria = final ? decrypt(final.valor) : nuevo);
}

export function olvidarTokenWebhookEnMemoria(): void { tokenEnMemoria = null; }

// Dirección pública del API (no es secreta). Se toma de la configuración, nunca de lo que mande quien hace la petición:
// el aviso lleva el código secreto, y una dirección ajena lo filtraría.
export function urlPublicaApi(): string | null {
  const base = (process.env.KUSHKI_ONE_WEBHOOK_URL
    || (process.env.KUSHKI_WEBHOOK_URL || '').replace(/\/api\/kushki\/webhooks\/payout\/?$/, '')
    || (process.env.NODE_ENV === 'production' ? 'https://trendpay-api-production.up.railway.app' : '')).replace(/\/+$/, '');
  return /^https?:\/\//.test(base) ? base : null;
}

// Dirección completa a la que Kushki avisa cada cambio de un cobro
export async function webhookDatafonoUrl(): Promise<string | null> {
  const base = urlPublicaApi();
  if (!base) return null;
  const raiz = base.endsWith('/api/datafonos/webhooks') ? base : `${base}/api/datafonos/webhooks`;
  return `${raiz}/${await tokenWebhookDatafono()}`;
}

export async function tokenWebhookValido(recibido: string): Promise<boolean> {
  const a = createHash('sha256').update(recibido).digest();
  const b = createHash('sha256').update(await tokenWebhookDatafono()).digest();
  return timingSafeEqual(a, b);
}

// ¿Esta empresa puede cobrar con datáfono? Necesita su Business-Code y la dirección pública del API
export async function datafonosListosParaEmpresa(titularId: string): Promise<{ listo: boolean; motivo?: string }> {
  if (!(await businessCodeDeTitular(titularId))) return { listo: false, motivo: 'Esta empresa todavía no tiene el Business-Code de Kushki One' };
  if (!urlPublicaApi()) return { listo: false, motivo: 'Falta la dirección pública del API (KUSHKI_ONE_WEBHOOK_URL)' };
  return { listo: true };
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

type Tx = Parameters<Parameters<typeof prisma.$transaction>[0]>[0];

// La tienda a la que pertenece el movimiento: la sede del datáfono; si el datáfono es de toda la empresa, la sede que cobró
// (si cobró la cuenta principal, queda sin sede y solo la ve la cuenta principal)
async function sedeDelCobro(tx: Tx, cobro: CobroConTerminal): Promise<string | null> {
  if (cobro.terminal.sedeId) return cobro.terminal.sedeId;
  const cajero = await tx.user.findUnique({ where: { id: cobro.userId }, select: { cuentaPadreId: true } });
  return cajero?.cuentaPadreId ? cobro.userId : null;
}

// Lo que se le acreditó a la billetera por este cobro (monto menos la comisión que había al cobrar)
export const netoDelCobro = (cobro: { monto: unknown; comisionPct: unknown }) => {
  const monto = Number(cobro.monto);
  return monto - Math.round((monto * Number(cobro.comisionPct)) / 100);
};

const ESTADOS_REEMBOLSABLES = ['aprobado'];

// El reembolso se confirmó en Kushki: se descuenta de la billetera lo que se había acreditado, una sola vez. Si el cliente ya
// retiró ese dinero el saldo puede quedar negativo: el dinero ya salió hacia la tarjeta del comprador.
export async function completarReembolso(cobro: CobroConTerminal, adminId?: string | null): Promise<ResultadoCobro> {
  const monto = Number(cobro.monto);
  const pct = Number(cobro.comisionPct);
  const comision = Math.round((monto * pct) / 100);
  const neto = monto - comision;

  const resultado = await prisma.$transaction(async (tx): Promise<ResultadoCobro> => {
    const reclamo = await tx.cobroDatafono.updateMany({
      where: { id: cobro.id, estado: { in: ['reembolsando', ...ESTADOS_REEMBOLSABLES] } },
      data: { estado: 'reembolsado', detalle: null, reembolsadoAt: new Date(), ...(adminId ? { reembolsadoPor: adminId } : {}) },
    });
    if (reclamo.count === 0) {
      const actual = await tx.cobroDatafono.findUnique({ where: { id: cobro.id } });
      return { estado: actual?.estado ?? 'aprobado' };
    }

    const wallet = await tx.wallet.findUnique({ where: { userId: cobro.terminal.titularId } });
    if (!wallet) throw new Error('Billetera no encontrada');
    const actualizada = await tx.wallet.update({ where: { id: wallet.id }, data: { saldo: { decrement: neto } } });
    const saldoDespues = Number.parseFloat(actualizada.saldo.toString());
    const sedeId = await sedeDelCobro(tx, cobro);

    await tx.transaction.create({
      data: {
        walletId: wallet.id,
        userId: cobro.userId,
        sedeId,
        codigo: genCodigo('RDT'),
        categoria: 'reembolso_datafono',
        descripcion: `Reembolso de cobro con datáfono · ${cobro.terminal.alias}`,
        montoBruto: monto,
        comisionPct: pct,
        comisionValor: comision,
        montoNeto: -neto,
        saldoAntes: saldoDespues + neto,
        saldoDespues,
        status: 'exitosa',
        metadata: { terminal: cobro.terminal.serial, clientTransactionId: cobro.clientTransactionId, ticketNumber: cobro.ticketNumber ?? null },
      },
    });

    for (const userId of new Set([cobro.userId, cobro.terminal.titularId])) {
      await tx.notification.create({
        data: { userId, tipo: 'warn', titulo: 'Reembolso de un cobro con datáfono', mensaje: `Se descontaron ${neto.toLocaleString('es-CO')} COP de la billetera por un reembolso en ${cobro.terminal.alias}` },
      });
    }
    return { estado: 'reembolsado', saldo: saldoDespues };
  });

  if (resultado.saldo !== undefined) {
    logger.info('Reembolso de datáfono aplicado', { cobroId: cobro.id, neto });
    if (resultado.saldo < 0) logger.warn('La billetera quedó con saldo negativo por un reembolso de datáfono', { cobroId: cobro.id, titularId: cobro.terminal.titularId });
  }
  return resultado;
}

// El reembolso no se hizo (rechazado, cancelado o sin respuesta): el cobro sigue aprobado y la billetera no cambia
async function revertirReembolso(cobro: CobroDatafono, motivo: string): Promise<ResultadoCobro> {
  await prisma.cobroDatafono.updateMany({ where: { id: cobro.id, estado: 'reembolsando' }, data: { estado: 'aprobado', detalle: motivo, reembolsoClientId: null } });
  return { estado: 'aprobado' };
}

// Pregunta a Kushki por el reembolso en curso (usa el UUID de la anulación) y lo resuelve
export async function resolverReembolso(cobro: CobroConTerminal): Promise<ResultadoCobro> {
  if (!cobro.reembolsoClientId) return { estado: cobro.estado };
  const t = await buscarTransaccion(cobro.terminal.serial, cobro.reembolsoClientId);
  if (!t) return { estado: cobro.estado };
  if (t.estado === 'anulada') return completarReembolso(cobro);
  if (t.estado === 'rechazada') return revertirReembolso(cobro, 'Kushki rechazó el reembolso');
  return { estado: cobro.estado };
}

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

    const sedeId = await sedeDelCobro(tx, cobro);

    await tx.transaction.create({
      data: {
        walletId: wallet.id,
        userId: cobro.userId,
        sedeId,
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

  // El aviso puede ser del cobro o de su reembolso (cada uno con su propio UUID)
  const cobro = await prisma.cobroDatafono.findFirst({ where: { OR: [{ clientTransactionId: clientId }, { reembolsoClientId: clientId }] }, include: { terminal: true } });
  if (!cobro) return { http: 200, detalle: 'no coincide con ningún cobro' };
  const esReembolso = cobro.reembolsoClientId === clientId;

  // Solo se aceptan avisos del terminal al que TrendPay mandó el cobro
  const serial = texto(evento.terminal?.serial_number, 80);
  if (serial && serial !== cobro.terminal.serial) {
    logger.warn('Aviso de datáfono de un terminal distinto al del cobro', { cobroId: cobro.id, esperado: cobro.terminal.serial, recibido: serial });
    return { http: 200, detalle: 'el terminal no coincide con el del cobro' };
  }

  // Kushki repite avisos (reintentos, o el terminal reenvía lo que tenía en cola tras quedarse sin red)
  if (await prisma.eventoDatafono.findUnique({ where: { eventId } })) return { http: 200, detalle: 'evento repetido' };

  let detalle = status;
  if (esReembolso) {
    // Avisos de la anulación: solo la aprobación confirmada por Kushki descuenta saldo; si falla, el cobro sigue aprobado
    if (status === 'APPROVAL') {
      const r = await resolverReembolso(cobro);
      detalle = `Reembolso APPROVAL → ${r.estado}`;
    } else if (status === 'DECLINED' || status === 'TERMINAL_REJECTED' || status === 'TERMINAL_CANCELED') {
      await revertirReembolso(cobro, texto(evento.failure_reason?.message, 200) ?? 'El reembolso no se completó');
      detalle = `Reembolso ${status}`;
    } else {
      detalle = `Reembolso ${status}`;
    }
    await prisma.eventoDatafono.create({ data: { eventId, cobroId: cobro.id, status } }).catch(() => {});
    return { http: 200, detalle };
  }
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
export interface ResumenConciliacionDatafonos { revisados: number; aprobados: number; cerrados: number; pendientes: number; errores: number; reembolsos?: number }

// Reembolsos en curso (se pidieron desde TrendPay y Kushki aún no avisó) y ventas aprobadas que alguien anuló directamente
// en Kushki o en el terminal: el dinero ya salió hacia el comprador y la billetera debe reflejarlo.
export async function conciliarReembolsos(opts: { incluirExternos?: boolean } = {}): Promise<number> {
  const ahora = Date.now();
  let aplicados = 0;

  const enCurso = await prisma.cobroDatafono.findMany({ where: { estado: 'reembolsando' }, include: { terminal: true }, take: 50 });
  for (const cobro of enCurso) {
    try {
      const r = await resolverReembolso(cobro);
      if (r.estado === 'reembolsado') aplicados += 1;
      // Sin rastro de la anulación pasada media hora: se da por no realizada (el cobro sigue aprobado)
      else if (r.estado === 'reembolsando' && ahora - cobro.updatedAt.getTime() > 30 * 60_000) await revertirReembolso(cobro, 'Sin respuesta de Kushki al reembolso');
    } catch (err: any) { logger.error('Error conciliando un reembolso de datáfono', { err: err.message, id: cobro.id }); }
  }

  if (opts.incluirExternos) {
    const aprobados = await prisma.cobroDatafono.findMany({
      where: { estado: 'aprobado', createdAt: { gte: new Date(ahora - 3 * 86_400_000), lte: new Date(ahora - 60_000) } },
      include: { terminal: true }, orderBy: { createdAt: 'desc' }, take: 50,
    });
    for (const cobro of aprobados) {
      try {
        const t = await buscarTransaccion(cobro.terminal.serial, cobro.clientTransactionId);
        if (t?.estado === 'anulada') { await completarReembolso(cobro); aplicados += 1; }
      } catch (err: any) { logger.error('Error buscando anulaciones de datáfono', { err: err.message, id: cobro.id }); }
    }
  }
  return aplicados;
}

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
  if (process.env.NODE_ENV === 'test') return;
  let ciclo = 0;
  const timer = setInterval(() => {
    ciclo += 1;
    conciliarCobrosDatafono().catch((err: any) => logger.error('Falló la conciliación de datáfonos', { err: err.message }));
    // La búsqueda de anulaciones externas es más pesada: cada 30 minutos
    conciliarReembolsos({ incluirExternos: ciclo % 15 === 0 }).catch((err: any) => logger.error('Falló la conciliación de reembolsos', { err: err.message }));
  }, 2 * 60_000);
  timer.unref();
  logger.info('🔁 Conciliación de cobros de datáfono activa (cada 2 minutos)');
}
