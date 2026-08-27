import { Router, Request, Response } from 'express';
import { z } from 'zod';
import bcrypt from 'bcryptjs';
import { randomUUID } from 'crypto';
import { prisma } from '../index';
import { authenticate, requireAdmin } from '../middleware/auth';

const router = Router();

// ══ GET /api/admin/metrics ══
router.get('/metrics', authenticate, requireAdmin, async (_req: Request, res: Response) => {
  try {
    const [totalUsuarios, txAgg, retirosPend, comisionCfg] = await Promise.all([
      prisma.user.count(),
      prisma.transaction.aggregate({ _sum: { montoBruto: true, comisionValor: true } }),
      prisma.withdrawal.count({ where: { status: 'pendiente' } }).catch(() => 0),
      prisma.config.findUnique({ where: { clave: 'comision_pct' } }),
    ]);
    const total_volumen    = Number.parseFloat(txAgg._sum.montoBruto?.toString() || '0');
    const total_comisiones = Number.parseFloat(txAgg._sum.comisionValor?.toString() || '0');
    const comision_pct     = Number.parseFloat(comisionCfg?.valor || '3');
    res.json({ ok: true, metricas: { total_usuarios: totalUsuarios, total_volumen, total_comisiones, retiros_pendientes: retirosPend, comision_pct } });
  } catch (e: any) { res.status(500).json({ ok: false, mensaje: e.message }); }
});

// ══ GET /api/admin/users ══
router.get('/users', authenticate, requireAdmin, async (req: Request, res: Response) => {
  try {
    const limit = Number.parseInt(req.query.limit as string) || 200;
    const q     = (req.query.q as string) || '';
    const users = await prisma.user.findMany({
      take: limit,
      orderBy: { createdAt: 'desc' },
      include: { wallet: true },
      where: q ? { OR: [
        { nombre: { contains: q, mode: 'insensitive' } },
        { cedula: { contains: q } },
        { correo: { contains: q, mode: 'insensitive' } },
      ]} : undefined,
    });
    res.json({
      ok: true,
      usuarios: users.map(u => { const saldo = Number.parseFloat(u.wallet?.saldo.toString() || '0'); return { id: u.id, cedula: u.cedula, nombre: u.nombre, correo: u.correo, celular: u.celular, ciudad: u.ciudad, rol: u.rol, subRol: u.subRol, kycNivel: u.kycNivel, kycVerificado: u.kycVerificado, bloqueado: u.bloqueado, codigoReferido: u.codigoReferido, saldo, ultimoLogin: u.ultimoLogin, createdAt: u.createdAt }; }),
    });
  } catch (e: any) { res.status(500).json({ ok: false, mensaje: e.message }); }
});

// ══ POST /api/admin/users ══
const createUserSchema = z.object({
  cedula:  z.string().min(6).max(20),
  nombre:  z.string().min(3).max(200),
  correo:  z.string().email(),
  pin:     z.string().length(4).regex(/^\d{4}$/),
  celular: z.string().optional(),
  ciudad:  z.string().optional(),
  rol:     z.enum(['usuario', 'admin']).optional(),
});

router.post('/users', authenticate, requireAdmin, async (req: Request, res: Response) => {
  const parse = createUserSchema.safeParse(req.body);
  if (!parse.success) return res.status(400).json({ ok: false, mensaje: parse.error.errors[0].message });
  const { cedula, nombre, correo, pin, celular, ciudad, rol } = parse.data;

  try {
    const exists = await prisma.user.findFirst({ where: { OR: [{ cedula }, { correo }] } });
    if (exists) {
      const campo = exists.cedula === cedula ? 'cédula' : 'correo';
      return res.status(400).json({ ok: false, mensaje: `Esta ${campo} ya está registrada` });
    }

    const pinHash      = await bcrypt.hash(pin, Number.parseInt(process.env.BCRYPT_ROUNDS || '12'));
    const codigoPropio = 'REF-' + cedula.slice(-6).padStart(6, '0');

    const user = await prisma.user.create({
      data: {
        id: randomUUID(),
        cedula, nombre, correo,
        celular: celular || null,
        ciudad: ciudad || null,
        pinHash,
        rol: rol || 'usuario',
        codigoReferido: codigoPropio,
        wallet: { create: { saldo: 0 } },
      },
      include: { wallet: true },
    });

    await prisma.auditLog.create({
      data: { userId: req.user!.id, accion: 'CREAR_USUARIO', tabla: 'users', registroId: user.id, ip: req.ip,
        datos: { despues: { nombre: user.nombre, correo: user.correo, cedula: user.cedula, rol: user.rol } } },
    }).catch(() => {});

    res.status(201).json({
      ok: true, mensaje: 'Usuario creado',
      usuario: { id: user.id, cedula: user.cedula, nombre: user.nombre, correo: user.correo, celular: user.celular, ciudad: user.ciudad, rol: user.rol, saldo: 0 },
    });
  } catch (e: any) { res.status(500).json({ ok: false, mensaje: e.message }); }
});

