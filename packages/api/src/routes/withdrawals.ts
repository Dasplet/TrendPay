import { Router, Request, Response } from 'express';
import { z } from 'zod';
import { prisma } from '../index';
import { authenticate, requireAdmin } from '../middleware/auth';
import { walletLimiter } from '../middleware/rateLimiter';
import { encrypt, decrypt, maskAccount, genCodigo } from '../utils/security';
import { logger } from '../utils/logger';
import { conCuenta, miembrosDe, saldoVisible } from '../utils/cuentas';
import { dispersionHabilitada, iniciarDispersion, getPayoutDetalle, mensajeKushki, KushkiError } from '../utils/kushki';
import { anexarRespuesta, completarRetiro, revertirRetiro, resolverRetiroEnProceso, EstadoRetiro } from '../utils/retiros';

const router = Router();

class ApiError extends Error {
  status: number;
  constructor(status: number, mensaje: string) {
    super(mensaje);
    this.status = status;
  }
}

async function getConfigNumber(clave: string, fallback: number): Promise<number> {
  const cfg = await prisma.config.findUnique({ where: { clave } });
  return cfg ? Number.parseFloat(cfg.valor) : fallback;
}

function mapWithdrawal(w: any, opts: { mask?: boolean } = {}) {
  const cuenta = decrypt(w.numeroCuenta);
  const monto = Number.parseFloat(w.monto.toString());
  const montoNeto = Number.parseFloat(w.montoNeto.toString());
  return { id: w.id, banco_nombre: w.bancoNombre, tipo_cuenta: w.tipoCuenta, nombre_titular: w.nombreTitular, cedula_titular: decrypt(w.cedulaTitular), numero_cuenta: opts.mask ? undefined : cuenta, numero_cuenta_masked: opts.mask ? maskAccount(cuenta) : undefined, monto, monto_neto: montoNeto, status: w.status, motivo: w.motivo, notas_admin: w.notasAdmin, payout_ticket: w.payoutTicket, usuario_nombre: w.user?.nombre, usuario_cedula: w.user?.cedula, created_at: w.createdAt, aprobado_at: w.aprobadoAt };
}

// ══ POST /api/withdrawals ══
const crearSchema = z.object({
  bancoNombre: z.string().min(2).max(120),
  tipoCuenta: z.string().min(2).max(40),
  numeroCuenta: z.string().min(4).max(40),
  cedulaTitular: z.string().min(4).max(30),
  nombreTitular: z.string().min(3).max(200),
  monto: z.number().int().positive(),
});

router.post('/', authenticate, walletLimiter, conCuenta('retirar'), async (req: Request, res: Response) => {
  const parse = crearSchema.safeParse(req.body);
  if (!parse.success) return res.status(400).json({ ok: false, mensaje: 'Datos de retiro incompletos o inválidos' });
  const { bancoNombre, tipoCuenta, numeroCuenta, cedulaTitular, nombreTitular, monto } = parse.data;

  try {
    const [minimo, limiteDiario] = await Promise.all([
      getConfigNumber('monto_minimo_retiro', 10000),
      getConfigNumber('limite_diario', 3000000),
    ]);

    if (monto < minimo) {
      return res.status(400).json({ ok: false, mensaje: `El monto mínimo de retiro es ${minimo.toLocaleString('es-CO')} COP` });
    }

    const hoy = new Date();
    hoy.setHours(0, 0, 0, 0);
    // El límite diario es por billetera: cuenta los retiros de todas las
    // subcuentas que la comparten.
    const miembros = await miembrosDe(req.cuenta!.titularId);
    const retiradoHoy = await prisma.withdrawal.aggregate({
      where: { userId: { in: miembros }, createdAt: { gte: hoy }, status: { in: ['pendiente', 'en_proceso', 'procesado'] } },
      _sum: { monto: true },
    });
    const totalHoy = Number.parseFloat(retiradoHoy._sum.monto?.toString() || '0') + monto;
    if (totalHoy > limiteDiario) {
      return res.status(400).json({ ok: false, mensaje: `Superas el límite diario de retiro (${limiteDiario.toLocaleString('es-CO')} COP)` });
    }

    const nuevoSaldo = await prisma.$transaction(async (tx) => {
      const wallet = await tx.wallet.findUnique({ where: { userId: req.cuenta!.titularId } });
      if (!wallet) throw new ApiError(404, 'Billetera no encontrada');

      const debit = await tx.wallet.updateMany({
        where: { id: wallet.id, saldo: { gte: monto } },
        data: { saldo: { decrement: monto } },
      });
      if (debit.count === 0) throw new ApiError(400, 'Saldo insuficiente');

      const walletAfter = await tx.wallet.findUnique({ where: { id: wallet.id } });
      const saldoDespues = Number.parseFloat(walletAfter!.saldo.toString());
      const saldoAntes = saldoDespues + monto;

      const withdrawal = await tx.withdrawal.create({
        data: {
          userId: req.user!.id,
          bancoNombre,
          tipoCuenta,
          nombreTitular,
          numeroCuenta: encrypt(numeroCuenta),
          cedulaTitular: encrypt(cedulaTitular),
          monto,
          montoNeto: monto,
          status: 'pendiente',
        },
      });

      await tx.transaction.create({
        data: {
          walletId: wallet.id,
          userId: req.user!.id,
          codigo: genCodigo('RET'),
          categoria: 'retiro',
          descripcion: `Retiro a ${bancoNombre}`,
          montoBruto: monto,
          comisionPct: 0,
          comisionValor: 0,
          montoNeto: -monto,
          saldoAntes,
          saldoDespues,
          status: 'pendiente',
          metadata: { withdrawalId: withdrawal.id },
        },
      });

      return saldoDespues;
    });

    logger.info('Retiro solicitado', { userId: req.user!.id, monto });
    res.status(201).json({ ok: true, mensaje: 'Solicitud de retiro creada · se envía por transferencia ACH', saldo: saldoVisible(req.cuenta, nuevoSaldo) });
  } catch (err: any) {
    if (err instanceof ApiError) return res.status(err.status).json({ ok: false, mensaje: err.message });
    logger.error('Error creando retiro', { err: err.message, userId: req.user?.id });
    res.status(500).json({ ok: false, mensaje: 'Error creando el retiro' });
  }
});

