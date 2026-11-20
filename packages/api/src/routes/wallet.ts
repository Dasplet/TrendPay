import { Router, Request, Response } from 'express';
import { z } from 'zod';
import { prisma } from '../index';
import { authenticate } from '../middleware/auth';
import { walletLimiter } from '../middleware/rateLimiter';
import { genCodigo, genQrToken } from '../utils/security';
import { logger } from '../utils/logger';
import { comisionGeneralPct, calcularComision } from '../utils/comision';
import { conCuenta, saldoVisible } from '../utils/cuentas';

const router = Router();

const QR_TTL_MS = 30 * 60 * 1000; // 30 minutos

class ApiError extends Error {
  status: number;
  constructor(status: number, mensaje: string) {
    super(mensaje);
    this.status = status;
  }
}

const CATEGORIAS_DATAFONO = ['datafono', 'reembolso_datafono'];

function mapTransaction(t: any) {
  const montoNeto  = Number.parseFloat(t.montoNeto.toString());
  const montoBruto = Number.parseFloat(t.montoBruto.toString());
  return { id: t.id, codigo: t.codigo, categoria: t.categoria, tipo: t.categoria, descripcion: t.descripcion, montoNeto, monto_neto: montoNeto, montoBruto, monto_bruto: montoBruto, status: t.status, estado: t.status, createdAt: t.createdAt, created_at: t.createdAt };
}

// ══ GET /api/wallet/comision ══
// La comisión general vigente, para que las pantallas de consignar y enviar muestren la cifra real
router.get('/comision', authenticate, conCuenta(), async (_req: Request, res: Response) => {
  res.json({ ok: true, comisionPct: await comisionGeneralPct() });
});

// ══ GET /api/wallet/balance ══
router.get('/balance', authenticate, conCuenta('verSaldo'), async (req: Request, res: Response) => {
  try {
    const wallet = await prisma.wallet.findUnique({ where: { userId: req.cuenta!.titularId } });
    if (!wallet) return res.status(404).json({ ok: false, mensaje: 'Billetera no encontrada' });
    res.json({ ok: true, saldo: Number.parseFloat(wallet.saldo.toString()), walletId: wallet.id });
  } catch (err: any) {
    logger.error('Error consultando saldo', { err: err.message, userId: req.user?.id });
    res.status(500).json({ ok: false, mensaje: 'Error consultando saldo' });
  }
});