// ══ PUT /api/admin/users/:id ══
router.put('/users/:id', authenticate, requireAdmin, async (req: Request, res: Response) => {
  try {
    const existing = await prisma.user.findUnique({ where: { id: req.params.id } });
    if (!existing) return res.status(404).json({ ok: false, mensaje: 'Usuario no encontrado' });

    const { nombre, correo, celular, ciudad, bloqueado, kycNivel, nuevo_pin } = req.body;
    const data: any = {};
    const antes: any = {};
    const despues: any = {};
    if (nombre    !== undefined && nombre    !== existing.nombre)    { data.nombre    = nombre;    antes.nombre = existing.nombre;       despues.nombre = nombre; }
    if (correo    !== undefined && correo    !== existing.correo)    { data.correo    = correo;    antes.correo = existing.correo;       despues.correo = correo; }
    if (celular   !== undefined && celular   !== existing.celular)   { data.celular   = celular;   antes.celular = existing.celular;     despues.celular = celular; }
    if (ciudad    !== undefined && ciudad    !== existing.ciudad)    { data.ciudad    = ciudad;    antes.ciudad = existing.ciudad;       despues.ciudad = ciudad; }
    if (bloqueado !== undefined && bloqueado !== existing.bloqueado) { data.bloqueado = bloqueado; antes.bloqueado = existing.bloqueado; despues.bloqueado = bloqueado; }
    if (kycNivel  !== undefined && Number.parseInt(kycNivel) !== existing.kycNivel) { data.kycNivel = Number.parseInt(kycNivel); antes.kycNivel = existing.kycNivel; despues.kycNivel = Number.parseInt(kycNivel); }
    if (nuevo_pin) {
      data.pinHash = await bcrypt.hash(nuevo_pin, Number.parseInt(process.env.BCRYPT_ROUNDS || '12'));
      antes.pin = '••••'; despues.pin = '••••';
    }
    const user = await prisma.user.update({ where: { id: req.params.id }, data });

    // Audit
    await prisma.auditLog.create({
      data: { userId: req.user!.id, accion: 'EDITAR_USUARIO', tabla: 'users', registroId: req.params.id, ip: req.ip, datos: { antes, despues } },
    }).catch(() => {});

    res.json({ ok: true, mensaje: 'Usuario actualizado', usuario: user });
  } catch (e: any) { res.status(500).json({ ok: false, mensaje: e.message }); }
});

// ══ DELETE /api/admin/users/:id ══
router.delete('/users/:id', authenticate, requireAdmin, async (req: Request, res: Response) => {
  try {
    const u = await prisma.user.findUnique({ where: { id: req.params.id } });
    if (!u) return res.status(404).json({ ok: false });
    // Soft delete
    await prisma.user.update({
      where: { id: req.params.id },
      data: { cedula: `DEL-${u.cedula}`, correo: `${u.cedula}@eliminado.local`, nombre: 'Usuario eliminado', bloqueado: true },
    });
    await prisma.auditLog.create({
      data: { userId: req.user!.id, accion: 'ELIMINAR_USUARIO', tabla: 'users', registroId: req.params.id, ip: req.ip,
        datos: { antes: { nombre: u.nombre, correo: u.correo, cedula: u.cedula } } },
    }).catch(() => {});
    res.json({ ok: true, mensaje: 'Usuario eliminado' });
  } catch (e: any) { res.status(500).json({ ok: false, mensaje: e.message }); }
});

