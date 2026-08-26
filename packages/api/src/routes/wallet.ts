import { Router, Request, Response } from 'express';
import { z } from 'zod';
import { prisma } from '../index';
import { authenticate } from '../middleware/auth';
import { walletLimiter } from '../middleware/rateLimiter';
import { genCodigo, genQrToken } from '../utils/security';
import { logger } from '../utils/logger';

const router = Router();

const QR_TTL_MS = 30 * 60 * 1000; // 30 minutos

class ApiError extends Error {
  status: number;
  constructor(status: number, mensaje: string) {
    super(mensaje);
    this.status = status;
  }
}

function mapTransaction(t: any) {
  return {
    id: t.id,
    codigo: t.codigo,
    categoria: t.categoria,
    tipo: t.categoria,
    descripcion: t.descripcion,
    montoNeto: Number.parseFloat(t.montoNeto.toString()),
    monto_neto: Number.parseFloat(t.montoNeto.toString()),
    montoBruto: Number.parseFloat(t.montoBruto.toString()),
    monto_bruto: Number.parseFloat(t.montoBruto.toString()),
    status: t.status,
    estado: t.status,
    createdAt: t.createdAt,
    created_at: t.createdAt,
  };
}

// ══ GET /api/wallet/balance ══
router.get('/balance', authenticate, async (req: Request, res: Response) => {
  try {
    const wallet = await prisma.wallet.findUnique({ where: { userId: req.user!.id } });
    if (!wallet) return res.status(404).json({ ok: false, mensaje: 'Billetera no encontrada' });
    res.json({ ok: true, saldo: Number.parseFloat(wallet.saldo.toString()), walletId: wallet.id });
  } catch (err: any) {
    logger.error('Error consultando saldo', { err: err.message, userId: req.user?.id });
    res.status(500).json({ ok: false, mensaje: 'Error consultando saldo' });
  }
});

// ══ GET /api/wallet/history ══
router.get('/history', authenticate, async (req: Request, res: Response) => {
  try {
    const limit = Math.min(Number(req.query.limit) || 20, 100);
    const offset = Number(req.query.offset) || 0;

    const transactions = await prisma.transaction.findMany({
      where: { userId: req.user!.id },
      orderBy: { createdAt: 'desc' },
      take: limit,
      skip: offset,
    });

    res.json({ ok: true, transacciones: transactions.map(mapTransaction) });
  } catch (err: any) {
    logger.error('Error consultando historial', { err: err.message, userId: req.user?.id });
    res.status(500).json({ ok: false, mensaje: 'Error consultando historial' });
  }
});

// ══ POST /api/wallet/enviar ══
const enviarSchema = z.object({
  destino: z.string().min(3).max(120),
  monto: z.number().int().positive().min(1000),
  nota: z.string().max(200).optional(),
});

router.post('/enviar', authenticate, walletLimiter, async (req: Request, res: Response) => {
  const parse = enviarSchema.safeParse(req.body);
  if (!parse.success) {
    return res.status(400).json({ ok: false, mensaje: 'Destino y monto (mínimo $1.000) son requeridos' });
  }
  const { destino, monto, nota } = parse.data;

  try {
    const receptor = await prisma.user.findFirst({
      where: { OR: [{ celular: destino }, { correo: { equals: destino, mode: 'insensitive' } }, { cedula: destino }] },
    });
    if (!receptor) throw new ApiError(404, 'No encontramos un usuario con ese celular, correo o cédula');
    if (receptor.id === req.user!.id) throw new ApiError(400, 'No puedes enviarte dinero a ti mismo');
    if (receptor.bloqueado) throw new ApiError(400, 'El destinatario tiene la cuenta bloqueada');

    const comisionValor = Math.ceil(monto * 0.03);
    const total = monto + comisionValor;
    const codigo = genCodigo('ENV');
    const descripcionEnvio = `Envío a ${receptor.nombre}${nota ? ` · ${nota}` : ''}`;
    const descripcionRecibo = `Recibido de ${req.user!.nombre}${nota ? ` · ${nota}` : ''}`;

    const nuevoSaldo = await prisma.$transaction(async (tx) => {
      const senderWallet = await tx.wallet.findUnique({ where: { userId: req.user!.id } });
      if (!senderWallet) throw new ApiError(404, 'Billetera no encontrada');

      const debit = await tx.wallet.updateMany({
        where: { id: senderWallet.id, saldo: { gte: total } },
        data: { saldo: { decrement: total } },
      });
      if (debit.count === 0) throw new ApiError(400, 'Saldo insuficiente');

      const senderAfter = await tx.wallet.findUnique({ where: { id: senderWallet.id } });
      const senderSaldoDespues = Number.parseFloat(senderAfter!.saldo.toString());
      const senderSaldoAntes = senderSaldoDespues + total;

      const receptorWalletBefore = await tx.wallet.findUnique({ where: { userId: receptor.id } });
      if (!receptorWalletBefore) throw new ApiError(404, 'El destinatario no tiene billetera activa');

      const receptorWalletAfter = await tx.wallet.update({
        where: { id: receptorWalletBefore.id },
        data: { saldo: { increment: monto } },
      });
      const receptorSaldoDespues = Number.parseFloat(receptorWalletAfter.saldo.toString());
      const receptorSaldoAntes = receptorSaldoDespues - monto;

      await tx.transaction.create({
        data: {
          walletId: senderWallet.id,
          userId: req.user!.id,
          codigo,
          categoria: 'envio',
          descripcion: descripcionEnvio,
          montoBruto: monto,
          comisionPct: 3,
          comisionValor,
          montoNeto: -total,
          saldoAntes: senderSaldoAntes,
          saldoDespues: senderSaldoDespues,
          status: 'exitosa',
        },
      });

      await tx.transaction.create({
        data: {
          walletId: receptorWalletBefore.id,
          userId: receptor.id,
          codigo: genCodigo('REC'),
          categoria: 'envio',
          descripcion: descripcionRecibo,
          montoBruto: monto,
          comisionPct: 0,
          comisionValor: 0,
          montoNeto: monto,
          saldoAntes: receptorSaldoAntes,
          saldoDespues: receptorSaldoDespues,
          status: 'exitosa',
        },
      });

      await tx.notification.create({
        data: {
          userId: receptor.id,
          tipo: 'ok',
          titulo: 'Dinero recibido',
          mensaje: `${req.user!.nombre} te envió ${monto.toLocaleString('es-CO')} COP`,
        },
      });

      return senderSaldoDespues;
    });

    logger.info('Envío P2P exitoso', { userId: req.user!.id, receptorId: receptor.id, monto });
    res.json({ ok: true, mensaje: 'Envío realizado', saldo: nuevoSaldo });
  } catch (err: any) {
    if (err instanceof ApiError) return res.status(err.status).json({ ok: false, mensaje: err.message });
    logger.error('Error en envío P2P', { err: err.message, userId: req.user?.id });
    res.status(500).json({ ok: false, mensaje: 'Error procesando el envío' });
  }
});

