import { Router, Request, Response } from 'express';
import { z } from 'zod';
import { prisma } from '../index';
import { authenticate } from '../middleware/auth';
import { walletLimiter } from '../middleware/rateLimiter';
import { genCodigo } from '../utils/security';
import { chargeCardToken, initTransfer, getTransferStatus, KushkiError } from '../utils/kushki';
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

// ══ POST /api/kushki/consignar/pse/iniciar ══
// El frontend obtiene un token de transferencia con Kushki.js
// (kushki.requestTransferToken) y nos lo manda junto con los datos de
// contacto. A diferencia de la tarjeta, este paso no cobra nada: solo abre
// la transacción en Kushki y nos da una redirectUrl a la que el navegador
// debe ir para que el usuario autorice el débito en su banco (PSE).
const pseIniciarSchema = z.object({
  token: z.string().min(10),
  monto: z.number().int().positive().min(1000),
  documentType: z.enum(['CC', 'NIT', 'CE', 'TI', 'PP']),
  documentNumber: z.string().min(5).max(20),
  email: z.string().email(),
  nombreCompleto: z.string().min(3).max(100),
  telefono: z.string().optional(),
});

router.post('/consignar/pse/iniciar', authenticate, walletLimiter, async (req: Request, res: Response) => {
  const parse = pseIniciarSchema.safeParse(req.body);
  if (!parse.success) return res.status(400).json({ ok: false, mensaje: 'Datos de pago inválidos' });

  const { token, monto, nombreCompleto, email, telefono } = parse.data;

  try {
    const wallet = await prisma.wallet.findUnique({ where: { userId: req.user!.id } });
    if (!wallet) return res.status(404).json({ ok: false, mensaje: 'Billetera no encontrada' });

    const init = await initTransfer(token, monto, { fullName: nombreCompleto, email, phoneNumber: telefono });

    await prisma.kushkiPayment.create({
      data: { userId: req.user!.id, reference: token, metodo: 'pse', monto, estado: 'pendiente' },
    });

    logger.info('PSE iniciado', { token, transactionReference: init.transactionReference, userId: req.user!.id });
    res.json({ ok: true, redirectUrl: init.redirectUrl });
  } catch (err: any) {
    if (err instanceof KushkiError) return res.status(402).json({ ok: false, mensaje: err.message });
    logger.error('Error iniciando PSE', { err: err.message, userId: req.user?.id });
    res.status(500).json({ ok: false, mensaje: 'Error iniciando el pago' });
  }
});

// ══ POST /api/kushki/consignar/pse/confirmar ══
// Se llama cuando el usuario vuelve del banco (Kushki redirige el navegador
// al callbackUrl con ?token=...). En vez de confiar en ese redirect —
// cualquiera podría llamar a esta ruta con un token ajeno — siempre se
// verifica el estado real consultando a Kushki con la Private-Merchant-Id
// antes de acreditar saldo. Es idempotente: si el pago ya se resolvió,
// devuelve el estado guardado sin volver a tocar la billetera.
const pseConfirmarSchema = z.object({ token: z.string().min(10) });

router.post('/consignar/pse/confirmar', authenticate, walletLimiter, async (req: Request, res: Response) => {
  const parse = pseConfirmarSchema.safeParse(req.body);
  if (!parse.success) return res.status(400).json({ ok: false, mensaje: 'Token inválido' });

  const { token } = parse.data;

  try {
    const pago = await prisma.kushkiPayment.findUnique({ where: { reference: token } });
    if (!pago || pago.userId !== req.user!.id) return res.status(404).json({ ok: false, mensaje: 'Pago no encontrado' });

    if (pago.estado !== 'pendiente') {
      return res.json({ ok: true, estado: pago.estado });
    }

    const status = await getTransferStatus(token);

    if (status.estado === 'pendiente') {
      return res.json({ ok: true, estado: 'pendiente' });
    }

    if (status.estado === 'rechazada') {
      await prisma.kushkiPayment.update({ where: { id: pago.id }, data: { estado: 'rechazado' } });
      return res.json({ ok: true, estado: 'rechazado' });
    }

    const wallet = await prisma.wallet.findUnique({ where: { userId: req.user!.id } });
    if (!wallet) return res.status(404).json({ ok: false, mensaje: 'Billetera no encontrada' });

    const monto = Number(pago.monto);
    const saldo = await prisma.$transaction(async (tx) => {
      const updated = await tx.wallet.update({ where: { id: wallet.id }, data: { saldo: { increment: monto } } });
      const saldoDespues = Number.parseFloat(updated.saldo.toString());

      await tx.transaction.create({
        data: {
          walletId: wallet.id,
          userId: req.user!.id,
          codigo: genCodigo('DEP'),
          categoria: 'consigna',
          descripcion: 'Consignación PSE vía Kushki',
          montoBruto: monto,
          comisionPct: 0,
          comisionValor: 0,
          montoNeto: monto,
          saldoAntes: saldoDespues - monto,
          saldoDespues,
          status: 'exitosa',
        },
      });

      await tx.kushkiPayment.update({ where: { id: pago.id }, data: { estado: 'completado', ticketNumber: status.ticketNumber } });

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

    logger.info('Consignación con PSE acreditada', { token, ticketNumber: status.ticketNumber, userId: req.user!.id });
    res.json({ ok: true, estado: 'completado', saldo });
  } catch (err: any) {
    if (err instanceof KushkiError) return res.status(502).json({ ok: false, mensaje: err.message });
    logger.error('Error confirmando PSE', { err: err.message, userId: req.user?.id });
    res.status(500).json({ ok: false, mensaje: 'Error confirmando el pago' });
  }
});

export default router;