// ══ GET /api/admin/transactions ══
router.get('/transactions', authenticate, requireAdmin, async (req: Request, res: Response) => {
  try {
    const limit = Number.parseInt(req.query.limit as string) || 300;
    const txs = await prisma.transaction.findMany({
      take: limit, orderBy: { createdAt: 'desc' },
      include: { user: { select: { nombre: true, cedula: true } } },
    });
    res.json({
      ok: true,
      transacciones: txs.map(t => { const monto_neto = Number.parseFloat(t.montoNeto.toString()); const monto_bruto = Number.parseFloat(t.montoBruto.toString()); const comision_valor = Number.parseFloat(t.comisionValor.toString()); return { id: t.id, codigo: t.codigo, categoria: t.categoria, descripcion: t.descripcion, monto_neto, monto_bruto, comision_valor, status: t.status, created_at: t.createdAt, usuario_nombre: t.user.nombre, usuario_cedula: t.user.cedula }; }),
    });
  } catch (e: any) { res.status(500).json({ ok: false, mensaje: e.message }); }
});

// ══ GET /api/admin/dashboard-chart ══
router.get('/dashboard-chart', authenticate, requireAdmin, async (req: Request, res: Response) => {
  try {
    const months = Number.parseInt(req.query.months as string) || 6;
    const from   = new Date(); from.setMonth(from.getMonth() - months);
    const txs = await prisma.transaction.findMany({
      where: { createdAt: { gte: from } },
      select: { montoBruto: true, comisionValor: true, createdAt: true },
    });
    const buckets: Record<string, any> = {};
    txs.forEach(t => {
      const key = `${t.createdAt.getFullYear()}-${String(t.createdAt.getMonth()+1).padStart(2,'0')}`;
      if (!buckets[key]) buckets[key] = { mes: key, volumen: 0, comisiones: 0 };
      buckets[key].volumen    += Number.parseFloat(t.montoBruto.toString());
      buckets[key].comisiones += Number.parseFloat(t.comisionValor.toString());
    });
    res.json({ ok: true, datos: Object.values(buckets).sort((a,b) => a.mes.localeCompare(b.mes)) });
  } catch (e: any) { res.status(500).json({ ok: false, mensaje: e.message }); }
});

