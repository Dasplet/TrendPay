import { Router, Request, Response } from 'express';
import { prisma } from '../index';
import { logger } from '../utils/logger';

const router = Router();

// ══ GET /api/banks ══
router.get('/', async (_req: Request, res: Response) => {
  try {
    const banks = await prisma.bank.findMany({
      where: { habilitado: true },
      orderBy: { orden: 'asc' },
    });
    res.json({
      ok: true,
      bancos: banks.map((b) => ({ id: b.id, nombre: b.nombre, nuevo: b.nuevo })),
    });
  } catch (err: any) {
    logger.error('Error consultando bancos', { err: err.message });
    res.status(500).json({ ok: false, mensaje: 'Error consultando bancos' });
  }
});

export default router;
