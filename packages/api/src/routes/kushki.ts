import { Router, Request, Response } from 'express';
import { z } from 'zod';
import { prisma } from '../index';
import { authenticate } from '../middleware/auth';
import { walletLimiter } from '../middleware/rateLimiter';
import { genCodigo } from '../utils/security';
import { chargeCardToken, KushkiError } from '../utils/kushki';
import { logger } from '../utils/logger';

const router = Router();

// ══ POST /api/kushki/consignar/tarjeta ══
// El frontend tokeniza la tarjeta en el navegador con Kushki.js
// (kushki.requestToken) y solo nos manda el token de un solo uso — nunca
// vemos el número de tarjeta. El cobro es síncrono: aprobado o rechazado
// en la misma respuesta, sin necesidad de webhook para este flujo.
const consignarSchema = z.object({
  token: z.string().min(10),
  monto: z.number().int().positive().min(1000),
});

router.post('/consignar/tarjeta', authenticate, walletLimiter, async (req: Request, res: Response) => {
  const parse = consignarSchema.safeParse(req.body);
  if (!parse.success) return res.status(400).json({ ok: false, mensaje: 'Datos de pago inválidos' });

  const { token, monto } = parse.data;
  const reference = genCodigo('DEP');

  try {
    const wallet = await prisma.wallet.findUnique({ where: { userId: req.user!.id } });
    if (!wallet) return res.status(404).json({ ok: false, mensaje: 'Billetera no encontrada' });

    const charge = await chargeCardToken(token, monto);

    const saldo = await prisma.$transaction(async (tx) => {
      const updated = await tx.wallet.update({ where: { id: wallet.id }, data: { saldo: { increment: monto } } });
      const saldoDespues = Number.parseFloat(updated.saldo.toString());

      await tx.transaction.create({
        data: {
          walletId: wallet.id,
          userId: req.user!.id,
          codigo: genCodigo('DEP'),
          categoria: 'consigna',
          descripcion: 'Consignación con tarjeta vía Kushki',
          montoBruto: monto,
          comisionPct: 0,
          comisionValor: 0,
          montoNeto: monto,
          saldoAntes: saldoDespues - monto,
          saldoDespues,
          status: 'exitosa',
        },
      });

      await tx.kushkiPayment.create({
        data: {
          userId: req.user!.id,
          reference,
          metodo: 'tarjeta',
          ticketNumber: charge.ticketNumber,
          monto,
          estado: 'completado',
        },
      });

      await tx.notification.create({
        data: {
          userId: req.user!.id,
          tipo: 'ok',
          titulo: 'Consignación exitosa',
          mensaje: `Se acreditaron ${monto.toLocaleString('es-CO')} COP a tu billetera`,
        },
      });

      return saldoDespues;
    });

    logger.info('Consignación con tarjeta acreditada', { reference, ticketNumber: charge.ticketNumber, userId: req.user!.id });
    res.json({ ok: true, saldo });
  } catch (err: any) {
    if (err instanceof KushkiError) {
      await prisma.kushkiPayment.create({
        data: { userId: req.user!.id, reference, metodo: 'tarjeta', monto, estado: 'rechazado' },
      }).catch(() => {});
      return res.status(402).json({ ok: false, mensaje: err.message });
    }
    logger.error('Error procesando consignación con tarjeta', { err: err.message, userId: req.user?.id });
    res.status(500).json({ ok: false, mensaje: 'Error procesando el pago' });
  }
});

export default router;