// ══ GET /api/admin/notifications ══
router.get('/notifications', authenticate, requireAdmin, async (_req: Request, res: Response) => {
  try {
    const [auditLogs, retirosPend, newUsers] = await Promise.all([
      prisma.auditLog.findMany({ take:15, orderBy:{ createdAt:'desc' }, include:{ user:{ select:{ nombre:true } } } }),
      prisma.withdrawal.findMany({ where:{ status:'pendiente' }, take:10, orderBy:{ createdAt:'desc' }, include:{ user:{ select:{ nombre:true } } } }).catch(()=>[]),
      prisma.user.findMany({ where:{ createdAt:{ gte: new Date(Date.now()-24*60*60*1000) } }, take:5, orderBy:{ createdAt:'desc' }, select:{ nombre:true, createdAt:true } }),
    ]);
    const notifs: any[] = [];
    newUsers.forEach(u => notifs.push({ id:`user-${u.createdAt.getTime()}`, tipo:'ok', titulo:'Nuevo usuario registrado', mensaje:u.nombre, leida:false, createdAt:u.createdAt }));
    (retirosPend as any[]).forEach((w:any) => notifs.push({ id:`wd-${w.id}`, tipo:'warning', titulo:'Retiro pendiente de aprobación', mensaje:`${w.user?.nombre} · $${Number(w.monto).toLocaleString('es-CO')}`, leida:false, createdAt:w.createdAt }));
    const actionLabels: Record<string,string> = { LOGIN:'Inicio de sesión', RETIRO_APROBADO:'Retiro aprobado', CREAR_USUARIO:'Usuario creado', EDITAR_USUARIO:'Usuario editado', CAMBIO_PIN:'PIN cambiado', BLOQUEO_CUENTA:'Cuenta bloqueada', ELIMINAR_USUARIO:'Usuario eliminado' };
    auditLogs.slice(0,5).forEach(l => notifs.push({ id:`audit-${l.id}`, tipo:'info', titulo:actionLabels[l.accion]||l.accion, mensaje:l.user?.nombre||'', leida:true, createdAt:l.createdAt }));
    notifs.sort((a,b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
    res.json({ ok:true, notificaciones:notifs.slice(0,20), sin_leer:notifs.filter(n=>!n.leida).length });
  } catch (e: any) { res.status(500).json({ ok:false, mensaje:e.message }); }
});

// ══ PUT /api/admin/notifications/read ══
router.put('/notifications/read', authenticate, requireAdmin, (_req, res) => res.json({ ok: true }));

// ══ GET /api/admin/banks ══
router.get('/banks', authenticate, requireAdmin, async (_req: Request, res: Response) => {
  try {
    const banks = await prisma.bank.findMany({ orderBy: { orden: 'asc' } });
    res.json({ ok: true, bancos: banks });
  } catch (e: any) { res.status(500).json({ ok: false, mensaje: e.message }); }
});

// ══ POST /api/admin/banks ══
router.post('/banks', authenticate, requireAdmin, async (req: Request, res: Response) => {
  try {
    const { nombre, orden, nuevo } = req.body;
    if (!nombre || !String(nombre).trim()) return res.status(400).json({ ok: false, mensaje: 'El nombre es obligatorio' });

    const slug = String(nombre).trim().toLowerCase()
      .normalize('NFD').replace(/[\u0300-\u036f]/g, '') // quita tildes
      .replace(/[^a-z0-9]+/g, '-').replace(/^-+/, '').replace(/-+$/, '');
    if (!slug) return res.status(400).json({ ok: false, mensaje: 'Nombre inválido' });

    let id = slug, suffix = 1;
    while (await prisma.bank.findUnique({ where: { id } })) { id = `${slug}-${++suffix}`; }

    const ordenValor = orden ? Number.parseInt(orden) : 99;
    const bank = await prisma.bank.create({ data: { id, nombre: String(nombre).trim(), orden: ordenValor, nuevo: !!nuevo, habilitado: true } });

    await prisma.auditLog.create({
      data: { userId: req.user!.id, accion: 'BANCO_CREAR', tabla: 'banks', registroId: bank.id, ip: req.ip, datos: { nombre: bank.nombre } },
    }).catch(() => {});

    res.status(201).json({ ok: true, mensaje: 'Banco creado', banco: bank });
  } catch (e: any) { res.status(500).json({ ok: false, mensaje: e.message }); }
});

// ══ PUT /api/admin/banks/:id ══
router.put('/banks/:id', authenticate, requireAdmin, async (req: Request, res: Response) => {
  try {
    const existing = await prisma.bank.findUnique({ where: { id: req.params.id } });
    if (!existing) return res.status(404).json({ ok: false, mensaje: 'Banco no encontrado' });

    const { nombre, orden, nuevo, habilitado } = req.body;
    const data: any = {};
    if (nombre !== undefined) data.nombre = String(nombre).trim();
    if (orden !== undefined) data.orden = Number.parseInt(orden);
    if (nuevo !== undefined) data.nuevo = !!nuevo;
    if (habilitado !== undefined) data.habilitado = !!habilitado;

    const bank = await prisma.bank.update({ where: { id: req.params.id }, data });

    if (habilitado !== undefined && !!habilitado !== existing.habilitado) {
      await prisma.auditLog.create({
        data: { userId: req.user!.id, accion: 'BANCO_TOGGLE', tabla: 'banks', registroId: bank.id, ip: req.ip,
          datos: { nombre: bank.nombre, antes: { habilitado: existing.habilitado }, despues: { habilitado: bank.habilitado } } },
      }).catch(() => {});
    }

    res.json({ ok: true, mensaje: 'Banco actualizado', banco: bank });
  } catch (e: any) { res.status(500).json({ ok: false, mensaje: e.message }); }
});

// ══ GET /api/admin/audit ══
router.get('/audit', authenticate, requireAdmin, async (_req: Request, res: Response) => {
  try {
    const logs = await prisma.auditLog.findMany({ take:100, orderBy:{ createdAt:'desc' }, include:{ user:{ select:{ nombre:true, cedula:true } } } });
    res.json({ ok: true, logs });
  } catch (e: any) { res.status(500).json({ ok:false, mensaje:e.message }); }
});

export default router;