// ══ GET /api/withdrawals/me ══
router.get('/me', authenticate, conCuenta(), async (req: Request, res: Response) => {
  try {
    const miembros = await miembrosDe(req.cuenta!.titularId);
    const withdrawals = await prisma.withdrawal.findMany({
      where: { userId: { in: miembros } },
      orderBy: { createdAt: 'desc' },
      take: 100,
    });
    res.json({ ok: true, retiros: withdrawals.map((w) => mapWithdrawal(w, { mask: true })) });
  } catch (err: any) {
    logger.error('Error consultando retiros propios', { err: err.message, userId: req.user?.id });
    res.status(500).json({ ok: false, mensaje: 'Error consultando retiros' });
  }
});

// ══ GET /api/withdrawals/pending ══
router.get('/pending', authenticate, requireAdmin, async (_req: Request, res: Response) => {
  try {
    const withdrawals = await prisma.withdrawal.findMany({
      where: { status: 'pendiente' },
      orderBy: { createdAt: 'asc' },
      include: { user: { select: { nombre: true, cedula: true } } },
    });
    res.json({ ok: true, ach: dispersionHabilitada(), retiros: withdrawals.map((w) => mapWithdrawal(w)) });
  } catch (err: any) {
    logger.error('Error consultando retiros pendientes', { err: err.message });
    res.status(500).json({ ok: false, mensaje: 'Error consultando retiros pendientes' });
  }
});

// ══ GET /api/withdrawals ══ (admin — todos, para el historial del panel)
router.get('/', authenticate, requireAdmin, async (req: Request, res: Response) => {
  try {
    const limit = Number.parseInt(req.query.limit as string) || 200;
    const withdrawals = await prisma.withdrawal.findMany({
      orderBy: { createdAt: 'desc' },
      take: limit,
      include: { user: { select: { nombre: true, cedula: true } } },
    });
    res.json({ ok: true, retiros: withdrawals.map((w) => mapWithdrawal(w, { mask: true })) });
  } catch (err: any) {
    logger.error('Error consultando retiros', { err: err.message });
    res.status(500).json({ ok: false, mensaje: 'Error consultando retiros' });
  }
});

