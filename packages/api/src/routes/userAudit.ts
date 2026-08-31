import { Router, Request, Response } from 'express';
import { prisma } from '../index';
import { authenticate, requireAdmin } from '../middleware/auth';
import { logger } from '../utils/logger';

const router = Router();

// ══ GET /api/user-audit/admin ══
router.get('/admin', authenticate, requireAdmin, async (req: Request, res: Response) => {
  try {
    const limit = Number.parseInt(req.query.limit as string) || 100;
    const logs = await prisma.userAuditLog.findMany({
      take: limit,
      orderBy: { createdAt: 'desc' },
      include: { user: { select: { nombre: true, cedula: true } } },
    });
    res.json({
      ok: true,
      logs: logs.map(l => ({
        id: l.id,
        accion: l.accion,
        campo: l.campo,
        valorAntes: l.valorAntes,
        valorDespues: l.valorDespues,
        createdAt: l.createdAt,
        usuario_nombre: l.user.nombre,
        usuario_cedula: l.user.cedula,
      })),
    });
  } catch (err: any) {
    // La tabla puede no existir todavía en entornos que no han corrido la
    // migración de auditoría — se lo indicamos al frontend en vez de fallar.
    if (err.code === 'P2021') {
      return res.json({ ok: true, logs: [], _info: 'migration_pending' });
    }
    logger.error('Error consultando auditoría de usuarios', { err: err.message });
    res.status(500).json({ ok: false, mensaje: 'Error consultando la auditoría' });
  }
});

export default router;
