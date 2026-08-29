import { Router, Request, Response } from 'express';
import { z } from 'zod';
import { prisma } from '../index';
import { authenticate } from '../middleware/auth';
import { encrypt, decrypt, maskAccount } from '../utils/security';
import { logger } from '../utils/logger';

const router = Router();

function mapBankAccount(b: any) {
  return {
    id: b.id,
    bancoId: b.bancoId,
    bancoNombre: b.bancoNombre,
    tipoCuenta: b.tipoCuenta,
    numeroCuentaMasked: maskAccount(decrypt(b.numeroCuenta)),
    nombreTitular: b.nombreTitular,
    cedulaTitular: decrypt(b.cedulaTitular),
    alias: b.alias,
    createdAt: b.createdAt,
  };
}

// ══ GET /api/bank-accounts ══
router.get('/', authenticate, async (req: Request, res: Response) => {
  try {
    const cuentas = await prisma.bankAccount.findMany({
      where: { userId: req.user!.id, activa: true },
      orderBy: { createdAt: 'desc' },
    });
    res.json({ ok: true, cuentas: cuentas.map(mapBankAccount) });
  } catch (err: any) {
    logger.error('Error consultando cuentas bancarias', { err: err.message, userId: req.user?.id });
    res.status(500).json({ ok: false, mensaje: 'Error consultando tus bancos' });
  }
});

// ══ POST /api/bank-accounts ══
const crearSchema = z.object({
  bancoId: z.string().optional(),
  bancoNombre: z.string().min(2).max(120),
  tipoCuenta: z.string().min(2).max(40),
  numeroCuenta: z.string().min(4).max(40),
  cedulaTitular: z.string().min(4).max(30),
  nombreTitular: z.string().min(3).max(200),
  alias: z.string().max(60).optional(),
});

router.post('/', authenticate, async (req: Request, res: Response) => {
  const parse = crearSchema.safeParse(req.body);
  if (!parse.success) return res.status(400).json({ ok: false, mensaje: 'Datos de la cuenta bancaria incompletos o inválidos' });
  const { bancoId, bancoNombre, tipoCuenta, numeroCuenta, cedulaTitular, nombreTitular, alias } = parse.data;

  try {
    const cuenta = await prisma.bankAccount.create({
      data: {
        userId: req.user!.id,
        bancoId: bancoId || null,
        bancoNombre,
        tipoCuenta,
        numeroCuenta: encrypt(numeroCuenta),
        cedulaTitular: encrypt(cedulaTitular),
        nombreTitular,
        alias: alias || null,
      },
    });

    logger.info('Cuenta bancaria vinculada', { userId: req.user!.id, bancoNombre });
    res.status(201).json({ ok: true, mensaje: 'Banco vinculado correctamente', cuenta: mapBankAccount(cuenta) });
  } catch (err: any) {
    logger.error('Error vinculando cuenta bancaria', { err: err.message, userId: req.user?.id });
    res.status(500).json({ ok: false, mensaje: 'Error vinculando el banco' });
  }
});

// ══ DELETE /api/bank-accounts/:id ══
router.delete('/:id', authenticate, async (req: Request, res: Response) => {
  try {
    const cuenta = await prisma.bankAccount.findUnique({ where: { id: req.params.id } });
    if (cuenta?.userId !== req.user!.id) {
      return res.status(404).json({ ok: false, mensaje: 'Cuenta bancaria no encontrada' });
    }
    await prisma.bankAccount.delete({ where: { id: cuenta.id } });
    res.json({ ok: true, mensaje: 'Banco eliminado' });
  } catch (err: any) {
    logger.error('Error eliminando cuenta bancaria', { err: err.message, userId: req.user?.id, id: req.params.id });
    res.status(500).json({ ok: false, mensaje: 'Error eliminando el banco' });
  }
});

export default router;
