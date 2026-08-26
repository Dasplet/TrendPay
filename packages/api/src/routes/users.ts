import { Router, Request, Response } from 'express';
import { z } from 'zod';
import { prisma } from '../index';
import { authenticate } from '../middleware/auth';
import { logger } from '../utils/logger';

const router = Router();

function mapNotification(n: any) {
  return {
    id: n.id,
    tipo: n.tipo,
    titulo: n.titulo,
    mensaje: n.mensaje,
    leida: n.leida,
    createdAt: n.createdAt,
    created_at: n.createdAt,
  };
}

// ══ GET /api/users/profile ══
router.get('/profile', authenticate, async (req: Request, res: Response) => {
  try {
    const user = await prisma.user.findUnique({
      where: { id: req.user!.id },
      include: { wallet: true },
    });

    if (!user) return res.status(404).json({ ok: false, mensaje: 'Usuario no encontrado' });

    const saldo = Number.parseFloat(user.wallet?.saldo.toString() || '0');
    res.json({ ok: true, usuario: { id: user.id, cedula: user.cedula, nombre: user.nombre, correo: user.correo, celular: user.celular, ciudad: user.ciudad, rol: user.rol, subRol: user.subRol, kycVerificado: user.kycVerificado, kycNivel: user.kycNivel, codigoReferido: user.codigoReferido, saldo, walletId: user.wallet?.id } });
  } catch (err: any) {
    logger.error('Error consultando perfil', { err: err.message, userId: req.user?.id });
    res.status(500).json({ ok: false, mensaje: 'Error consultando perfil' });
  }
});

// ══ PUT /api/users/profile ══
const updateProfileSchema = z.object({
  nombre: z.string().min(3).max(200).optional(),
  correo: z.string().email().optional(),
  celular: z.string().max(30).optional().nullable(),
  ciudad: z.string().max(80).optional().nullable(),
});

router.put('/profile', authenticate, async (req: Request, res: Response) => {
  const parse = updateProfileSchema.safeParse(req.body);
  if (!parse.success) return res.status(400).json({ ok: false, mensaje: 'Datos inválidos' });

  try {
    const before = await prisma.user.findUnique({ where: { id: req.user!.id }, include: { wallet: true } });
    if (!before) return res.status(404).json({ ok: false, mensaje: 'Usuario no encontrado' });

    const data = parse.data;
    const updated = await prisma.user.update({
      where: { id: req.user!.id },
      data: {
        ...(data.nombre !== undefined ? { nombre: data.nombre } : {}),
        ...(data.correo !== undefined ? { correo: data.correo } : {}),
        ...(data.celular !== undefined ? { celular: data.celular } : {}),
        ...(data.ciudad !== undefined ? { ciudad: data.ciudad } : {}),
      },
      include: { wallet: true },
    });

    await prisma.userAuditLog.create({
      data: {
        userId: req.user!.id,
        accion: 'ACTUALIZACION_PERFIL',
        campo: 'perfil',
        valorAntes: JSON.stringify({ nombre: before.nombre, correo: before.correo, celular: before.celular, ciudad: before.ciudad }),
        valorDespues: JSON.stringify({ nombre: updated.nombre, correo: updated.correo, celular: updated.celular, ciudad: updated.ciudad }),
        ip: req.ip || null,
      },
    }).catch(() => {});

    const saldo = Number.parseFloat(updated.wallet?.saldo.toString() || '0');
    res.json({ ok: true, mensaje: 'Perfil actualizado', usuario: { id: updated.id, cedula: updated.cedula, nombre: updated.nombre, correo: updated.correo, celular: updated.celular, ciudad: updated.ciudad, rol: updated.rol, subRol: updated.subRol, kycVerificado: updated.kycVerificado, kycNivel: updated.kycNivel, codigoReferido: updated.codigoReferido, saldo, walletId: updated.wallet?.id } });
  } catch (err: any) {
    logger.error('Error actualizando perfil', { err: err.message, userId: req.user?.id });
    res.status(500).json({ ok: false, mensaje: 'Error actualizando perfil' });
  }
});

// ══ GET /api/users/notifications ══
router.get('/notifications', authenticate, async (req: Request, res: Response) => {
  try {
    const limit = Math.min(Number(req.query.limit || 20), 50);
    const notifications = await prisma.notification.findMany({
      where: { userId: req.user!.id },
      orderBy: { createdAt: 'desc' },
      take: limit,
    });

    const unread = await prisma.notification.count({
      where: { userId: req.user!.id, leida: false },
    });

    res.json({
      ok: true,
      unread,
      noLeidas: unread,
      notificaciones: notifications.map(mapNotification),
    });
  } catch (err: any) {
    logger.error('Error consultando notificaciones', { err: err.message, userId: req.user?.id });
    res.status(500).json({ ok: false, mensaje: 'Error consultando notificaciones' });
  }
});

// ══ PUT /api/users/notifications/read ══
router.put('/notifications/read', authenticate, async (req: Request, res: Response) => {
  try {
    await prisma.notification.updateMany({
      where: { userId: req.user!.id, leida: false },
      data: { leida: true },
    });
    res.json({ ok: true, mensaje: 'Notificaciones marcadas como leídas' });
  } catch (err: any) {
    logger.error('Error marcando notificaciones', { err: err.message, userId: req.user?.id });
    res.status(500).json({ ok: false, mensaje: 'Error actualizando notificaciones' });
  }
});

// ══ DELETE /api/users/notifications/:id ══
router.delete('/notifications/:id', authenticate, async (req: Request, res: Response) => {
  try {
    const deleted = await prisma.notification.deleteMany({
      where: { id: req.params.id, userId: req.user!.id },
    });

    if (deleted.count === 0) {
      return res.status(404).json({ ok: false, mensaje: 'Notificación no encontrada' });
    }

    res.json({ ok: true, mensaje: 'Notificación eliminada' });
  } catch (err: any) {
    logger.error('Error eliminando notificación', { err: err.message, userId: req.user?.id, id: req.params.id });
    res.status(500).json({ ok: false, mensaje: 'Error eliminando notificación' });
  }
});

// ══ DELETE /api/users/notifications ══
router.delete('/notifications', authenticate, async (req: Request, res: Response) => {
  try {
    await prisma.notification.deleteMany({ where: { userId: req.user!.id } });
    res.json({ ok: true, mensaje: 'Notificaciones eliminadas' });
  } catch (err: any) {
    logger.error('Error limpiando notificaciones', { err: err.message, userId: req.user?.id });
    res.status(500).json({ ok: false, mensaje: 'Error eliminando notificaciones' });
  }
});

export default router;
