import { Router, Request, Response } from 'express';
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { prisma } from '../index';
import { authenticate, requireAdmin } from '../middleware/auth';
import { walletLimiter, webhookLimiter } from '../middleware/rateLimiter';
import { conCuenta, miembrosDe } from '../utils/cuentas';
import { logger } from '../utils/logger';
import { KushkiError } from '../utils/kushki';
import { enviarCobroAsync, kushkiOneConfigurado } from '../utils/kushkiOne';
import {
  comisionDatafonoPct, guardarComisionDatafonoPct, webhookDatafonoUrl, tokenWebhookValido,
  terminalOcupado, procesarEvento, resolverCobro, type CobroConTerminal,
} from '../utils/datafonos';
import { registrarWebhook } from '../utils/kushkiWebhookLog';

const router = Router();

const MONTO_MIN = 1000;
const MONTO_MAX = 50_000_000;

const mapCobro = (c: CobroConTerminal) => ({
  id: c.id,
  estado: c.estado,
  estadoTerminal: c.estadoTerminal,
  detalle: c.detalle,
  monto: Number(c.monto),
  terminal: c.terminal.alias,
  ticketNumber: c.ticketNumber,
  creado: c.createdAt,
});

// ══ GET /api/datafonos/terminales ══
// Los datáfonos que la cuenta puede usar: todos los de la empresa si es la cuenta padre; si es una sede, los asignados a
// ella y los que no tienen sede.
router.get('/terminales', authenticate, conCuenta('recargar'), async (req: Request, res: Response) => {
  const cuenta = req.cuenta!;
  const terminales = await prisma.terminalKushki.findMany({
    where: { titularId: cuenta.titularId, activo: true, ...(cuenta.esSubcuenta ? { OR: [{ sedeId: req.user!.id }, { sedeId: null }] } : {}) },
    orderBy: { alias: 'asc' },
  });
  const disponible = kushkiOneConfigurado() && !!webhookDatafonoUrl();
  const ocupados = await Promise.all(terminales.map((t) => terminalOcupado(t.id)));
  res.json({
    ok: true,
    disponible,
    terminales: terminales.map((t, i) => ({ id: t.id, alias: t.alias, modelo: t.modelo, ocupado: ocupados[i] })),
  });
});

// ══ POST /api/datafonos/cobros ══
const cobroSchema = z.object({ terminalId: z.string().uuid(), monto: z.number().int().min(MONTO_MIN).max(MONTO_MAX) });

router.post('/cobros', authenticate, walletLimiter, conCuenta('recargar'), async (req: Request, res: Response) => {
  const parse = cobroSchema.safeParse(req.body);
  if (!parse.success) return res.status(400).json({ ok: false, mensaje: `El monto debe ser un número entero entre ${MONTO_MIN.toLocaleString('es-CO')} y ${MONTO_MAX.toLocaleString('es-CO')} COP` });
  const { terminalId, monto } = parse.data;
  const cuenta = req.cuenta!;

  const webhookUrl = webhookDatafonoUrl();
  if (!kushkiOneConfigurado() || !webhookUrl) {
    return res.status(503).json({ ok: false, mensaje: 'El cobro con datáfono todavía no está habilitado' });
  }

  const terminal = await prisma.terminalKushki.findFirst({
    where: { id: terminalId, titularId: cuenta.titularId, activo: true, ...(cuenta.esSubcuenta ? { OR: [{ sedeId: req.user!.id }, { sedeId: null }] } : {}) },
  });
  if (!terminal) return res.status(404).json({ ok: false, mensaje: 'Datáfono no encontrado' });
  if (await terminalOcupado(terminal.id)) return res.status(409).json({ ok: false, mensaje: 'Ese datáfono tiene un cobro en curso. Espera a que termine' });

  const cobro = await prisma.cobroDatafono.create({
    data: { terminalId: terminal.id, userId: req.user!.id, clientTransactionId: randomUUID(), monto, comisionPct: await comisionDatafonoPct() },
    include: { terminal: true },
  });

  try {
    await enviarCobroAsync(terminal.serial, { monto, clientTransactionId: cobro.clientTransactionId, eventsWebhookUrl: webhookUrl, referencia: cobro.id });
  } catch (err: any) {
    const motivo = err instanceof KushkiError ? err.message : 'No se pudo enviar el cobro';
    await prisma.cobroDatafono.update({ where: { id: cobro.id }, data: { estado: 'error', detalle: motivo.slice(0, 200) } });
    logger.error('No se pudo enviar el cobro al datáfono', { err: err.message, codigo: err.codigo, terminal: terminal.serial, cobroId: cobro.id });
    return res.status(err instanceof KushkiError && err.status === 409 ? 409 : 502).json({ ok: false, mensaje: `No se pudo enviar el cobro al datáfono: ${motivo}` });
  }

  res.status(201).json({ ok: true, cobro: mapCobro(cobro) });
});

// Una sede solo ve sus cobros; la cuenta padre ve los de toda la empresa
async function idsVisibles(req: Request): Promise<string[]> {
  return req.cuenta!.esSubcuenta ? [req.user!.id] : miembrosDe(req.cuenta!.titularId);
}