// ══ POST /api/wallet/qr/generar ══
const qrGenerarSchema = z.object({
  monto: z.number().int().positive().optional(),
  concepto: z.string().max(200).optional(),
});

router.post('/qr/generar', authenticate, walletLimiter, async (req: Request, res: Response) => {
  const parse = qrGenerarSchema.safeParse(req.body);
  if (!parse.success) return res.status(400).json({ ok: false, mensaje: 'Datos de QR inválidos' });

  try {
    const wallet = await prisma.wallet.findUnique({ where: { userId: req.user!.id } });
    if (!wallet) return res.status(404).json({ ok: false, mensaje: 'Billetera no encontrada' });

    const qr = await prisma.qrCode.create({
      data: {
        walletId: wallet.id,
        token: genQrToken(),
        monto: parse.data.monto ?? null,
        concepto: parse.data.concepto ?? null,
        expiresAt: new Date(Date.now() + QR_TTL_MS),
      },
    });

    res.json({
      ok: true,
      qr: {
        token: qr.token,
        monto: qr.monto ? Number.parseFloat(qr.monto.toString()) : null,
        concepto: qr.concepto,
        expiresAt: qr.expiresAt,
      },
    });
  } catch (err: any) {
    logger.error('Error generando QR', { err: err.message, userId: req.user?.id });
    res.status(500).json({ ok: false, mensaje: 'Error generando QR' });
  }
});

// ══ GET /api/wallet/qr/personal ══
// QR fijo y único por usuario: no expira, no se marca "usado" y siempre es de
// monto libre (quien paga decide cuánto). Se crea la primera vez que se pide.
router.get('/qr/personal', authenticate, async (req: Request, res: Response) => {
  try {
    const wallet = await prisma.wallet.findUnique({ where: { userId: req.user!.id } });
    if (!wallet) return res.status(404).json({ ok: false, mensaje: 'Billetera no encontrada' });

    let qr = await prisma.qrCode.findFirst({ where: { walletId: wallet.id, permanente: true } });
    if (!qr) {
      qr = await prisma.qrCode.create({
        data: {
          walletId: wallet.id,
          token: genQrToken(),
          permanente: true,
          expiresAt: new Date('2099-12-31'),
        },
      });
    }

    res.json({ ok: true, qr: { token: qr.token } });
  } catch (err: any) {
    logger.error('Error consultando QR personal', { err: err.message, userId: req.user?.id });
    res.status(500).json({ ok: false, mensaje: 'Error consultando tu QR personal' });
  }
});