// ══ GET /api/wallet/history ══
// Movimientos de la billetera (compartida, en el caso de subcuentas empresariales).
router.get('/history', authenticate, conCuenta(), async (req: Request, res: Response) => {
  try {
    const limit = Math.min(Number(req.query.limit) || 20, 100);
    const offset = Number(req.query.offset) || 0;

    const wallet = await prisma.wallet.findUnique({ where: { userId: req.cuenta!.titularId } });
    if (!wallet) return res.json({ ok: true, transacciones: [] });

    // Los cobros con datáfono (y sus reembolsos) los ve la cuenta principal y la sede a la que pertenecen; las demás
    // sedes de la empresa no. El resto de movimientos de la billetera compartida se ve como siempre.
    const soloMiTienda = req.cuenta!.esSubcuenta
      ? { OR: [{ categoria: { notIn: CATEGORIAS_DATAFONO } }, { sedeId: req.user!.id }] }
      : {};
    const transactions = await prisma.transaction.findMany({
      where: { walletId: wallet.id, ...soloMiTienda },
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

// ══ GET /api/wallet/saldo-mensual ══
// Saldo real al cierre de cada mes (hora de Colombia, UTC-5 sin horario de verano) a partir de las
// transacciones de la billetera. El mes en curso usa el saldo actual. Devuelve además lo recibido y
// retirado en el mes en curso y la variación contra el cierre del mes anterior.
const MESES_ES = ['Ene', 'Feb', 'Mar', 'Abr', 'May', 'Jun', 'Jul', 'Ago', 'Sep', 'Oct', 'Nov', 'Dic'];
const DESFASE_COLOMBIA_MS = 5 * 60 * 60 * 1000;

function indiceMes(fecha: Date): number {
  const local = new Date(fecha.getTime() - DESFASE_COLOMBIA_MS);
  return local.getUTCFullYear() * 12 + local.getUTCMonth();
}

function inicioDeMes(indice: number): Date {
  return new Date(Date.UTC(Math.floor(indice / 12), indice % 12, 1) + DESFASE_COLOMBIA_MS);
}

router.get('/saldo-mensual', authenticate, conCuenta('verSaldo'), async (req: Request, res: Response) => {
  try {
    const cantidad = Math.min(Math.max(Number(req.query.meses) || 6, 2), 12);
    const wallet = await prisma.wallet.findUnique({ where: { userId: req.cuenta!.titularId } });
    if (!wallet) return res.status(404).json({ ok: false, mensaje: 'Billetera no encontrada' });

    const actual = indiceMes(new Date());
    const primero = actual - cantidad + 1;
    const desde = inicioDeMes(primero);

    const [previa, movimientos] = await Promise.all([
      prisma.transaction.findFirst({ where: { walletId: wallet.id, createdAt: { lt: desde } }, orderBy: { createdAt: 'desc' }, select: { saldoDespues: true } }),
      prisma.transaction.findMany({
        where: { walletId: wallet.id, createdAt: { gte: desde } },
        orderBy: { createdAt: 'asc' },
        select: { createdAt: true, saldoDespues: true, montoNeto: true, categoria: true, status: true },
      }),
    ]);

    const cierre = new Map<number, number>();
    let recibido = 0;
    let retirado = 0;
    for (const t of movimientos) {
      const i = indiceMes(t.createdAt);
      cierre.set(i, Number.parseFloat(t.saldoDespues.toString()));
      if (i !== actual) continue;
      const neto = Number.parseFloat(t.montoNeto.toString());
      if (t.status === 'rechazada') continue;
      if (t.categoria === 'retiro') retirado += Math.abs(neto);
      else if (t.categoria === 'reembolso_datafono') recibido = Math.max(0, recibido - Math.abs(neto)); // un reembolso resta de lo recibido
      else if (neto > 0) recibido += neto;
    }

    const saldoActual = Number.parseFloat(wallet.saldo.toString());
    let arrastre = previa ? Number.parseFloat(previa.saldoDespues.toString()) : 0;
    const meses = [] as { clave: string; etiqueta: string; saldo: number }[];
    for (let i = primero; i <= actual; i++) {
      if (cierre.has(i)) arrastre = cierre.get(i)!;
      const saldo = i === actual ? saldoActual : arrastre;
      meses.push({ clave: `${Math.floor(i / 12)}-${String((i % 12) + 1).padStart(2, '0')}`, etiqueta: MESES_ES[i % 12], saldo });
    }

    const anterior = meses[meses.length - 2]?.saldo ?? 0;
    const variacionPct = anterior > 0 ? Math.round(((saldoActual - anterior) / anterior) * 1000) / 10 : null;

    res.json({ ok: true, meses, mesActual: { recibido, retirado, movimientos: movimientos.filter((t) => indiceMes(t.createdAt) === actual).length }, variacionPct });
  } catch (err: any) {
    logger.error('Error consultando saldo mensual', { err: err.message, userId: req.user?.id });
    res.status(500).json({ ok: false, mensaje: 'Error consultando el saldo mensual' });
  }
});

// ══ POST /api/wallet/enviar ══
const enviarSchema = z.object({
  destino: z.string().min(3).max(120),
  monto: z.number().int().positive().min(1000),
  nota: z.string().max(200).optional(),
});

router.post('/enviar', authenticate, walletLimiter, conCuenta('enviar'), async (req: Request, res: Response) => {
  const parse = enviarSchema.safeParse(req.body);
  if (!parse.success) {
    return res.status(400).json({ ok: false, mensaje: 'Destino y monto (mínimo $1.000) son requeridos' });
  }
  const { destino, monto, nota } = parse.data;

  try {
    // La cédula identifica a una sola cuenta. El correo (y el celular) pueden repetirse: si el dato coincide con cuentas de
    // distintos titulares no se adivina a quién enviar, porque el dinero iría a la persona equivocada.
    const coincidencias = await prisma.user.findMany({
      where: { eliminadoAt: null, OR: [{ celular: destino }, { correo: { equals: destino, mode: 'insensitive' } }, { cedula: destino }] },
      take: 10,
    });
    const porCedula = coincidencias.find((u) => u.cedula === destino);
    const titulares = new Set(coincidencias.map((u) => u.cuentaPadreId ?? u.id));
    if (!porCedula && titulares.size > 1) {
      throw new ApiError(409, 'Hay varias cuentas con ese dato. Envía el dinero usando la cédula del destinatario');
    }
    // Una empresa y sus sedes comparten billetera: el destinatario es la cuenta principal
    const receptor = porCedula ?? coincidencias.find((u) => u.cuentaPadreId === null) ?? coincidencias[0];
    if (!receptor) throw new ApiError(404, 'No encontramos un usuario con ese celular, correo o cédula');
    const receptorTitularId = receptor.cuentaPadreId ?? receptor.id;
    if (receptorTitularId === req.cuenta!.titularId) throw new ApiError(400, 'No puedes enviarte dinero a ti mismo');
    if (receptor.bloqueado) throw new ApiError(400, 'El destinatario tiene la cuenta bloqueada');

    const comisionPct = await comisionGeneralPct();
    const comisionValor = calcularComision(monto, comisionPct);
    const total = monto + comisionValor;
    const codigo = genCodigo('ENV');
    const notaSuffix = nota ? ` · ${nota}` : '';
    const descripcionEnvio = `Envío a ${receptor.nombre}${notaSuffix}`;
    const descripcionRecibo = `Recibido de ${req.user!.nombre}${notaSuffix}`;

    const nuevoSaldo = await prisma.$transaction(async (tx) => {
      const senderWallet = await tx.wallet.findUnique({ where: { userId: req.cuenta!.titularId } });
      if (!senderWallet) throw new ApiError(404, 'Billetera no encontrada');

      const debit = await tx.wallet.updateMany({
        where: { id: senderWallet.id, saldo: { gte: total } },
        data: { saldo: { decrement: total } },
      });
      if (debit.count === 0) throw new ApiError(400, 'Saldo insuficiente');

      const senderAfter = await tx.wallet.findUnique({ where: { id: senderWallet.id } });
      const senderSaldoDespues = Number.parseFloat(senderAfter!.saldo.toString());
      const senderSaldoAntes = senderSaldoDespues + total;

      const receptorWalletBefore = await tx.wallet.findUnique({ where: { userId: receptorTitularId } });
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
          comisionPct,
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
    res.json({ ok: true, mensaje: 'Envío realizado', saldo: saldoVisible(req.cuenta, nuevoSaldo) });
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

// Cobrar por QR es una forma de ingresar dinero, así que exige el permiso de recarga.
router.post('/qr/generar', authenticate, walletLimiter, conCuenta('recargar'), async (req: Request, res: Response) => {
  const parse = qrGenerarSchema.safeParse(req.body);
  if (!parse.success) return res.status(400).json({ ok: false, mensaje: 'Datos de QR inválidos' });

  try {
    const wallet = await prisma.wallet.findUnique({ where: { userId: req.cuenta!.titularId } });
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

    const monto = qr.monto ? Number.parseFloat(qr.monto.toString()) : null;
    res.json({ ok: true, qr: { token: qr.token, monto, concepto: qr.concepto, expiresAt: qr.expiresAt } });
  } catch (err: any) {
    logger.error('Error generando QR', { err: err.message, userId: req.user?.id });
    res.status(500).json({ ok: false, mensaje: 'Error generando QR' });
  }
});

// ══ GET /api/wallet/qr/personal ══
// QR fijo y único por usuario: no expira, no se marca "usado" y siempre es de
// monto libre (quien paga decide cuánto). Se crea la primera vez que se pide.
router.get('/qr/personal', authenticate, conCuenta('recargar'), async (req: Request, res: Response) => {
  try {
    const wallet = await prisma.wallet.findUnique({ where: { userId: req.cuenta!.titularId } });
    if (!wallet) return res.status(404).json({ ok: false, mensaje: 'Billetera no encontrada' });

    let qr = await prisma.qrCode.findFirst({ where: { walletId: wallet.id, permanente: true } });
    qr ??= await prisma.qrCode.create({
      data: {
        walletId: wallet.id,
        token: genQrToken(),
        permanente: true,
        expiresAt: new Date('2099-12-31'),
      },
    });

    res.json({ ok: true, qr: { token: qr.token } });
  } catch (err: any) {
    logger.error('Error consultando QR personal', { err: err.message, userId: req.user?.id });
    res.status(500).json({ ok: false, mensaje: 'Error consultando tu QR personal' });
  }
});

// ══ GET /api/wallet/qr/:token ══
router.get('/qr/:token', authenticate, conCuenta(), async (req: Request, res: Response) => {
  try {
    const qr = await prisma.qrCode.findUnique({
      where: { token: req.params.token },
      include: { wallet: { include: { user: true } } },
    });
    if (!qr) return res.status(404).json({ ok: false, mensaje: 'QR no encontrado' });

    const monto = qr.monto ? Number.parseFloat(qr.monto.toString()) : null;
    res.json({ ok: true, qr: { monto, concepto: qr.concepto, expiresAt: qr.permanente ? null : qr.expiresAt, usado: qr.permanente ? false : qr.usado, expirado: qr.permanente ? false : qr.expiresAt < new Date(), permanente: qr.permanente, esPropio: qr.wallet.userId === req.cuenta!.titularId, propietario: { nombre: qr.wallet.user.nombre } } });
  } catch (err: any) {
    logger.error('Error consultando QR', { err: err.message, token: req.params.token });
    res.status(500).json({ ok: false, mensaje: 'Error consultando QR' });
  }
});

// ══ POST /api/wallet/qr/:token/pagar ══
const qrPagarSchema = z.object({
  monto: z.number().int().positive().optional(),
});

router.post('/qr/:token/pagar', authenticate, walletLimiter, conCuenta('enviar'), async (req: Request, res: Response) => {
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
      if (qr.wallet.userId === req.cuenta!.titularId) throw new ApiError(400, 'No puedes pagar tu propio QR');

      const monto = qr.monto ? Number.parseFloat(qr.monto.toString()) : parse.data.monto;
      if (!monto || monto <= 0) throw new ApiError(400, 'Este QR requiere que indiques un monto');

      const payerWallet = await tx.wallet.findUnique({ where: { userId: req.cuenta!.titularId } });
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
    res.json({ ok: true, mensaje: 'Pago realizado', saldo: saldoVisible(req.cuenta, nuevoSaldo) });
  } catch (err: any) {
    if (err instanceof ApiError) return res.status(err.status).json({ ok: false, mensaje: err.message });
    logger.error('Error pagando QR', { err: err.message, userId: req.user?.id, token: req.params.token });
    res.status(500).json({ ok: false, mensaje: 'Error procesando el pago' });
  }
});

export default router;