// ══ GET /api/datafonos/cobros ══
router.get('/cobros', authenticate, conCuenta('recargar'), async (req: Request, res: Response) => {
  const cobros = await prisma.cobroDatafono.findMany({
    where: { userId: { in: await idsVisibles(req) } },
    include: { terminal: true },
    orderBy: { createdAt: 'desc' },
    take: 30,
  });
  res.json({ ok: true, cobros: cobros.map(mapCobro) });
});

// ══ GET /api/datafonos/cobros/:id ══
// La pantalla lo consulta cada pocos segundos. Si pasaron más de 20 s y sigue pendiente, además se le pregunta a Kushki
// (por si el aviso se perdió); ese error nunca rompe la respuesta.
router.get('/cobros/:id', authenticate, conCuenta('recargar'), async (req: Request, res: Response) => {
  const donde = { id: req.params.id, userId: { in: await idsVisibles(req) } };
  let cobro = await prisma.cobroDatafono.findFirst({ where: donde, include: { terminal: true } });
  if (!cobro) return res.status(404).json({ ok: false, mensaje: 'Cobro no encontrado' });

  if (cobro.estado === 'pendiente' && Date.now() - cobro.createdAt.getTime() > 20_000) {
    try {
      await resolverCobro(cobro);
      cobro = (await prisma.cobroDatafono.findFirst({ where: donde, include: { terminal: true } })) ?? cobro;
    } catch (err: any) {
      logger.warn('No se pudo consultar el cobro de datáfono', { err: err.message, cobroId: cobro.id });
    }
  }
  res.json({ ok: true, cobro: mapCobro(cobro) });
});

// ══ POST /api/datafonos/webhooks/:token ══
// Aviso de Kushki One por cada cambio de estado de un cobro. No trae firma: la URL lleva un código secreto, solo se
// aceptan avisos del terminal al que se le mandó el cobro y la aprobación se confirma siempre con Kushki antes de
// acreditar. Siempre 2xx salvo que haya que reintentar (Kushki no reintenta los 4xx).
router.post('/webhooks/:token', webhookLimiter, async (req: Request, res: Response) => {
  if (!process.env.KUSHKI_ONE_WEBHOOK_TOKEN) {
    logger.error('Webhook de datáfonos recibido sin KUSHKI_ONE_WEBHOOK_TOKEN configurado');
    return res.status(503).json({ ok: false });
  }
  if (!tokenWebhookValido(req.params.token)) {
    await registrarWebhook(req, { firmaValida: false, estadoHttp: 404, detalle: 'Datáfono · código de la URL inválido' });
    return res.status(404).json({ ok: false });
  }

  const cuerpo = req.body && typeof req.body === 'object' ? req.body : {};
  try {
    const r = await procesarEvento(cuerpo);
    await registrarWebhook(req, { ticket: typeof cuerpo.client_transaction_id === 'string' ? cuerpo.client_transaction_id : null, firmaValida: true, estadoHttp: r.http, detalle: `Datáfono · ${r.detalle}` });
    res.status(r.http).json({ ok: r.http < 400 });
  } catch (err: any) {
    logger.error('Error procesando el aviso del datáfono', { err: err.message });
    await registrarWebhook(req, { firmaValida: true, estadoHttp: 500, detalle: `Datáfono · error: ${String(err.message).slice(0, 120)}` });
    res.status(500).json({ ok: false });
  }
});

// ══════════════════════════════════════
// ADMIN
// ══════════════════════════════════════
const auditar = (req: Request, accion: string, registroId: string, datos: object) =>
  prisma.auditLog.create({ data: { userId: req.user!.id, accion, tabla: 'terminales_kushki', registroId, ip: req.ip, datos } }).catch(() => {});

const terminalSchema = z.object({
  serial: z.string().trim().regex(/^[A-Za-z0-9_-]{4,64}$/, 'El serial solo lleva letras, números, guion y guion bajo (4 a 64 caracteres)'),
  alias: z.string().trim().min(2).max(60),
  modelo: z.string().trim().min(2).max(40).optional(),
  titularId: z.string().uuid(),
  sedeId: z.string().uuid().nullable().optional(),
});

// La sede debe ser una cuenta hija de la misma empresa
async function validarSede(titularId: string, sedeId: string | null | undefined): Promise<string | null> {
  if (!sedeId) return null;
  const sede = await prisma.user.findUnique({ where: { id: sedeId }, select: { cuentaPadreId: true } });
  return sede?.cuentaPadreId === titularId ? null : 'La sede elegida no pertenece a esa empresa';
}

// GET /api/datafonos/admin/terminales
router.get('/admin/terminales', authenticate, requireAdmin, async (_req: Request, res: Response) => {
  const terminales = await prisma.terminalKushki.findMany({
    include: { titular: { select: { nombre: true } }, sede: { select: { nombre: true } }, _count: { select: { cobros: true } } },
    orderBy: [{ titularId: 'asc' }, { alias: 'asc' }],
  });
  res.json({
    ok: true,
    configurado: kushkiOneConfigurado() && !!webhookDatafonoUrl(),
    terminales: terminales.map((t) => ({
      id: t.id, serial: t.serial, alias: t.alias, modelo: t.modelo, activo: t.activo,
      titularId: t.titularId, titular: t.titular.nombre, sedeId: t.sedeId, sede: t.sede?.nombre ?? null, cobros: t._count.cobros,
    })),
  });
});