// ══ GET /api/wallet/qr/:token ══
router.get('/qr/:token', authenticate, async (req: Request, res: Response) => {
  try {
    const qr = await prisma.qrCode.findUnique({
      where: { token: req.params.token },
      include: { wallet: { include: { user: true } } },
    });
    if (!qr) return res.status(404).json({ ok: false, mensaje: 'QR no encontrado' });

    res.json({
      ok: true,
      qr: {
        monto: qr.monto ? Number.parseFloat(qr.monto.toString()) : null,
        concepto: qr.concepto,
        expiresAt: qr.permanente ? null : qr.expiresAt,
        usado: qr.permanente ? false : qr.usado,
        expirado: qr.permanente ? false : qr.expiresAt < new Date(),
        permanente: qr.permanente,
        esPropio: qr.wallet.userId === req.user!.id,
        propietario: { nombre: qr.wallet.user.nombre },
      },
    });
  } catch (err: any) {
    logger.error('Error consultando QR', { err: err.message, token: req.params.token });
    res.status(500).json({ ok: false, mensaje: 'Error consultando QR' });
  }
});

// ══ POST /api/wallet/qr/:token/pagar ══
const qrPagarSchema = z.object({
  monto: z.number().int().positive().optional(),
});

router.post('/qr/:token/pagar', authenticate, walletLimiter, async (req: Request, res: Response) => {
  const parse = qrPagarSchema.safeParse(req.body);
  if (!parse.success) return res.status(400).json({ ok: false, mensaje: 'Monto inválido' });

  try {
    const nuevoSaldo = await prisma.$transaction(async (tx) => {
      const qr = await tx.qrCode.findUnique({
        where: { token: req.params.token },
        include: { wallet: { include: { user: true } } },
      });
      if (!qr) throw new ApiError(404, 'QR no encontrado');
      if (!qr.permanente) {
        if (qr.usado) throw new ApiError(400, 'Este QR ya fue pagado');
        if (qr.expiresAt < new Date()) throw new ApiError(400, 'Este QR ya expiró');
      }
      if (qr.wallet.userId === req.user!.id) throw new ApiError(400, 'No puedes pagar tu propio QR');

      const monto = qr.monto ? Number.parseFloat(qr.monto.toString()) : parse.data.monto;
      if (!monto || monto <= 0) throw new ApiError(400, 'Este QR requiere que indiques un monto');

      const payerWallet = await tx.wallet.findUnique({ where: { userId: req.user!.id } });
      if (!payerWallet) throw new ApiError(404, 'Billetera no encontrada');

      const debit = await tx.wallet.updateMany({
        where: { id: payerWallet.id, saldo: { gte: monto } },
        data: { saldo: { decrement: monto } },
      });
      if (debit.count === 0) throw new ApiError(400, 'Saldo insuficiente');

      const payerAfter = await tx.wallet.findUnique({ where: { id: payerWallet.id } });
      const payerSaldoDespues = Number.parseFloat(payerAfter!.saldo.toString());
      const payerSaldoAntes = payerSaldoDespues + monto;

      const ownerWalletAfter = await tx.wallet.update({
        where: { id: qr.walletId },
        data: { saldo: { increment: monto } },
      });
      const ownerSaldoDespues = Number.parseFloat(ownerWalletAfter.saldo.toString());
      const ownerSaldoAntes = ownerSaldoDespues - monto;

      if (!qr.permanente) {
        await tx.qrCode.update({ where: { id: qr.id }, data: { usado: true } });
      }

      const codigo = genCodigo('QR');
      const concepto = qr.concepto ? ` · ${qr.concepto}` : '';

      await tx.transaction.create({
        data: {
          walletId: payerWallet.id,
          userId: req.user!.id,
          codigo,
          categoria: 'cobro_qr',
          descripcion: `Pago QR a ${qr.wallet.user.nombre}${concepto}`,
          montoBruto: monto,
          comisionPct: 0,
          comisionValor: 0,
          montoNeto: -monto,
          saldoAntes: payerSaldoAntes,
          saldoDespues: payerSaldoDespues,
          status: 'exitosa',
        },
      });

      await tx.transaction.create({
        data: {
          walletId: qr.walletId,
          userId: qr.wallet.userId,
          codigo: genCodigo('QR'),
          categoria: 'cobro_qr',
          descripcion: `Cobro QR de ${req.user!.nombre}${concepto}`,
          montoBruto: monto,
          comisionPct: 0,
          comisionValor: 0,
          montoNeto: monto,
          saldoAntes: ownerSaldoAntes,
          saldoDespues: ownerSaldoDespues,
          status: 'exitosa',
        },
      });

      await tx.notification.create({
        data: {
          userId: qr.wallet.userId,
          tipo: 'ok',
          titulo: 'Cobro QR recibido',
          mensaje: `${req.user!.nombre} te pagó ${monto.toLocaleString('es-CO')} COP por QR`,
        },
      });

      return payerSaldoDespues;
    });

    logger.info('Pago QR exitoso', { userId: req.user!.id, token: req.params.token });
    res.json({ ok: true, mensaje: 'Pago realizado', saldo: nuevoSaldo });
  } catch (err: any) {
    if (err instanceof ApiError) return res.status(err.status).json({ ok: false, mensaje: err.message });
    logger.error('Error pagando QR', { err: err.message, userId: req.user?.id, token: req.params.token });
    res.status(500).json({ ok: false, mensaje: 'Error procesando el pago' });
  }
});

export default router;