// ══ GET /api/withdrawals/:id/kushki ══ (admin — estado en vivo de la dispersión)
router.get('/:id/kushki', authenticate, requireAdmin, async (req: Request, res: Response) => {
  try {
    const withdrawal = await prisma.withdrawal.findUnique({ where: { id: req.params.id } });
    if (!withdrawal) return res.status(404).json({ ok: false, mensaje: 'Retiro no encontrado' });
    if (!withdrawal.payoutTicket) return res.status(404).json({ ok: false, mensaje: 'Este retiro no se envió por Kushki' });

    const detalle = await getPayoutDetalle(withdrawal.payoutTicket);
    res.json({ ok: true, ticket: withdrawal.payoutTicket, referencia: withdrawal.payoutReference, ...detalle });
  } catch (err: any) {
    const status = err instanceof KushkiError ? err.status : 500;
    logger.error('Error consultando dispersión en Kushki', { err: err.message, id: req.params.id });
    res.status(status).json({ ok: false, mensaje: err.message || 'Error consultando Kushki' });
  }
});

// ══ GET /api/withdrawals/:id/respuestas ══ (admin — historial de respuestas de Kushki guardadas)
router.get('/:id/respuestas', authenticate, requireAdmin, async (req: Request, res: Response) => {
  try {
    const withdrawal = await prisma.withdrawal.findUnique({ where: { id: req.params.id } });
    if (!withdrawal) return res.status(404).json({ ok: false, mensaje: 'Retiro no encontrado' });
    res.json({
      ok: true,
      ticket: withdrawal.payoutTicket,
      referencia: withdrawal.payoutReference,
      respuestas: Array.isArray(withdrawal.payoutRespuestas) ? withdrawal.payoutRespuestas : [],
    });
  } catch (err: any) {
    logger.error('Error consultando respuestas de Kushki', { err: err.message, id: req.params.id });
    res.status(500).json({ ok: false, mensaje: 'Error consultando las respuestas' });
  }
});

// ══ PUT /api/withdrawals/:id/approve ══
// Con KUSHKI_PAYOUTS_ENABLED el retiro se envía por Kushki (dispersión ACH) y
// queda "en_proceso" hasta que el banco responde; sin él, el admin transfiere a
// mano y esto solo lo marca como procesado. Un retiro "en_proceso" sin ticket
// (envío que no se pudo confirmar) también se cierra a mano.
router.put('/:id/approve', authenticate, requireAdmin, async (req: Request, res: Response) => {
  try {
    const withdrawal = await prisma.withdrawal.findUnique({ where: { id: req.params.id } });
    if (!withdrawal) return res.status(404).json({ ok: false, mensaje: 'Retiro no encontrado' });
    if (withdrawal.status === 'en_proceso' && withdrawal.payoutTicket) {
      return res.status(400).json({ ok: false, mensaje: 'Este retiro ya fue enviado por Kushki y está esperando al banco' });
    }
    if (withdrawal.status !== 'pendiente' && withdrawal.status !== 'en_proceso') {
      return res.status(400).json({ ok: false, mensaje: 'Este retiro ya fue procesado' });
    }

    // manual: el admin ya transfirió por su cuenta (banco no soportado, Kushki caído, etc.)
    if (withdrawal.status === 'en_proceso' || req.body?.manual === true || !dispersionHabilitada()) {
      const ok = await prisma.$transaction((tx) => completarRetiro(tx, withdrawal, { desde: ['pendiente', 'en_proceso'], actorId: req.user!.id, ip: req.ip }));
      if (!ok) return res.status(400).json({ ok: false, mensaje: 'Este retiro ya fue procesado' });
      return res.json({ ok: true, mensaje: 'Retiro aprobado' });
    }

    // Se reclama antes de llamar a Kushki para que dos clics seguidos no envíen el dinero dos veces.
    const reclamo = await prisma.withdrawal.updateMany({
      where: { id: withdrawal.id, status: 'pendiente' },
      data: { status: 'en_proceso', aprobadoPor: req.user!.id, aprobadoAt: new Date() },
    });
    if (reclamo.count === 0) return res.status(400).json({ ok: false, mensaje: 'Este retiro ya fue procesado' });

    let envio;
    try {
      envio = await iniciarDispersion({
        bancoNombre: withdrawal.bancoNombre,
        tipoCuenta: withdrawal.tipoCuenta,
        numeroCuenta: decrypt(withdrawal.numeroCuenta),
        cedulaTitular: decrypt(withdrawal.cedulaTitular),
        monto: Number.parseFloat(withdrawal.montoNeto.toString()),
      });
    } catch (err: any) {
      const definitivo = err instanceof KushkiError && err.status < 500;
      logger.error('Error iniciando dispersión de retiro', { err: err.message, id: withdrawal.id, definitivo, respuesta: err.respuesta });
      const explicacion = err instanceof KushkiError ? mensajeKushki(err) : err.message;
      if (err instanceof KushkiError && err.respuesta) await anexarRespuesta(withdrawal.id, 'error', err.respuesta);
      if (definitivo) {
        // Kushki rechazó la petición: no salió dinero, el retiro vuelve a la cola.
        await prisma.withdrawal.updateMany({
          where: { id: withdrawal.id, status: 'en_proceso', payoutTicket: null },
          data: { status: 'pendiente', aprobadoPor: null, aprobadoAt: null, notasAdmin: `Kushki: ${explicacion}` },
        });
        return res.status(422).json({ ok: false, mensaje: `${explicacion}. El retiro sigue pendiente; puedes transferirlo a mano.` });
      }
      // Sin respuesta: no se sabe si Kushki lo recibió. Se deja en proceso, sin reintentar solo.
      await prisma.withdrawal.update({ where: { id: withdrawal.id }, data: { notasAdmin: `Envío sin confirmar (${explicacion}). Verifica en el panel de Kushki.` } });
      return res.status(502).json({ ok: false, mensaje: 'No se pudo confirmar el envío con Kushki. Revísalo en el panel de Kushki antes de reintentar.' });
    }

    const enviado = await prisma.withdrawal.update({
      where: { id: withdrawal.id },
      data: { payoutTicket: envio.ticketNumber, payoutReference: envio.transactionReference },
    });
    await anexarRespuesta(withdrawal.id, 'init', envio.respuestas);
    await prisma.auditLog.create({ data: { userId: req.user!.id, accion: 'RETIRO_DISPERSION_INICIADA', tabla: 'withdrawals', registroId: withdrawal.id, ip: req.ip || null, datos: { monto: Number.parseFloat(withdrawal.monto.toString()), banco: withdrawal.bancoNombre, ticket: envio.ticketNumber } } });

    let estado: EstadoRetiro = 'en_proceso';
    try {
      estado = await resolverRetiroEnProceso(enviado);
    } catch (err: any) {
      logger.warn('No se pudo consultar el estado de la dispersión; la conciliación lo reintentará', { err: err.message, id: withdrawal.id });
    }

    const mensajes: Record<EstadoRetiro, string> = {
      procesado: 'Retiro enviado y confirmado por el banco',
      rechazado: 'El banco rechazó el envío · saldo devuelto al usuario',
      en_proceso: 'Envío iniciado en Kushki · el banco lo confirmará en breve (hasta 72 h hábiles)',
    };
    res.json({ ok: true, estado, mensaje: mensajes[estado] });
  } catch (err: any) {
    logger.error('Error aprobando retiro', { err: err.message, id: req.params.id });
    res.status(500).json({ ok: false, mensaje: 'Error aprobando el retiro' });
  }
});

