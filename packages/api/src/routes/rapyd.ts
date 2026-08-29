import express, { Router, Request, Response } from 'express';
import { z } from 'zod';
import { prisma } from '../index';
import { authenticate } from '../middleware/auth';
import { walletLimiter } from '../middleware/rateLimiter';
import { genCodigo } from '../utils/security';
import { createCheckoutPage, getCheckoutPage, verifyWebhookSignature, RapydError } from '../utils/rapyd';
import { logger } from '../utils/logger';

const router = Router();

const FRONTEND_URL = process.env.FRONTEND_URL || 'http://localhost:3000';

// Acredita un RapydPayment pendiente (idempotente) — usado tanto por el webhook
// como por la verificación manual al volver del checkout (fallback si el webhook
// no puede alcanzarnos, p. ej. en desarrollo local sin URL pública).
async function acreditarPago(paymentId: string, rapydPaymentId: string | null) {
  const payment = await prisma.rapydPayment.findUnique({ where: { id: paymentId } });
  if (payment?.estado !== 'pendiente') return payment;

  await prisma.$transaction(async (tx) => {
    const wallet = await tx.wallet.findUnique({ where: { userId: payment.userId } });
    if (!wallet) throw new Error('Billetera no encontrada para el pago Rapyd ' + payment.id);

    const monto = Number.parseFloat(payment.monto.toString());
    const updated = await tx.wallet.update({ where: { id: wallet.id }, data: { saldo: { increment: monto } } });
    const saldoDespues = Number.parseFloat(updated.saldo.toString());

    await tx.transaction.create({
      data: {
        walletId: wallet.id,
        userId: payment.userId,
        codigo: genCodigo('DEP'),
        categoria: 'consigna',
        descripcion: 'Consignación vía Rapyd',
        montoBruto: monto,
        comisionPct: 0,
        comisionValor: 0,
        montoNeto: monto,
        saldoAntes: saldoDespues - monto,
        saldoDespues,
        status: 'exitosa',
      },
    });

    await tx.rapydPayment.update({
      where: { id: payment.id },
      data: { estado: 'completado', rapydPaymentId },
    });

    await tx.notification.create({
      data: {
        userId: payment.userId,
        tipo: 'ok',
        titulo: 'Consignación exitosa',
        mensaje: `Se acreditaron ${monto.toLocaleString('es-CO')} COP a tu billetera`,
      },
    });
  });

  logger.info('Consignación Rapyd acreditada', { reference: payment.reference, paymentId: payment.id });
  return prisma.rapydPayment.findUnique({ where: { id: paymentId } });
}

// ══ POST /api/rapyd/webhook ══
// Debe ir ANTES del express.json() del router: Rapyd firma el body crudo,
// si Express ya lo parseó/re-serializó la firma no coincide nunca.
router.post('/webhook', express.raw({ type: 'application/json' }), async (req: Request, res: Response) => {
  const rawBody = req.body as Buffer;
  const valid = verifyWebhookSignature('/api/rapyd/webhook', rawBody, {
    salt: req.header('salt') || undefined,
    timestamp: req.header('timestamp') || undefined,
    signature: req.header('signature') || undefined,
  });

  if (!valid) {
    logger.warn('Webhook Rapyd con firma inválida');
    return res.status(403).json({ ok: false, mensaje: 'Firma inválida' });
  }

  let event: any;
  try {
    event = JSON.parse(rawBody.toString('utf8'));
  } catch {
    return res.status(400).json({ ok: false, mensaje: 'Body inválido' });
  }

  const type = event.type as string;
  const data = event.data || {};

  try {
    if (type === 'PAYMENT_COMPLETED' || data.status === 'CLO') {
      const reference = data.merchant_reference_id;
      const payment = await prisma.rapydPayment.findUnique({ where: { reference } });
      if (payment) await acreditarPago(payment.id, data.id || null);
    } else if (data.merchant_reference_id) {
      await prisma.rapydPayment.updateMany({
        where: { reference: data.merchant_reference_id, estado: 'pendiente' },
        data: { estado: 'rechazado' },
      });
    }
  } catch (err: any) {
    logger.error('Error procesando webhook Rapyd', { err: err.message, type });
  }

  // Siempre 200 con firma válida para que Rapyd no reintente indefinidamente.
  res.status(200).json({ ok: true });
});

router.use(express.json());

// ══ POST /api/rapyd/consignar ══
const consignarSchema = z.object({
  monto: z.number().int().positive().min(1000),
});

router.post('/consignar', authenticate, walletLimiter, async (req: Request, res: Response) => {
  const parse = consignarSchema.safeParse(req.body);
  if (!parse.success) return res.status(400).json({ ok: false, mensaje: 'Monto inválido (mínimo $1.000)' });

  const { monto } = parse.data;
  const reference = genCodigo('DEP');

  try {
    const wallet = await prisma.wallet.findUnique({ where: { userId: req.user!.id } });
    if (!wallet) return res.status(404).json({ ok: false, mensaje: 'Billetera no encontrada' });

    const checkout = await createCheckoutPage({
      amount: monto,
      currency: 'COP',
      country: 'CO',
      merchantReferenceId: reference,
      completeUrl: `${FRONTEND_URL}/dashboard/consignar/completado?ref=${reference}`,
      errorUrl: `${FRONTEND_URL}/dashboard/consignar?error=1`,
      metadata: { userId: req.user!.id },
    });

    await prisma.rapydPayment.create({
      data: {
        userId: req.user!.id,
        reference,
        checkoutId: checkout.id,
        monto,
        estado: 'pendiente',
      },
    });

    res.json({ ok: true, redirectUrl: checkout.redirect_url });
  } catch (err: any) {
    if (err instanceof RapydError) return res.status(err.status).json({ ok: false, mensaje: err.message });
    logger.error('Error creando consignación Rapyd', { err: err.message, userId: req.user?.id });
    res.status(500).json({ ok: false, mensaje: 'Error creando la consignación' });
  }
});

// ══ GET /api/rapyd/verificar/:reference ══
// Fallback cuando el webhook no puede alcanzarnos (p. ej. desarrollo local sin
// URL pública): al volver del checkout, consultamos directamente a Rapyd el
// estado real del pago y acreditamos si ya está pagado.
router.get('/verificar/:reference', authenticate, async (req: Request, res: Response) => {
  try {
    let payment = await prisma.rapydPayment.findUnique({ where: { reference: req.params.reference } });
    if (payment?.userId !== req.user!.id) {
      return res.status(404).json({ ok: false, mensaje: 'Consignación no encontrada' });
    }

    if (payment.estado === 'pendiente' && payment.checkoutId) {
      const checkout = await getCheckoutPage(payment.checkoutId);

      if (checkout.payment?.paid) {
        payment = (await acreditarPago(payment.id, checkout.payment.id))!;
      } else if (checkout.status === 'EXP' || checkout.status === 'DEC') {
        payment = await prisma.rapydPayment.update({ where: { id: payment.id }, data: { estado: 'rechazado' } });
      }
    }

    const wallet = await prisma.wallet.findUnique({ where: { userId: req.user!.id } });
    const saldo = Number.parseFloat(wallet?.saldo.toString() || '0');
    res.json({ ok: true, estado: payment.estado, saldo });
  } catch (err: any) {
    if (err instanceof RapydError) return res.status(err.status).json({ ok: false, mensaje: err.message });
    logger.error('Error verificando consignación Rapyd', { err: err.message, reference: req.params.reference });
    res.status(500).json({ ok: false, mensaje: 'Error verificando la consignación' });
  }
});

export default router;
