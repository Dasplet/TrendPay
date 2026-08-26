import { Router, Request, Response } from 'express';
import { z } from 'zod';
import { prisma } from '../index';
import { authenticate, requireAdmin } from '../middleware/auth';
import { walletLimiter } from '../middleware/rateLimiter';
import { encrypt, decrypt, maskAccount, genCodigo } from '../utils/security';
import { logger } from '../utils/logger';

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
  return { id: w.id, banco_nombre: w.bancoNombre, tipo_cuenta: w.tipoCuenta, nombre_titular: w.nombreTitular, cedula_titular: decrypt(w.cedulaTitular), numero_cuenta: opts.mask ? undefined : cuenta, numero_cuenta_masked: opts.mask ? maskAccount(cuenta) : undefined, monto, monto_neto: montoNeto, status: w.status, motivo: w.motivo, usuario_nombre: w.user?.nombre, usuario_cedula: w.user?.cedula, created_at: w.createdAt, aprobado_at: w.aprobadoAt };
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

router.post('/', authenticate, walletLimiter, async (req: Request, res: Response) => {
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
    const retiradoHoy = await prisma.withdrawal.aggregate({
      where: { userId: req.user!.id, createdAt: { gte: hoy }, status: { in: ['pendiente', 'procesado'] } },
      _sum: { monto: true },
    });
    const totalHoy = Number.parseFloat(retiradoHoy._sum.monto?.toString() || '0') + monto;
    if (totalHoy > limiteDiario) {
      return res.status(400).json({ ok: false, mensaje: `Superas el límite diario de retiro (${limiteDiario.toLocaleString('es-CO')} COP)` });
    }

    const nuevoSaldo = await prisma.$transaction(async (tx) => {
      const wallet = await tx.wallet.findUnique({ where: { userId: req.user!.id } });
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
    res.status(201).json({ ok: true, mensaje: 'Solicitud de retiro creada · será procesada por un administrador', saldo: nuevoSaldo });
  } catch (err: any) {
    if (err instanceof ApiError) return res.status(err.status).json({ ok: false, mensaje: err.message });
    logger.error('Error creando retiro', { err: err.message, userId: req.user?.id });
    res.status(500).json({ ok: false, mensaje: 'Error creando el retiro' });
  }
});

// ══ GET /api/withdrawals/me ══
router.get('/me', authenticate, async (req: Request, res: Response) => {
  try {
    const withdrawals = await prisma.withdrawal.findMany({
      where: { userId: req.user!.id },
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
    res.json({ ok: true, retiros: withdrawals.map((w) => mapWithdrawal(w)) });
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

// ══ PUT /api/withdrawals/:id/approve ══
router.put('/:id/approve', authenticate, requireAdmin, async (req: Request, res: Response) => {
  try {
    const withdrawal = await prisma.withdrawal.findUnique({ where: { id: req.params.id } });
    if (!withdrawal) return res.status(404).json({ ok: false, mensaje: 'Retiro no encontrado' });
    if (withdrawal.status !== 'pendiente') return res.status(400).json({ ok: false, mensaje: 'Este retiro ya fue procesado' });

    await prisma.$transaction(async (tx) => {
      await tx.withdrawal.update({
        where: { id: withdrawal.id },
        data: { status: 'procesado', aprobadoPor: req.user!.id, aprobadoAt: new Date() },
      });
      await tx.transaction.updateMany({
        where: { metadata: { path: ['withdrawalId'], equals: withdrawal.id } },
        data: { status: 'exitosa' },
      });
      const montoAprobado = Number.parseFloat(withdrawal.monto.toString());
      await tx.auditLog.create({ data: { userId: req.user!.id, accion: 'RETIRO_APROBADO', tabla: 'withdrawals', registroId: withdrawal.id, ip: req.ip || null, datos: { monto: montoAprobado, banco: withdrawal.bancoNombre, antes: { status: 'pendiente' }, despues: { status: 'procesado' } } } });
    });

    res.json({ ok: true, mensaje: 'Retiro aprobado' });
  } catch (err: any) {
    logger.error('Error aprobando retiro', { err: err.message, id: req.params.id });
    res.status(500).json({ ok: false, mensaje: 'Error aprobando el retiro' });
  }
});

// ══ PUT /api/withdrawals/:id/reject ══
const rejectSchema = z.object({ motivo: z.string().max(300).optional() });

router.put('/:id/reject', authenticate, requireAdmin, async (req: Request, res: Response) => {
  const parse = rejectSchema.safeParse(req.body);
  const motivo = parse.success ? parse.data.motivo : undefined;

  try {
    const withdrawal = await prisma.withdrawal.findUnique({ where: { id: req.params.id } });
    if (!withdrawal) return res.status(404).json({ ok: false, mensaje: 'Retiro no encontrado' });
    if (withdrawal.status !== 'pendiente') return res.status(400).json({ ok: false, mensaje: 'Este retiro ya fue procesado' });

    await prisma.$transaction(async (tx) => {
      const wallet = await tx.wallet.findUnique({ where: { userId: withdrawal.userId } });
      if (!wallet) throw new Error('Billetera no encontrada');

      const monto = Number.parseFloat(withdrawal.monto.toString());
      const walletAfter = await tx.wallet.update({ where: { id: wallet.id }, data: { saldo: { increment: monto } } });
      const saldoDespues = Number.parseFloat(walletAfter.saldo.toString());

      await tx.withdrawal.update({
        where: { id: withdrawal.id },
        data: { status: 'rechazado', notasAdmin: motivo || 'Rechazado por administrador', aprobadoPor: req.user!.id, aprobadoAt: new Date() },
      });

      await tx.transaction.create({
        data: {
          walletId: wallet.id,
          userId: withdrawal.userId,
          codigo: genCodigo('REV'),
          categoria: 'retiro',
          descripcion: `Reverso de retiro rechazado · ${withdrawal.bancoNombre}`,
          montoBruto: monto,
          comisionPct: 0,
          comisionValor: 0,
          montoNeto: monto,
          saldoAntes: saldoDespues - monto,
          saldoDespues,
          status: 'exitosa',
        },
      });

      await tx.notification.create({
        data: {
          userId: withdrawal.userId,
          tipo: 'warning',
          titulo: 'Retiro rechazado',
          mensaje: `Tu retiro de ${monto.toLocaleString('es-CO')} COP fue rechazado y el saldo fue devuelto a tu billetera`,
        },
      });

      await tx.auditLog.create({
        data: { userId: req.user!.id, accion: 'RETIRO_RECHAZADO', tabla: 'withdrawals', registroId: withdrawal.id, ip: req.ip || null,
          datos: { motivo, monto, banco: withdrawal.bancoNombre, antes: { status: 'pendiente' }, despues: { status: 'rechazado' } } },
      });
    });

    res.json({ ok: true, mensaje: 'Retiro rechazado · saldo revertido' });
  } catch (err: any) {
    logger.error('Error rechazando retiro', { err: err.message, id: req.params.id });
    res.status(500).json({ ok: false, mensaje: 'Error rechazando el retiro' });
  }
});

export default router;
