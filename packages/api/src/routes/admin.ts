import { Router, Request, Response } from 'express';
import { z } from 'zod';
import bcrypt from 'bcryptjs';
import { randomUUID } from 'node:crypto';
import { prisma } from '../index';
import { authenticate, requireAdmin } from '../middleware/auth';
import { conciliarPagosPendientes } from '../utils/kushkiPayments';
import { TICKET_PRUEBA_WEBHOOK, firmarAvisoDePrueba } from '../utils/kushkiWebhook';
import { cifradoV2Activo } from '../utils/security';
import { getConfigTransferencias, solicitarTokenBreB, olvidarCacheBreB, AMBIENTES_KUSHKI, KushkiError } from '../utils/kushki';
import { cifrarLlavePrivada, credencialesDeComercio, terminaEn } from '../utils/comerciosKushki';
import { modoAlmacenamiento, cifradoDelBucket } from '../utils/storage';
import { PERMISOS_SEDE } from '../utils/cuentas';
import { logger } from '../utils/logger';
import { comisionGeneralPct, guardarComisionGeneralPct, COMISION_MAXIMA } from '../utils/comision';
import { comisionDatafonoPct } from '../utils/datafonos';
import { periodoDe, rangoDelPeriodo, filtroDeFecha, construirSerie, tipoDeCategoria } from '../utils/periodos';
import { contarDatos, limpiarDatos, limpiezaPermitida, FRASE_LIMPIEZA } from '../utils/limpiarDatos';
import { solicitarEliminacion, cancelarEliminacion, ErrorEliminacion } from '../utils/eliminarCuentas';

const router = Router();

