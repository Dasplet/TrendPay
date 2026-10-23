import { Router, Request, Response } from 'express';
import { z } from 'zod';
import { prisma } from '../index';
import { authenticate } from '../middleware/auth';
import { walletLimiter } from '../middleware/rateLimiter';
import { genCodigo } from '../utils/security';
import { chargeCardToken, initTransfer, KushkiError } from '../utils/kushki';
import { resolverPagoPse } from '../utils/kushkiPayments';
import { anexarRespuesta, resolverRetiroEnProceso } from '../utils/retiros';
import { firmaKushkiValida, sanitizarWebhook } from '../utils/kushkiWebhook';
import { logger } from '../utils/logger';
import { conCuenta, miembrosDe, saldoVisible } from '../utils/cuentas';

const router = Router();

// ══ POST /api/kushki/webhooks/payout ══
// Aviso de Kushki cuando una dispersión (ACH o Bre-B) queda aprobada o
// rechazada. No lleva sesión: se autentica con la firma HMAC de Kushki. Kushki
// reintenta hasta 7 veces en 3 horas si no recibe 200/201, así que los
// resultados "temporales" (aún no guardamos el ticket, error al consultar) se
// devuelven con error para que reintente, y los duplicados son inofensivos
// porque resolverRetiroEnProceso solo actúa sobre retiros "en_proceso".
// El estado final se confirma consultando la API de Kushki: el aviso solo
// dice de qué retiro se trata, no decide el resultado.
router.post('/webhooks/payout', async (req: Request, res: Response) => {
  const secreto = process.env.KUSHKI_WEBHOOK_SECRET;
  if (!secreto) {
    logger.error('Webhook de Kushki recibido sin KUSHKI_WEBHOOK_SECRET configurado');
    return res.status(503).json({ ok: false });
  }

  const cuerpoCrudo = (req as Request & { rawBody?: Buffer }).rawBody;
  const firmaOk = !!cuerpoCrudo && firmaKushkiValida(
    cuerpoCrudo,
    {
      id: req.get('x-kushki-id'),
      firma: req.get('x-kushki-signature'),
      firmaSimple: req.get('x-kushki-simplesignature'),
    },
    secreto
  );
  if (!firmaOk) {
    logger.warn('Webhook de Kushki con firma inválida', { ip: req.ip });
    return res.status(401).json({ ok: false });
  }

  const ticket = req.body?.ticketNumber;
  if (typeof ticket !== 'string' || !ticket) {
    logger.warn('Webhook de Kushki firmado pero sin ticketNumber');
    return res.status(200).json({ ok: true });
  }

  try {
    const retiro = await prisma.withdrawal.findFirst({ where: { payoutTicket: ticket } });
    if (!retiro) {
      logger.warn('Webhook de Kushki para un ticket desconocido; Kushki reintentará', { ticket });
      return res.status(404).json({ ok: false });
    }
    await anexarRespuesta(retiro.id, 'webhook', sanitizarWebhook(req.body));
    await resolverRetiroEnProceso(retiro);
    res.status(200).json({ ok: true });
  } catch (err: any) {
    logger.error('Error procesando webhook de Kushki', { err: err.message, ticket });
    res.status(500).json({ ok: false });
  }
});

// ══ POST /api/kushki/consignar/tarjeta ══
// El frontend tokeniza la tarjeta en el navegador con Kushki.js
// (kushki.requestToken) y solo nos manda el token de un solo uso — nunca
// vemos el número de tarjeta. El cobro es síncrono: aprobado o rechazado
// en la misma respuesta, sin necesidad de webhook para este flujo.
const consignarSchema = z.object({
  token: z.string().min(10),
  monto: z.number().int().positive().min(1000),
});