// ══ PUT /api/withdrawals/:id/reject ══
const rejectSchema = z.object({ motivo: z.string().max(300).optional() });

router.put('/:id/reject', authenticate, requireAdmin, async (req: Request, res: Response) => {
  const parse = rejectSchema.safeParse(req.body);
  const motivo = (parse.success ? parse.data.motivo : undefined) || 'Rechazado por administrador';

  try {
    const withdrawal = await prisma.withdrawal.findUnique({ where: { id: req.params.id } });
    if (!withdrawal) return res.status(404).json({ ok: false, mensaje: 'Retiro no encontrado' });
    if (withdrawal.status === 'en_proceso' && withdrawal.payoutTicket) {
      return res.status(400).json({ ok: false, mensaje: 'Este retiro ya fue enviado por Kushki; el banco definirá si se devuelve el saldo' });
    }
    if (withdrawal.status !== 'pendiente' && withdrawal.status !== 'en_proceso') {
      return res.status(400).json({ ok: false, mensaje: 'Este retiro ya fue procesado' });
    }

    const ok = await prisma.$transaction((tx) => revertirRetiro(tx, withdrawal, { desde: ['pendiente', 'en_proceso'], motivo, actorId: req.user!.id, ip: req.ip }));
    if (!ok) return res.status(400).json({ ok: false, mensaje: 'Este retiro ya fue procesado' });

    res.json({ ok: true, mensaje: 'Retiro rechazado · saldo revertido' });
  } catch (err: any) {
    logger.error('Error rechazando retiro', { err: err.message, id: req.params.id });
    res.status(500).json({ ok: false, mensaje: 'Error rechazando el retiro' });
  }
});

export default router;