// POST /api/datafonos/admin/terminales
router.post('/admin/terminales', authenticate, requireAdmin, async (req: Request, res: Response) => {
  const parse = terminalSchema.safeParse(req.body);
  if (!parse.success) return res.status(400).json({ ok: false, mensaje: parse.error.errors[0].message });
  const { serial, alias, modelo, titularId, sedeId } = parse.data;

  const titular = await prisma.user.findUnique({ where: { id: titularId }, select: { cuentaPadreId: true, rol: true } });
  if (!titular || titular.cuentaPadreId || titular.rol !== 'usuario') {
    return res.status(400).json({ ok: false, mensaje: 'La empresa elegida no existe o es una sede (los datáfonos van en la cuenta padre)' });
  }
  const errorSede = await validarSede(titularId, sedeId);
  if (errorSede) return res.status(400).json({ ok: false, mensaje: errorSede });

  try {
    const t = await prisma.terminalKushki.create({ data: { serial, alias, modelo: modelo ?? 'Sunmi P3', titularId, sedeId: sedeId ?? null } });
    await auditar(req, 'CREAR_TERMINAL_KUSHKI', t.id, { serial, alias, titularId, sedeId: sedeId ?? null });
    res.status(201).json({ ok: true, id: t.id });
  } catch (err: any) {
    if (err.code === 'P2002') return res.status(409).json({ ok: false, mensaje: 'Ya existe un datáfono con ese serial' });
    throw err;
  }
});

// PUT /api/datafonos/admin/terminales/:id
const editarSchema = z.object({
  alias: z.string().trim().min(2).max(60).optional(),
  modelo: z.string().trim().min(2).max(40).optional(),
  sedeId: z.string().uuid().nullable().optional(),
  activo: z.boolean().optional(),
});

router.put('/admin/terminales/:id', authenticate, requireAdmin, async (req: Request, res: Response) => {
  const parse = editarSchema.safeParse(req.body);
  if (!parse.success) return res.status(400).json({ ok: false, mensaje: parse.error.errors[0].message });
  const actual = await prisma.terminalKushki.findUnique({ where: { id: req.params.id } });
  if (!actual) return res.status(404).json({ ok: false, mensaje: 'Datáfono no encontrado' });

  if (parse.data.sedeId !== undefined) {
    const errorSede = await validarSede(actual.titularId, parse.data.sedeId);
    if (errorSede) return res.status(400).json({ ok: false, mensaje: errorSede });
  }
  await prisma.terminalKushki.update({ where: { id: actual.id }, data: parse.data });
  await auditar(req, 'EDITAR_TERMINAL_KUSHKI', actual.id, { serial: actual.serial, cambios: parse.data });
  res.json({ ok: true });
});

// GET/PUT /api/datafonos/admin/config  → comisión de TrendPay sobre los cobros con datáfono (0 = sin comisión)
router.get('/admin/config', authenticate, requireAdmin, async (_req: Request, res: Response) => {
  res.json({ ok: true, comisionPct: await comisionDatafonoPct() });
});

router.put('/admin/config', authenticate, requireAdmin, async (req: Request, res: Response) => {
  const parse = z.object({ comisionPct: z.number().min(0).max(20) }).safeParse(req.body);
  if (!parse.success) return res.status(400).json({ ok: false, mensaje: 'La comisión debe estar entre 0% y 20%' });
  const anterior = await comisionDatafonoPct();
  await guardarComisionDatafonoPct(parse.data.comisionPct);
  await prisma.auditLog.create({ data: { userId: req.user!.id, accion: 'CAMBIAR_COMISION_DATAFONO', tabla: 'configs', registroId: 'comision_datafono_pct', ip: req.ip, datos: { antes: anterior, despues: parse.data.comisionPct } } }).catch(() => {});
  res.json({ ok: true, comisionPct: parse.data.comisionPct });
});

// GET /api/datafonos/admin/cobros  → últimos cobros de todos los datáfonos
router.get('/admin/cobros', authenticate, requireAdmin, async (_req: Request, res: Response) => {
  const cobros = await prisma.cobroDatafono.findMany({
    include: { terminal: { include: { titular: { select: { nombre: true } } } }, user: { select: { nombre: true } } },
    orderBy: { createdAt: 'desc' },
    take: 50,
  });
  res.json({
    ok: true,
    cobros: cobros.map((c) => ({
      id: c.id, estado: c.estado, estadoTerminal: c.estadoTerminal, detalle: c.detalle, monto: Number(c.monto), comisionPct: Number(c.comisionPct),
      terminal: c.terminal.alias, empresa: c.terminal.titular.nombre, cajero: c.user.nombre, ticketNumber: c.ticketNumber, creado: c.createdAt,
    })),
  });
});

export default router;