// ══ GET /api/admin/metrics ══
// ?periodo=hoy|ayer|7d|15d|1m|3m|6m|12m|todo (por defecto todo): volumen, comisiones y operaciones se calculan dentro del periodo;
// el saldo, las billeteras y los retiros pendientes son el estado de ahora y no cambian con el filtro.
router.get('/metrics', authenticate, requireAdmin, async (req: Request, res: Response) => {
  try {
    const rango = rangoDelPeriodo(periodoDe(req.query.periodo));
    const [totalUsuarios, porCategoria, retirosPend, saldoAgg, billeteras] = await Promise.all([
      prisma.user.count({ where: { eliminadoAt: null } }),
      prisma.transaction.groupBy({
        by: ['categoria', 'status'], where: { categoria: { not: 'ajuste' }, createdAt: filtroDeFecha(rango) },
        _count: { _all: true }, _sum: { montoBruto: true, comisionValor: true },
      }),
      prisma.withdrawal.count({ where: { status: 'pendiente' } }).catch(() => 0),
      // Saldo real de todas las billeteras (no depende de cuántos usuarios cargue la pantalla)
      prisma.wallet.aggregate({ where: { user: { eliminadoAt: null } }, _sum: { saldo: true } }),
      prisma.wallet.count({ where: { user: { eliminadoAt: null } } }),
    ]);
    const n = (v: unknown) => Number.parseFloat(String(v ?? '0')) || 0;
    const por_tipo: Record<string, { cantidad: number; monto: number }> = {};
    let total_volumen = 0, total_comisiones = 0, operaciones = 0, exitosas = 0;
    for (const g of porCategoria) {
      const cantidad = g._count._all, monto = n(g._sum.montoBruto);
      total_volumen += monto; total_comisiones += n(g._sum.comisionValor);
      operaciones += cantidad; if (g.status === 'exitosa') exitosas += cantidad;
      const tipo = tipoDeCategoria(g.categoria);
      por_tipo[tipo] ??= { cantidad: 0, monto: 0 };
      por_tipo[tipo].cantidad += cantidad; por_tipo[tipo].monto += monto;
    }
    const comision_pct     = await comisionGeneralPct();
    const comision_datafono_pct = await comisionDatafonoPct();
    res.json({ ok: true, metricas: {
      total_usuarios: totalUsuarios, saldo_plataforma: n(saldoAgg._sum.saldo), billeteras, total_volumen, total_comisiones, retiros_pendientes: retirosPend,
      comision_pct, comision_datafono_pct, periodo: rango.periodo, periodo_etiqueta: rango.etiqueta, operaciones, operaciones_exitosas: exitosas, por_tipo,
    } });
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
      include: { wallet: true, cuentaPadre: { select: { nombre: true, wallet: true } } },
      // Las cuentas eliminadas ya no existen para el sistema: no salen en ningún listado
      where: { eliminadoAt: null, ...(q ? { OR: [
        { nombre: { contains: q, mode: 'insensitive' } },
        { cedula: { contains: q } },
        { correo: { contains: q, mode: 'insensitive' } },
      ]} : {}) },
    });
    res.json({
      ok: true,
      // Las subcuentas empresariales no tienen billetera propia: se muestra la de su padre.
      usuarios: users.map(u => { const saldo = Number.parseFloat((u.wallet ?? u.cuentaPadre?.wallet)?.saldo.toString() || '0'); return { id: u.id, cedula: u.cedula, nombre: u.nombre, correo: u.correo, celular: u.celular, ciudad: u.ciudad, rol: u.rol, subRol: u.subRol, kycNivel: u.kycNivel, kycVerificado: u.kycVerificado, bloqueado: u.bloqueado, saldo, cuentaPadre: u.cuentaPadre?.nombre ?? null, eliminacionProgramadaAt: u.eliminacionProgramadaAt, ultimoLogin: u.ultimoLogin, createdAt: u.createdAt }; }),
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
  // Ya no se crean administradores desde aquí: solo clientes (empresas, usuarios y sedes)
  rol:     z.literal('usuario', { errorMap: () => ({ message: 'No se pueden crear cuentas de administrador' }) }).optional(),
  // Si viene, la cuenta es una sede (subcuenta) de esa empresa: no tiene billetera propia y opera sobre la de su padre.
  // Todas las sedes nacen con el mismo formato (PERMISOS_SEDE): ya no se eligen permisos.
  cuentaPadreId:   z.string().uuid().optional(),
});

router.post('/users', authenticate, requireAdmin, async (req: Request, res: Response) => {
  const parse = createUserSchema.safeParse(req.body);
  if (!parse.success) return res.status(400).json({ ok: false, mensaje: parse.error.errors[0].message });
  const { cedula, nombre, correo, pin, celular, ciudad, cuentaPadreId } = parse.data;

  try {
    // Solo la cédula identifica a la cuenta: el correo puede repetirse (p. ej. una empresa y sus sedes)
    const exists = await prisma.user.findUnique({ where: { cedula } });
    if (exists) return res.status(400).json({ ok: false, mensaje: 'Esta cédula ya está registrada' });

    // Una sede solo puede colgar de una empresa (cuenta padre de un cliente), nunca de otra sede ni de un admin
    if (cuentaPadreId && !(await cuentaPadreOrNull(cuentaPadreId))) {
      return res.status(400).json({ ok: false, mensaje: 'La empresa elegida no existe o no puede tener sedes' });
    }

    const pinHash = await bcrypt.hash(pin, Number.parseInt(process.env.BCRYPT_ROUNDS || '12'));

    const user = await prisma.user.create({
      data: {
        id: randomUUID(),
        cedula, nombre, correo,
        celular: celular || null,
        ciudad: ciudad || null,
        pinHash,
        rol: 'usuario',
        ...(cuentaPadreId
          ? { cuentaPadreId, ...PERMISOS_SEDE }
          : { wallet: { create: { saldo: 0 } } }),
      },
      include: { wallet: true },
    });

    await prisma.auditLog.create({
      data: { userId: req.user!.id, accion: 'CREAR_USUARIO', tabla: 'users', registroId: user.id, ip: req.ip,
        datos: { despues: { nombre: user.nombre, correo: user.correo, cedula: user.cedula, rol: user.rol, cuentaPadreId: user.cuentaPadreId } } },
    }).catch(() => {});

    res.status(201).json({
      ok: true, mensaje: cuentaPadreId ? 'Sede creada' : 'Usuario creado',
      usuario: { id: user.id, cedula: user.cedula, nombre: user.nombre, correo: user.correo, celular: user.celular, ciudad: user.ciudad, rol: user.rol, cuentaPadreId: user.cuentaPadreId, saldo: 0 },
    });
  } catch (e: any) { res.status(500).json({ ok: false, mensaje: e.message }); }
});

// ══ PUT /api/admin/users/:id ══
router.put('/users/:id', authenticate, requireAdmin, async (req: Request, res: Response) => {
  try {
    const existing = await prisma.user.findUnique({ where: { id: req.params.id } });
    if (!existing) return res.status(404).json({ ok: false, mensaje: 'Usuario no encontrado' });

    const { nombre, correo, celular, ciudad, bloqueado, kycNivel, nuevo_pin, cuentaPadreId } = req.body;
    // Las cuentas de administrador nunca se bloquean (ni se eliminan): así nadie se queda sin acceso al panel
    if (existing.rol === 'admin' && bloqueado === true) {
      return res.status(400).json({ ok: false, mensaje: 'No se puede bloquear una cuenta de administrador' });
    }
    const data: any = {};
    const antes: any = {};
    const despues: any = {};

    // Pasar una sede a otra empresa. Solo las cuentas que YA son sede: convertir una cuenta con billetera propia
    // en sede haría perder su saldo. Y no mientras tenga operaciones en curso, porque se acreditarían a la
    // empresa equivocada (o con las llaves de Kushki de la anterior).
    if (cuentaPadreId !== undefined && cuentaPadreId !== existing.cuentaPadreId) {
      if (existing.cuentaPadreId === null) {
        return res.status(400).json({ ok: false, mensaje: 'Solo se puede cambiar de empresa a una cuenta que ya es sede' });
      }
      if (typeof cuentaPadreId !== 'string' || cuentaPadreId === existing.id || !(await cuentaPadreOrNull(cuentaPadreId))) {
        return res.status(400).json({ ok: false, mensaje: 'La empresa elegida no existe o no puede tener sedes' });
      }
      const [pagos, retiros] = await Promise.all([
        prisma.kushkiPayment.count({ where: { userId: existing.id, estado: 'pendiente' } }),
        prisma.withdrawal.count({ where: { userId: existing.id, status: { in: ['pendiente', 'en_proceso'] } } }),
      ]);
      if (pagos + retiros > 0) {
        return res.status(409).json({ ok: false, mensaje: `Esta sede tiene ${pagos + retiros} operación(es) en curso. Espera a que terminen para cambiarla de empresa` });
      }
      data.cuentaPadreId = cuentaPadreId; antes.cuentaPadreId = existing.cuentaPadreId; despues.cuentaPadreId = cuentaPadreId;
    }
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
// Sin saldo ni operaciones en curso se elimina al momento (se borran sus datos personales y sale del sistema). Con saldo
// se programa a 7 días: solo puede retirar y, vencido el plazo, se elimina sola cuando el saldo llega a cero.
router.delete('/users/:id', authenticate, requireAdmin, async (req: Request, res: Response) => {
  try {
    const r = await solicitarEliminacion(req.params.id, req.user!.id, req.ip);
    if (r.estado === 'eliminada') return res.json({ ok: true, estado: 'eliminada', mensaje: 'Cuenta eliminada' });
    const hasta = r.fecha.toLocaleDateString('es-CO', { day: 'numeric', month: 'long', year: 'numeric' });
    res.json({ ok: true, estado: 'programada', fecha: r.fecha, motivos: r.motivos, mensaje: `La cuenta tiene ${r.motivos.join(' y ')}. Tiene hasta el ${hasta} para retirar su saldo; después se eliminará sola.` });
  } catch (e: any) {
    if (e instanceof ErrorEliminacion) return res.status(e.status).json({ ok: false, mensaje: e.message });
    res.status(500).json({ ok: false, mensaje: e.message });
  }
});

// ══ GET/PUT /api/admin/comision ══
// La comisión general de TrendPay (consignaciones y envíos entre cuentas). Se guarda en la base de datos y aplica a las
// operaciones nuevas; las ya hechas conservan la comisión con la que se cobraron.
router.get('/comision', authenticate, requireAdmin, async (_req: Request, res: Response) => {
  res.json({ ok: true, comisionPct: await comisionGeneralPct() });
});

router.put('/comision', authenticate, requireAdmin, async (req: Request, res: Response) => {
  const parse = z.object({ comisionPct: z.number().min(0).max(COMISION_MAXIMA) }).safeParse(req.body);
  if (!parse.success) return res.status(400).json({ ok: false, mensaje: `La comisión debe estar entre 0% y ${COMISION_MAXIMA}%` });
  const anterior = await comisionGeneralPct();
  await guardarComisionGeneralPct(parse.data.comisionPct);
  await prisma.auditLog.create({ data: { userId: req.user!.id, accion: 'COMISION_MODIFICADA', tabla: 'configs', registroId: 'comision_pct', ip: req.ip, datos: { antes: { comision: anterior }, despues: { comision: parse.data.comisionPct } } } }).catch(() => {});
  res.json({ ok: true, comisionPct: parse.data.comisionPct });
});

// ══ GET /api/admin/alertas ══
// Alertas de riesgo calculadas con los datos de ahora (nada guardado ni inventado): si no hay nada que atender, la lista
// va vacía. Cada una apunta a la pantalla donde se resuelve.
const UMBRAL_RETIRO_ALERTA = 2_000_000; // un retiro de este monto o más pide revisión manual
const ORDEN_NIVEL = { alto: 0, medio: 1, info: 2 } as const;

router.get('/alertas', authenticate, requireAdmin, async (_req: Request, res: Response) => {
  try {
    const ahora = new Date();
    const hace = (min: number) => new Date(ahora.getTime() - min * 60_000);
    const [retiros, bloqueadas, pagos, cobrosRevision, reembolsos, eliminaciones, negativas] = await Promise.all([
      prisma.withdrawal.findMany({ where: { status: { in: ['pendiente', 'en_proceso'] } }, include: { user: { select: { nombre: true, cedula: true } } }, orderBy: { createdAt: 'asc' }, take: 100 }),
      prisma.user.findMany({ where: { eliminadoAt: null, bloqueadoHasta: { gt: ahora } }, select: { nombre: true, cedula: true, bloqueadoHasta: true, updatedAt: true }, take: 100 }),
      prisma.kushkiPayment.findMany({ where: { estado: 'pendiente', createdAt: { lte: hace(30) } }, orderBy: { createdAt: 'asc' }, take: 100 }),
      prisma.cobroDatafono.findMany({ where: { estado: 'revision' }, include: { terminal: { select: { alias: true } } }, take: 100 }),
      prisma.cobroDatafono.findMany({ where: { estado: 'reembolsando', updatedAt: { lte: hace(30) } }, include: { terminal: { select: { alias: true } } }, take: 100 }),
      prisma.user.findMany({ where: { eliminadoAt: null, eliminacionProgramadaAt: { lte: ahora } }, select: { id: true, nombre: true, cedula: true, eliminacionProgramadaAt: true }, take: 100 }),
      prisma.wallet.findMany({ where: { saldo: { lt: 0 }, user: { eliminadoAt: null } }, include: { user: { select: { nombre: true, cedula: true } } }, take: 100 }),
    ]);

    const cop = (n: number) => `$${Math.round(n).toLocaleString('es-CO')}`;
    const alertas: { id: string; nivel: keyof typeof ORDEN_NIVEL; titulo: string; detalle: string; fecha: Date; href?: string }[] = [];

    for (const r of retiros) {
      const monto = Number(r.monto);
      const horas = Math.floor((ahora.getTime() - r.createdAt.getTime()) / 3_600_000);
      const quien = `${r.user.nombre} · CC ${r.user.cedula}`;
      if (monto >= UMBRAL_RETIRO_ALERTA) alertas.push({ id: `retiro-alto-${r.id}`, nivel: 'alto', titulo: 'Retiro de monto alto', detalle: `${cop(monto)} · ${quien} · pide revisión manual (umbral ${cop(UMBRAL_RETIRO_ALERTA)})`, fecha: r.createdAt, href: '/admin/retiros' });
      if (horas >= 24) alertas.push({ id: `retiro-viejo-${r.id}`, nivel: horas >= 48 ? 'alto' : 'medio', titulo: 'Retiro esperando hace más de un día', detalle: `${cop(monto)} · ${quien} · lleva ${horas} h sin resolverse`, fecha: r.createdAt, href: '/admin/retiros' });
    }
    for (const u of bloqueadas) {
      alertas.push({ id: `bloqueo-${u.cedula}`, nivel: 'medio', titulo: 'Cuenta bloqueada por intentos fallidos de PIN', detalle: `${u.nombre} · CC ${u.cedula} · bloqueada hasta las ${u.bloqueadoHasta!.toLocaleTimeString('es-CO', { timeZone: 'America/Bogota', hour: '2-digit', minute: '2-digit' })}`, fecha: u.updatedAt, href: '/admin/usuarios' });
    }
    for (const p of pagos) {
      alertas.push({ id: `pago-${p.id}`, nivel: 'medio', titulo: 'Consignación sin confirmar', detalle: `${cop(Number(p.monto))} (${p.metodo.toUpperCase()}) lleva más de 30 minutos pendiente en Kushki`, fecha: p.createdAt, href: '/admin/pagos-kushki' });
    }
    for (const c of cobrosRevision) {
      alertas.push({ id: `cobro-revision-${c.id}`, nivel: 'alto', titulo: 'Cobro de datáfono en revisión', detalle: `${cop(Number(c.monto))} en ${c.terminal.alias}: ${c.detalle ?? 'el monto aprobado no coincide con el cobrado'}`, fecha: c.updatedAt, href: '/admin/datafonos' });
    }
    for (const c of reembolsos) {
      alertas.push({ id: `reembolso-${c.id}`, nivel: 'medio', titulo: 'Reembolso de datáfono sin confirmar', detalle: `${cop(Number(c.monto))} en ${c.terminal.alias} lleva más de 30 minutos esperando a Kushki`, fecha: c.updatedAt, href: '/admin/datafonos' });
    }
    for (const u of eliminaciones) {
      alertas.push({ id: `eliminacion-${u.id}`, nivel: 'info', titulo: 'Cuenta con plazo de eliminación vencido', detalle: `${u.nombre} · CC ${u.cedula} sigue con saldo u operaciones en curso; se eliminará sola cuando quede en cero`, fecha: u.eliminacionProgramadaAt!, href: '/admin/usuarios' });
    }
    for (const w of negativas) {
      alertas.push({ id: `saldo-negativo-${w.id}`, nivel: 'alto', titulo: 'Billetera con saldo negativo', detalle: `${w.user.nombre} · CC ${w.user.cedula} · ${cop(Number(w.saldo))}`, fecha: w.updatedAt, href: '/admin/usuarios' });
    }

    alertas.sort((a, b) => ORDEN_NIVEL[a.nivel] - ORDEN_NIVEL[b.nivel] || b.fecha.getTime() - a.fecha.getTime());
    res.json({ ok: true, alertas, reglas: { umbralRetiro: UMBRAL_RETIRO_ALERTA, intentosPin: 5, bloqueoMinutos: 30 } });
  } catch (e: any) { res.status(500).json({ ok: false, mensaje: e.message }); }
});

// ══ Limpieza de datos de prueba ══
// Borra el historial financiero y deja las billeteras en $0 (ver utils/limpiarDatos.ts). Irreversible: solo funciona si el
// servidor tiene PERMITIR_LIMPIEZA=1 y se escribe la frase de confirmación.
router.get('/limpieza', authenticate, requireAdmin, async (_req: Request, res: Response) => {
  try {
    res.json({ ok: true, habilitada: limpiezaPermitida(), frase: FRASE_LIMPIEZA, ...(await contarDatos()) });
  } catch (e: any) { res.status(500).json({ ok: false, mensaje: e.message }); }
});

router.post('/limpieza', authenticate, requireAdmin, async (req: Request, res: Response) => {
  if (!limpiezaPermitida()) {
    return res.status(403).json({ ok: false, mensaje: 'La limpieza está desactivada en el servidor. Activa la variable PERMITIR_LIMPIEZA=1 en Railway' });
  }
  if (req.body?.frase !== FRASE_LIMPIEZA) return res.status(400).json({ ok: false, mensaje: `Escribe exactamente "${FRASE_LIMPIEZA}" para confirmar` });
  try {
    const antes = await contarDatos();
    const despues = await limpiarDatos({ incluirVinculaciones: req.body?.incluirVinculaciones === true });
    // La auditoría queda vacía, como se pide para el lanzamiento; la constancia de quién la ejecutó queda en el registro del servidor
    logger.warn('Limpieza de datos ejecutada desde el panel', { adminId: req.user!.id, ip: req.ip, saldoBorrado: antes.saldoTotal });
    res.json({ ok: true, mensaje: 'Datos de prueba eliminados. Todas las billeteras quedaron en $0', antes, despues });
  } catch (e: any) { res.status(500).json({ ok: false, mensaje: e.message }); }
});

// ══ POST /api/admin/users/:id/cancelar-eliminacion ══
router.post('/users/:id/cancelar-eliminacion', authenticate, requireAdmin, async (req: Request, res: Response) => {
  try {
    await cancelarEliminacion(req.params.id, req.user!.id, req.ip);
    res.json({ ok: true, mensaje: 'Eliminación cancelada' });
  } catch (e: any) {
    if (e instanceof ErrorEliminacion) return res.status(e.status).json({ ok: false, mensaje: e.message });
    res.status(500).json({ ok: false, mensaje: e.message });
  }
});

// ══ GET /api/admin/transactions ══
router.get('/transactions', authenticate, requireAdmin, async (req: Request, res: Response) => {
  try {
    const limit = Number.parseInt(req.query.limit as string) || 300;
    const rango = rangoDelPeriodo(periodoDe(req.query.periodo));
    const txs = await prisma.transaction.findMany({
      where: { createdAt: filtroDeFecha(rango) },
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
// ?periodo=... (o, por compatibilidad, ?months=N). La gráfica se agrupa por hora, día, semana o mes según lo largo que sea el periodo.
router.get('/dashboard-chart', authenticate, requireAdmin, async (req: Request, res: Response) => {
  try {
    const meses = Number.parseInt(req.query.months as string);
    const periodo = req.query.periodo === undefined && meses ? (meses >= 12 ? '12m' : meses >= 6 ? '6m' : meses >= 3 ? '3m' : '1m') : periodoDe(req.query.periodo);
    const rango = rangoDelPeriodo(periodo);
    const txs = await prisma.transaction.findMany({
      where: { categoria: { not: 'ajuste' }, createdAt: filtroDeFecha(rango) },
      select: { montoBruto: true, comisionValor: true, createdAt: true },
    });
    const { granularidad, datos } = construirSerie(rango, txs.map((t) => ({ createdAt: t.createdAt, volumen: Number.parseFloat(t.montoBruto.toString()), comisiones: Number.parseFloat(t.comisionValor.toString()) })));
    res.json({ ok: true, periodo: rango.periodo, granularidad, datos });
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

    // NOSONAR: every regex here is a single quantified/negated character
    // class or an anchored literal - none can backtrack super-linearly,
    // there's no nested quantifier or overlapping alternation to exploit.
    const slug = String(nombre).trim().toLowerCase()
      .normalize('NFD').replace(/[\u0300-\u036f]/g, '') // quita tildes
      .replace(/[^a-z0-9]+/g, '-').replace(/^-+/, '').replace(/-+$/, ''); // NOSONAR
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

// ══ GET /api/admin/kushki/pagos ══
// Consignaciones por Kushki (tarjeta y PSE) con totales por estado.
router.get('/kushki/pagos', authenticate, requireAdmin, async (req: Request, res: Response) => {
  try {
    const estado = typeof req.query.estado === 'string' && req.query.estado ? req.query.estado : undefined;
    const fecha = filtroDeFecha(rangoDelPeriodo(periodoDe(req.query.periodo)));
    const [pagos, totales] = await Promise.all([
      prisma.kushkiPayment.findMany({
        where: { createdAt: fecha, ...(estado ? { estado } : {}) },
        orderBy: { createdAt: 'desc' },
        take: 100,
        include: { user: { select: { nombre: true, cedula: true } } },
      }),
      prisma.kushkiPayment.groupBy({ by: ['estado'], where: { createdAt: fecha }, _count: { _all: true }, _sum: { monto: true } }),
    ]);

    res.json({
      ok: true,
      totales: totales.map((t) => ({ estado: t.estado, cantidad: t._count._all, monto: Number(t._sum.monto ?? 0) })),
      pagos: pagos.map((p) => ({
        id: p.id,
        metodo: p.metodo,
        estado: p.estado,
        monto: Number(p.monto),
        ticketNumber: p.ticketNumber,
        createdAt: p.createdAt,
        usuario: p.user.nombre,
        cedula: p.user.cedula,
      })),
    });
  } catch (e: any) { res.status(500).json({ ok: false, mensaje: e.message }); }
});

// ══ GET /api/admin/kushki/webhooks ══
// Últimas llamadas que recibió el webhook de Kushki, válidas o no, para ver si Kushki está llamando.
router.get('/kushki/webhooks', authenticate, requireAdmin, async (_req: Request, res: Response) => {
  try {
    const [avisos, configurado] = await Promise.all([
      prisma.kushkiWebhookLog.findMany({ orderBy: { createdAt: 'desc' }, take: 50 }),
      Promise.resolve(!!process.env.KUSHKI_WEBHOOK_SECRET),
    ]);
    res.json({ ok: true, secretoConfigurado: configurado, avisos });
  } catch (e: any) { res.status(500).json({ ok: false, mensaje: e.message }); }
});

// ══ GET /api/admin/kushki/config-transferencias ══
// Qué métodos de consignación por transferencia tiene habilitados el comercio en Kushki (PSE, Bre-B/QR).
router.get('/kushki/config-transferencias', authenticate, requireAdmin, async (_req: Request, res: Response) => {
  try {
    const config = await getConfigTransferencias();
    // Con qué comercio se hizo la consulta (la llave pública no es secreta, pero se muestra solo el final):
    // sirve para compararla con la de la consola de Kushki si la respuesta no es la esperada.
    const publica = process.env.KUSHKI_PUBLIC_MERCHANT_ID || '';
    res.json({
      ok: true,
      ...config,
      entorno: {
        urlBase: process.env.KUSHKI_BASE_URL || 'https://api-uat.kushkipagos.com',
        llavePublicaTermina: publica ? `…${publica.slice(-4)}` : null,
        llavePublicaConfigurada: !!publica,
      },
    });
  } catch (e: any) {
    const status = e instanceof KushkiError ? e.status : 500;
    res.status(status).json({ ok: false, mensaje: e.message || 'No se pudo consultar la configuración de Kushki', respuesta: e instanceof KushkiError ? e.respuesta : undefined });
  }
});

// ══ Branches de Kushki por cliente ══
// Cada cuenta padre tiene su propio Branch (llaves propias) para los QR de Bre-B. El admin solo los administra
// y los ve todos; la llave privada se guarda cifrada y jamás se devuelve.
const comercioSchema = z.object({
  publicMerchantId: z.string().trim().regex(/^[A-Za-z0-9]{20,64}$/, 'La Public Key no tiene el formato esperado'),
  privateMerchantId: z.string().trim().regex(/^[A-Za-z0-9]{20,64}$/, 'La Private Key no tiene el formato esperado'),
  ambiente: z.enum(['produccion', 'pruebas']).default('produccion'),
  activo: z.boolean().default(true),
});

const coincide = (q: string) => [
  { nombre: { contains: q, mode: 'insensitive' as const } },
  { cedula: { contains: q } },
  { correo: { contains: q, mode: 'insensitive' as const } },
];

async function cuentaPadreOrNull(userId: string) {
  const u = await prisma.user.findUnique({ where: { id: userId }, select: { id: true, nombre: true, rol: true, cuentaPadreId: true, eliminadoAt: true, eliminacionProgramadaAt: true } });
  return u && u.rol === 'usuario' && u.cuentaPadreId === null && !u.eliminadoAt && !u.eliminacionProgramadaAt ? u : null;
}

// GET /api/admin/kushki/comercios?q=&page=&limit=  → todas las cuentas padre con el estado de su Branch
router.get('/kushki/comercios', authenticate, requireAdmin, async (req: Request, res: Response) => {
  try {
    const q = typeof req.query.q === 'string' ? req.query.q.trim() : '';
    const page = Math.max(1, Number.parseInt(req.query.page as string) || 1);
    const limit = Math.min(200, Math.max(1, Number.parseInt(req.query.limit as string) || 50));
    // todos=1 incluye también a los administradores (la pantalla de Usuarios muestra a todos); sin eso, solo clientes
    const incluirAdmins = req.query.todos === '1';
    const where = {
      ...(incluirAdmins ? {} : { rol: 'usuario' }),
      cuentaPadreId: null,
      eliminadoAt: null,
      // La búsqueda también encuentra una sede (subcuenta): se muestra su empresa
      ...(q ? { OR: [
        ...coincide(q),
        { subcuentas: { some: { OR: coincide(q) } } },
      ] } : {}),
    };
    const datosUsuario = { id: true, nombre: true, cedula: true, correo: true, celular: true, ciudad: true, rol: true, subRol: true, kycNivel: true, kycVerificado: true, bloqueado: true, ultimoLogin: true, eliminacionProgramadaAt: true } as const;
    const [total, configurados, cuentas] = await Promise.all([
      prisma.user.count({ where }),
      prisma.comercioKushki.count({ where: { user: where } }),
      prisma.user.findMany({
        where, orderBy: { nombre: 'asc' }, skip: (page - 1) * limit, take: limit,
        select: {
          ...datosUsuario, comercioKushki: true, wallet: { select: { saldo: true } },
          // Las sedes de la empresa: operan con el Branch y la billetera de la cuenta padre
          subcuentas: { orderBy: { nombre: 'asc' }, select: { ...datosUsuario, permisoRecargar: true } },
        },
      }),
    ]);
    const basico = (u: { id: string } & Record<string, unknown>) => ({ ...u, userId: u.id });
    res.json({
      ok: true, total, configurados, page, limit,
      cuentas: cuentas.map(({ comercioKushki, wallet, subcuentas, ...c }) => ({
        ...basico(c),
        saldo: Number.parseFloat(wallet?.saldo.toString() || '0'),
        subcuentas: subcuentas.map(({ permisoRecargar, ...s }) => ({ ...basico(s), bloqueada: s.bloqueado, puedeRecargar: permisoRecargar })),
        comercio: comercioKushki ? {
          activo: comercioKushki.activo,
          ambiente: comercioKushki.ambiente,
          publicTermina: terminaEn(comercioKushki.publicMerchantId),
          actualizado: comercioKushki.updatedAt,
        } : null,
      })),
    });
  } catch (e: any) { res.status(500).json({ ok: false, mensaje: e.message }); }
});

// PUT /api/admin/kushki/comercios/:userId  → guarda (o reemplaza) las llaves del Branch del cliente
router.put('/kushki/comercios/:userId', authenticate, requireAdmin, async (req: Request, res: Response) => {
  const parse = comercioSchema.safeParse(req.body);
  if (!parse.success) return res.status(400).json({ ok: false, mensaje: parse.error.issues[0].message });
  try {
    const cuenta = await cuentaPadreOrNull(req.params.userId);
    if (!cuenta) return res.status(404).json({ ok: false, mensaje: 'Cuenta no encontrada (solo las cuentas padre tienen Branch de Kushki)' });

    const { publicMerchantId, privateMerchantId, ambiente, activo } = parse.data;
    // Se prueba la Public Key contra Kushki antes de guardar. La privada no se puede comprobar sin hacer un cobro.
    const cred = { publicId: publicMerchantId, privateId: privateMerchantId, baseUrl: AMBIENTES_KUSHKI[ambiente] };
    let verificado = false;
    let breb = false;
    try {
      const config = await getConfigTransferencias(cred);
      verificado = true;
      breb = config.procesadores.some((p) => p.tipo === 'bre-b' && p.canales.includes('QR'));
    } catch (e: any) {
      if (e instanceof KushkiError && (e.status === 401 || e.status === 403)) {
        return res.status(400).json({ ok: false, mensaje: `Kushki rechazó esa Public Key en ${ambiente}. Revisa que sea la del Branch y que el ambiente sea el correcto` });
      }
      // Kushki caído o con error: se guarda igual y se avisa que no quedó verificado
    }

    const datos = { publicMerchantId, privateMerchantIdCif: cifrarLlavePrivada(privateMerchantId), ambiente, activo };
    await prisma.comercioKushki.upsert({ where: { userId: cuenta.id }, create: { userId: cuenta.id, ...datos }, update: datos });
    olvidarCacheBreB();
    await prisma.auditLog.create({ data: { userId: req.user!.id, accion: 'GUARDAR_COMERCIO_KUSHKI', tabla: 'comercios_kushki', registroId: cuenta.id, ip: req.ip, datos: { ambiente, activo, publicTermina: terminaEn(publicMerchantId), verificado, breb } } }).catch(() => {});
    res.json({ ok: true, verificado, brebHabilitado: breb });
  } catch (e: any) { res.status(500).json({ ok: false, mensaje: e.message }); }
});

// POST /api/admin/kushki/comercios/:userId/verificar  → qué procesadores tiene activos el Branch del cliente
router.post('/kushki/comercios/:userId/verificar', authenticate, requireAdmin, async (req: Request, res: Response) => {
  try {
    const comercio = await prisma.comercioKushki.findUnique({ where: { userId: req.params.userId } });
    if (!comercio) return res.status(404).json({ ok: false, mensaje: 'Este cliente aún no tiene un Branch configurado' });
    const cred = credencialesDeComercio(comercio);
    if (!cred) return res.status(500).json({ ok: false, mensaje: 'No se pudo leer la llave guardada (cambió la llave de cifrado). Vuelve a pegar las llaves' });

    olvidarCacheBreB();
    const config = await getConfigTransferencias(cred);
    res.json({
      ok: true,
      procesadores: config.procesadores,
      respuesta: config.respuesta,
      brebHabilitado: config.procesadores.some((p) => p.tipo === 'bre-b' && p.canales.includes('QR')),
      entorno: { urlBase: cred.baseUrl, llavePublicaTermina: terminaEn(cred.publicId) },
    });
  } catch (e: any) {
    const status = e instanceof KushkiError ? e.status : 500;
    res.status(status).json({ ok: false, mensaje: e.message || 'No se pudo consultar a Kushki', respuesta: e instanceof KushkiError ? e.respuesta : undefined });
  }
});

// DELETE /api/admin/kushki/comercios/:userId  → quita el Branch (no si hay QR pendientes, que necesitan esas llaves)
router.delete('/kushki/comercios/:userId', authenticate, requireAdmin, async (req: Request, res: Response) => {
  try {
    const comercio = await prisma.comercioKushki.findUnique({ where: { userId: req.params.userId } });
    if (!comercio) return res.status(404).json({ ok: false, mensaje: 'Este cliente no tiene un Branch configurado' });
    const pendientes = await prisma.kushkiPayment.count({ where: { comercioId: comercio.id, estado: 'pendiente' } });
    if (pendientes > 0) return res.status(409).json({ ok: false, mensaje: `Hay ${pendientes} pago(s) pendientes con este Branch. Desactívalo en lugar de quitarlo, o espera a que se resuelvan` });
    await prisma.comercioKushki.delete({ where: { id: comercio.id } });
    olvidarCacheBreB();
    await prisma.auditLog.create({ data: { userId: req.user!.id, accion: 'QUITAR_COMERCIO_KUSHKI', tabla: 'comercios_kushki', registroId: req.params.userId, ip: req.ip } }).catch(() => {});
    res.json({ ok: true });
  } catch (e: any) { res.status(500).json({ ok: false, mensaje: e.message }); }
});

// ══ POST /api/admin/kushki/bre-b/probar-token ══
// Pide a Kushki un token Bre-B (QR) de prueba. No cobra ni acredita nada: sirve para confirmar que el
// procesador está activo y ver la respuesta real. El token se muestra recortado.
router.post('/kushki/bre-b/probar-token', authenticate, requireAdmin, async (req: Request, res: Response) => {
  const monto = Number(req.body?.monto ?? 10000);
  if (!Number.isInteger(monto) || monto < 1000 || monto > 5_000_000) {
    return res.status(400).json({ ok: false, mensaje: 'El monto de prueba debe ser un entero entre 1.000 y 5.000.000' });
  }
  try {
    const r = await solicitarTokenBreB(monto);
    await prisma.auditLog.create({ data: { userId: req.user!.id, accion: 'PROBAR_TOKEN_BREB_KUSHKI', tabla: 'kushki', ip: req.ip, datos: { monto, obtuvoToken: !!r.token } } }).catch(() => {});
    res.json({ ok: true, procesador: r.procesador, tokenObtenido: !!r.token, tokenParcial: r.token ? `${r.token.slice(0, 6)}…` : null, respuesta: r.token ? undefined : r.respuesta });
  } catch (e: any) {
    const status = e instanceof KushkiError ? e.status : 500;
    res.status(status).json({ ok: false, mensaje: e.message || 'No se pudo pedir el token Bre-B', respuesta: e instanceof KushkiError ? e.respuesta : undefined });
  }
});

// ══ GET /api/admin/seguridad/estado ══
// Qué protecciones están activas. Solo muestra si cada una está encendida: nunca valores ni llaves.
router.get('/seguridad/estado', authenticate, requireAdmin, async (_req: Request, res: Response) => {
  try {
    const noV2 = { not: { startsWith: 'v2:' } };
    const [cuentas, retiros, enlaces, archivosBd] = await Promise.all([
      prisma.bankAccount.count({ where: { numeroCuenta: noV2 } }),
      prisma.withdrawal.count({ where: { numeroCuenta: noV2 } }),
      prisma.vinculacion.count({ where: { tokenCifrado: noV2 } }), // los NULL (sin enlace guardado) quedan fuera solos
      prisma.vinculacionArchivo.count(),
    ]);
    const modo = modoAlmacenamiento();
    const cifradoBucket = Object.keys(cifradoDelBucket()).length === 0 ? 'ninguno'
      : (process.env.S3_KMS_KEY_ID?.trim() ? 'kms' : 's3');
    const kms = cifradoV2Activo();
    const secretos = !!process.env.AWS_SECRETS_ID;
    const pendientes = { cuentasBancarias: cuentas, retiros, enlaces };
    const porMigrar = cuentas + retiros + enlaces;

    const alertas: string[] = [];
    if (!secretos) alertas.push('Las credenciales siguen solo en las variables de Railway (falta AWS Secrets Manager).');
    if (!kms) alertas.push('La llave de cifrado de datos no está protegida por AWS KMS.');
    if (kms && porMigrar > 0) alertas.push(`Hay ${porMigrar} registros todavía cifrados con la llave antigua: falta ejecutar el script de re-cifrado.`);
    if (modo === 's3' && cifradoBucket === 'ninguno') alertas.push('El bucket de documentos no tiene cifrado con tu llave de KMS (falta S3_KMS_KEY_ID).');
    if (modo === 'bd' && kms === false) alertas.push('Los documentos se guardan en la base de datos con la llave antigua.');

    res.json({
      ok: true,
      secretosAws: { activo: secretos, cargados: Number(process.env.TP_SECRETOS_AWS || 0) },
      llaveKms: kms,
      almacenamiento: { modo, cifradoBucket, archivosEnBaseDeDatos: archivosBd },
      pendientesDeMigrar: pendientes,
      alertas,
    });
  } catch (e: any) { res.status(500).json({ ok: false, mensaje: e.message }); }
});

// ══ POST /api/admin/kushki/webhooks/probar ══
// El servidor se manda a sí mismo un aviso firmado con el secreto real, por la misma ruta pública que usa
// Kushki. Confirma que el secreto, la firma y el registro funcionan, sin que nadie tenga que ver el secreto.
router.post('/kushki/webhooks/probar', authenticate, requireAdmin, async (req: Request, res: Response) => {
  const secreto = process.env.KUSHKI_WEBHOOK_SECRET;
  if (!secreto) return res.status(400).json({ ok: false, mensaje: 'Falta KUSHKI_WEBHOOK_SECRET en el servidor' });

  const proto = req.get('x-forwarded-proto')?.split(',')[0].trim() || req.protocol;
  const host = req.get('x-forwarded-host')?.split(',')[0].trim() || req.get('host');
  const id = Date.now().toString();
  const cuerpo = JSON.stringify({ ticketNumber: TICKET_PRUEBA_WEBHOOK, transactionStatus: 'APPROVAL', origen: 'prueba-interna' });

  try {
    const respuesta = await fetch(`${proto}://${host}/api/kushki/webhooks/payout`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Kushki-Id': id,
        'X-Kushki-Signature': firmarAvisoDePrueba(cuerpo, id, secreto),
        'User-Agent': 'TrendPay-prueba-interna',
      },
      body: cuerpo,
      signal: AbortSignal.timeout(10000),
    });
    await prisma.auditLog.create({ data: { userId: req.user!.id, accion: 'PROBAR_WEBHOOK_KUSHKI', tabla: 'kushki_webhook_logs', ip: req.ip, datos: { estadoHttp: respuesta.status } } }).catch(() => {});
    res.json({ ok: respuesta.ok, estadoHttp: respuesta.status, mensaje: respuesta.ok ? 'La prueba firmada fue aceptada' : `El servidor respondió ${respuesta.status}` });
  } catch (e: any) {
    res.status(502).json({ ok: false, mensaje: `No se pudo completar la prueba: ${e.message}` });
  }
});

// ══ DELETE /api/admin/kushki/webhooks ══
// Vacía el registro de avisos (por ejemplo para quitar las pruebas). Queda constancia en la auditoría.
router.delete('/kushki/webhooks', authenticate, requireAdmin, async (req: Request, res: Response) => {
  try {
    const { count } = await prisma.kushkiWebhookLog.deleteMany();
    await prisma.auditLog.create({ data: { userId: req.user!.id, accion: 'LIMPIAR_AVISOS_KUSHKI', tabla: 'kushki_webhook_logs', ip: req.ip, datos: { eliminados: count } } }).catch(() => {});
    res.json({ ok: true, eliminados: count });
  } catch (e: any) { res.status(500).json({ ok: false, mensaje: e.message }); }
});

// ══ POST /api/admin/kushki/conciliar ══
// Fuerza ahora la misma conciliación que corre cada 5 minutos.
router.post('/kushki/conciliar', authenticate, requireAdmin, async (_req: Request, res: Response) => {
  try {
    const resumen = await conciliarPagosPendientes({ minEdadMin: 0 });
    res.json({ ok: true, resumen });
  } catch (e: any) { res.status(500).json({ ok: false, mensaje: e.message }); }
});

export default router;
