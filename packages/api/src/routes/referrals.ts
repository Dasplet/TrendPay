import { Router, Request, Response } from 'express';
import { prisma } from '../index';
import { authenticate, requireAdmin } from '../middleware/auth';

const router = Router();

// ══ GET /api/referrals/admin ══
router.get('/admin', authenticate, requireAdmin, async (req: Request, res: Response) => {
  try {
    const q = (req.query.q as string) || '';
    const referrals = await prisma.referral.findMany({
      include: {
        referidor: { select: { id:true, nombre:true, cedula:true, correo:true } },
        referido:  { select: { id:true, nombre:true, cedula:true, correo:true } },
      },
      orderBy: { createdAt: 'desc' },
      take: 200,
    });
    const filtered = q ? referrals.filter(r =>
      r.referidor.nombre.toLowerCase().includes(q.toLowerCase()) ||
      r.referido.nombre.toLowerCase().includes(q.toLowerCase()) ||
      r.referidor.cedula.includes(q) || r.referido.cedula.includes(q)
    ) : referrals;

    const pagados    = filtered.filter(r => r.status === 'pagado').length;
    const pendientes = filtered.filter(r => r.status === 'pendiente').length;
    const total_pagado = filtered.filter(r => r.status === 'pagado')
      .reduce((s, r) => s + Number.parseFloat(r.comisionValor.toString()), 0);

    res.json({
      ok: true,
      referidos: filtered.map(r => {
        const comision_valor = Number.parseFloat(r.comisionValor.toString());
        return {
          id:               r.id,
          referidor_nombre: r.referidor.nombre,
          referidor_cedula: r.referidor.cedula,
          referido_nombre:  r.referido.nombre,
          referido_cedula:  r.referido.cedula,
          comision_valor,
          status:           r.status,
          created_at:       r.createdAt,
        };
      }),
      stats: { total: filtered.length, pagados, pendientes, total_pagado },
    });
  } catch (e: any) { res.status(500).json({ ok: false, mensaje: e.message }); }
});

// ══ GET /api/referrals/admin/top ══
router.get('/admin/top', authenticate, requireAdmin, async (_req: Request, res: Response) => {
  try {
    const referrals = await prisma.referral.findMany({
      include: { referidor: { select: { id:true, nombre:true, cedula:true } } },
    });
    const map: Record<string, any> = {};
    for (const r of referrals) {
      const id = r.referidor.id;
      if (!map[id]) map[id] = { id, nombre: r.referidor.nombre, cedula: r.referidor.cedula, total_referidos: 0, total_ganado: 0 };
      map[id].total_referidos++;
      if (r.status === 'pagado') map[id].total_ganado += Number.parseFloat(r.comisionValor.toString());
    }
    const ranking = Object.values(map).sort((a, b) => b.total_referidos - a.total_referidos).slice(0, 10);
    res.json({ ok: true, ranking });
  } catch (e: any) { res.status(500).json({ ok: false, mensaje: e.message }); }
});

// ══ GET /api/referrals/me ══
router.get('/me', authenticate, async (req: Request, res: Response) => {
  try {
    const referrals = await prisma.referral.findMany({
      where:   { referidorId: req.user!.id },
      include: { referido: { select: { nombre:true, cedula:true, createdAt:true } } },
      orderBy: { createdAt: 'desc' },
    });
    const total_ganado = referrals.filter(r => r.status === 'pagado')
      .reduce((s, r) => s + Number.parseFloat(r.comisionValor.toString()), 0);
    res.json({
      ok: true,
      referidos: referrals.map(r => {
        const comision_valor = Number.parseFloat(r.comisionValor.toString());
        return { id: r.id, nombre: r.referido.nombre, cedula: r.referido.cedula, status: r.status, comision_valor, created_at: r.createdAt };
      }),
      stats: { total: referrals.length, pagados: referrals.filter(r=>r.status==='pagado').length, pendientes: referrals.filter(r=>r.status==='pendiente').length, total_ganado },
    });
  } catch (e: any) { res.status(500).json({ ok: false, mensaje: e.message }); }
});

// ══ POST /api/referrals/admin/pagar/:id ══
router.post('/admin/pagar/:id', authenticate, requireAdmin, async (req: Request, res: Response) => {
  try {
    const referral = await prisma.referral.update({
      where: { id: req.params.id },
      data:  { status: 'pagado', pagadoAt: new Date() },
    });
    const referidor = await prisma.user.findUnique({ where: { id: referral.referidorId }, include: { wallet: true } });
    if (referidor?.wallet) {
      await prisma.wallet.update({ where: { id: referidor.wallet.id }, data: { saldo: { increment: Number.parseFloat(referral.comisionValor.toString()) } } });
    }
    res.json({ ok: true, mensaje: 'Comisión pagada y saldo acreditado' });
  } catch (e: any) { res.status(500).json({ ok: false, mensaje: e.message }); }
});

export default router;