router.post('/consignar/tarjeta', authenticate, walletLimiter, conCuenta('recargar'), async (req: Request, res: Response) => {
  const parse = consignarSchema.safeParse(req.body);
  if (!parse.success) return res.status(400).json({ ok: false, mensaje: 'Datos de pago inválidos' });

  const { token, monto } = parse.data;
  const reference = genCodigo('DEP');
  // El usuario paga la comisión encima del monto que va a su billetera —
  // igual que "Enviar" — así que Kushki cobra monto+comisión en la tarjeta,
  // pero la billetera solo se acredita con el monto elegido.
  const comisionValor = Math.ceil(monto * 0.03);
  const totalACobrar = monto + comisionValor;

  try {
    const wallet = await prisma.wallet.findUnique({ where: { userId: req.cuenta!.titularId } });
    if (!wallet) return res.status(404).json({ ok: false, mensaje: 'Billetera no encontrada' });

    const charge = await chargeCardToken(token, totalACobrar);

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
          comisionPct: 3,
          comisionValor,
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
    res.json({ ok: true, saldo: saldoVisible(req.cuenta, saldo) });
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

router.post('/consignar/pse/iniciar', authenticate, walletLimiter, conCuenta('recargar'), async (req: Request, res: Response) => {
  const parse = pseIniciarSchema.safeParse(req.body);
  if (!parse.success) return res.status(400).json({ ok: false, mensaje: 'Datos de pago inválidos' });

  const { token, monto, nombreCompleto, email, telefono } = parse.data;
  // Mismo modelo que la tarjeta: se debita monto+comisión del banco vía PSE,
  // pero solo `monto` queda registrado como lo que hay que acreditar cuando
  // se confirme el pago (ver /pse/confirmar).
  const comisionValor = Math.ceil(monto * 0.03);
  const totalACobrar = monto + comisionValor;

  try {
    const wallet = await prisma.wallet.findUnique({ where: { userId: req.cuenta!.titularId } });
    if (!wallet) return res.status(404).json({ ok: false, mensaje: 'Billetera no encontrada' });

    const init = await initTransfer(token, totalACobrar, { fullName: nombreCompleto, email, phoneNumber: telefono });

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

router.post('/consignar/pse/confirmar', authenticate, walletLimiter, conCuenta('recargar'), async (req: Request, res: Response) => {
  const parse = pseConfirmarSchema.safeParse(req.body);
  if (!parse.success) return res.status(400).json({ ok: false, mensaje: 'Token inválido' });

  const { token } = parse.data;

  try {
    const pago = await prisma.kushkiPayment.findUnique({ where: { reference: token } });
    if (!pago || pago.userId !== req.user!.id) return res.status(404).json({ ok: false, mensaje: 'Pago no encontrado' });

    if (pago.estado !== 'pendiente') {
      return res.json({ ok: true, estado: pago.estado });
    }

    const resultado = await resolverPagoPse(pago);
    res.json({ ok: true, ...resultado, saldo: saldoVisible(req.cuenta, resultado.saldo) });
  } catch (err: any) {
    if (err instanceof KushkiError) return res.status(502).json({ ok: false, mensaje: err.message });
    logger.error('Error confirmando PSE', { err: err.message, userId: req.user?.id });
    res.status(500).json({ ok: false, mensaje: 'Error confirmando el pago' });
  }
});

// ══ GET /api/kushki/consignaciones ══
// Historial de consignaciones de la billetera (incluye las de las subcuentas
// que la comparten). Para un PSE pendiente se devuelve el token solo a quien
// lo inició, para que pueda pedir "Verificar ahora" sin depender de haber
// vuelto del banco.
router.get('/consignaciones', authenticate, conCuenta(), async (req: Request, res: Response) => {
  try {
    const miembros = await miembrosDe(req.cuenta!.titularId);
    const pagos = await prisma.kushkiPayment.findMany({
      where: { userId: { in: miembros } },
      orderBy: { createdAt: 'desc' },
      take: 20,
    });
    res.json({
      ok: true,
      consignaciones: pagos.map((p) => ({
        id: p.id,
        metodo: p.metodo,
        estado: p.estado,
        monto: Number(p.monto),
        createdAt: p.createdAt,
        token: p.metodo === 'pse' && p.estado === 'pendiente' && p.userId === req.user!.id ? p.reference : undefined,
      })),
    });
  } catch (err: any) {
    logger.error('Error consultando consignaciones', { err: err.message, userId: req.user?.id });
    res.status(500).json({ ok: false, mensaje: 'Error consultando tus consignaciones' });
  }
});

export default router;
