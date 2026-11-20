import { Router, Request, Response } from 'express';
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { prisma } from '../index';
import { authenticate, requireAdmin } from '../middleware/auth';
import { walletLimiter, webhookLimiter } from '../middleware/rateLimiter';
import { conCuenta, miembrosDe } from '../utils/cuentas';
import { logger } from '../utils/logger';
import { KushkiError } from '../utils/kushki';
import { enviarCobroAsync, enviarReembolsoAsync, businessCodeDeTitular, infoTerminal } from '../utils/kushkiOne';
import {
  comisionDatafonoPct, guardarComisionDatafonoPct, webhookDatafonoUrl, tokenWebhookValido, datafonosListosParaEmpresa, urlPublicaApi,
  terminalOcupado, procesarEvento, resolverCobro, resolverReembolso, netoDelCobro, type CobroConTerminal,
} from '../utils/datafonos';
import { registrarWebhook } from '../utils/kushkiWebhookLog';
import { encrypt } from '../utils/security';
import { terminaEn } from '../utils/comerciosKushki';

const router = Router();

// El mensaje de Kushki con su código, para que quien lo lea pueda decirle a Kushki exactamente qué pasó
function descripcionDeError(err: KushkiError): string {
  const codigo = err.codigo ? ` [${err.codigo}]` : '';
  return `${err.message}${codigo}`;
}

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
  neto: netoDelCobro(c),
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
  const disponible = (await datafonosListosParaEmpresa(cuenta.titularId)).listo;
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

  const terminal = await prisma.terminalKushki.findFirst({
    where: { id: terminalId, titularId: cuenta.titularId, activo: true, ...(cuenta.esSubcuenta ? { OR: [{ sedeId: req.user!.id }, { sedeId: null }] } : {}) },
  });
  if (!terminal) return res.status(404).json({ ok: false, mensaje: 'Datáfono no encontrado' });

  // La empresa dueña del datáfono necesita su Business-Code de Kushki One y la dirección pública del API
  const webhookUrl = await webhookDatafonoUrl();
  if (!webhookUrl || !(await datafonosListosParaEmpresa(cuenta.titularId)).listo) {
    return res.status(503).json({ ok: false, mensaje: 'El cobro con datáfono todavía no está habilitado para esta empresa' });
  }
  if (await terminalOcupado(terminal.id)) return res.status(409).json({ ok: false, mensaje: 'Ese datáfono tiene un cobro en curso. Espera a que termine' });

  const cobro = await prisma.cobroDatafono.create({
    data: { terminalId: terminal.id, userId: req.user!.id, clientTransactionId: randomUUID(), monto, comisionPct: await comisionDatafonoPct() },
    include: { terminal: true },
  });

  try {
    await enviarCobroAsync(terminal.serial, { monto, clientTransactionId: cobro.clientTransactionId, eventsWebhookUrl: webhookUrl, referencia: cobro.id });
  } catch (err: any) {
    const motivo = err instanceof KushkiError ? descripcionDeError(err) : 'No se pudo enviar el cobro';
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

// ══ POST /api/datafonos/cobros/:id/reembolsar ══
// Anula un cobro aprobado: le pide a Kushki la anulación (void) por el terminal y, cuando Kushki la confirma, descuenta de la
// billetera lo que se había acreditado. Solo la cuenta principal; la billetera debe tener saldo para cubrirlo.
router.post('/cobros/:id/reembolsar', authenticate, walletLimiter, conCuenta('recargar'), async (req: Request, res: Response) => {
  const cuenta = req.cuenta!;
  if (cuenta.esSubcuenta) return res.status(403).json({ ok: false, mensaje: 'Solo la cuenta principal puede hacer reembolsos' });

  const cobro = await prisma.cobroDatafono.findFirst({ where: { id: req.params.id, terminal: { titularId: cuenta.titularId } }, include: { terminal: true } });
  if (!cobro) return res.status(404).json({ ok: false, mensaje: 'Cobro no encontrado' });

  const webhookUrl = await webhookDatafonoUrl();
  if (!webhookUrl || !(await datafonosListosParaEmpresa(cuenta.titularId)).listo) return res.status(503).json({ ok: false, mensaje: 'El cobro con datáfono todavía no está habilitado para esta empresa' });
  if (cobro.estado !== 'aprobado') return res.status(409).json({ ok: false, mensaje: cobro.estado === 'reembolsando' ? 'Este cobro ya tiene un reembolso en curso' : cobro.estado === 'reembolsado' ? 'Este cobro ya fue reembolsado' : 'Solo se pueden reembolsar cobros aprobados' });
  if (!cobro.transactionReference) return res.status(409).json({ ok: false, mensaje: 'Este cobro no tiene la referencia de Kushki necesaria para reembolsarlo' });
  // Kushki pide esperar al menos 1 minuto después del cobro antes de anularlo (se cuenta desde que se inició el cobro)
  if (Date.now() - cobro.createdAt.getTime() < 90_000) return res.status(409).json({ ok: false, mensaje: 'Espera un minuto después del cobro para reembolsarlo' });

  const neto = netoDelCobro(cobro);
  const wallet = await prisma.wallet.findUnique({ where: { userId: cuenta.titularId } });
  if (!wallet || Number(wallet.saldo) < neto) return res.status(409).json({ ok: false, mensaje: 'La billetera no tiene saldo suficiente para cubrir este reembolso' });
  if (await terminalOcupado(cobro.terminalId)) return res.status(409).json({ ok: false, mensaje: 'Ese datáfono tiene un cobro en curso. Espera a que termine' });

  // Se "reclama" el cobro antes de pedírselo a Kushki: dos clics seguidos no mandan dos anulaciones
  const reembolsoClientId = randomUUID();
  const reclamo = await prisma.cobroDatafono.updateMany({ where: { id: cobro.id, estado: 'aprobado' }, data: { estado: 'reembolsando', reembolsoClientId, reembolsadoPor: req.user!.id, detalle: null } });
  if (reclamo.count === 0) return res.status(409).json({ ok: false, mensaje: 'Este cobro ya tiene un reembolso en curso' });

  try {
    await enviarReembolsoAsync(cobro.terminal.serial, { monto: Number(cobro.monto), transactionReference: cobro.transactionReference, clientTransactionId: reembolsoClientId, eventsWebhookUrl: webhookUrl });
  } catch (err: any) {
    const motivo = err instanceof KushkiError ? descripcionDeError(err) : 'No se pudo enviar el reembolso';
    await prisma.cobroDatafono.updateMany({ where: { id: cobro.id, estado: 'reembolsando' }, data: { estado: 'aprobado', reembolsoClientId: null, detalle: motivo.slice(0, 200) } });
    logger.error('No se pudo enviar el reembolso al datáfono', { err: err.message, codigo: err.codigo, cobroId: cobro.id });
    return res.status(err instanceof KushkiError && err.status === 409 ? 409 : 502).json({ ok: false, mensaje: `No se pudo enviar el reembolso: ${motivo}` });
  }
  res.status(202).json({ ok: true, mensaje: 'Reembolso enviado. La billetera se descuenta cuando Kushki lo confirme', cobro: mapCobro({ ...cobro, estado: 'reembolsando' }) });
});

// ══ GET /api/datafonos/cobros/:id ══
// La pantalla lo consulta cada pocos segundos. Si pasaron más de 20 s y sigue pendiente, además se le pregunta a Kushki
// (por si el aviso se perdió); ese error nunca rompe la respuesta.
router.get('/cobros/:id', authenticate, conCuenta('recargar'), async (req: Request, res: Response) => {
  const donde = { id: req.params.id, userId: { in: await idsVisibles(req) } };
  let cobro = await prisma.cobroDatafono.findFirst({ where: donde, include: { terminal: true } });
  if (!cobro) return res.status(404).json({ ok: false, mensaje: 'Cobro no encontrado' });

  const enReembolso = cobro.estado === 'reembolsando';
  if ((cobro.estado === 'pendiente' || enReembolso) && Date.now() - (enReembolso ? cobro.updatedAt : cobro.createdAt).getTime() > 20_000) {
    try {
      await (enReembolso ? resolverReembolso(cobro) : resolverCobro(cobro));
      cobro = (await prisma.cobroDatafono.findFirst({ where: donde, include: { terminal: true } })) ?? cobro;
    } catch (err: any) {
      logger.warn('No se pudo consultar el cobro de datáfono', { err: err.message, cobroId: cobro.id });
    }
  }
  res.json({ ok: true, cobro: mapCobro(cobro) });
});

// ══ Resumen de ventas por tienda ══
// Lo cobrado y aprobado en cada tienda (sede) y en cada datáfono. Una sede solo ve lo suyo; la empresa ve todas sus tiendas.
const DESFASE_COLOMBIA_MS = 5 * 3_600_000; // Colombia es UTC-5 todo el año
const PERIODOS = ['hoy', '7d', 'mes'] as const;
type Periodo = typeof PERIODOS[number];

// Inicio del período en hora de Colombia (como instante UTC)
export function inicioDePeriodo(periodo: Periodo, ahora = Date.now()): Date {
  const local = new Date(ahora - DESFASE_COLOMBIA_MS); // sus campos UTC son la hora de Colombia
  const dia = Date.UTC(local.getUTCFullYear(), local.getUTCMonth(), local.getUTCDate());
  const inicioLocal = periodo === 'hoy' ? dia : periodo === '7d' ? dia - 6 * 86_400_000 : Date.UTC(local.getUTCFullYear(), local.getUTCMonth(), 1);
  return new Date(inicioLocal + DESFASE_COLOMBIA_MS);
}

interface FilaResumen { cobros: number; bruto: number; comision: number; neto: number }
const vacia = (): FilaResumen => ({ cobros: 0, bruto: 0, comision: 0, neto: 0 });
function sumar(fila: FilaResumen, monto: number, pct: number) {
  const comision = Math.round((monto * pct) / 100);
  fila.cobros += 1; fila.bruto += monto; fila.comision += comision; fila.neto += monto - comision;
}

async function resumenDeCobros(where: object, desde: Date) {
  const cobros = await prisma.cobroDatafono.findMany({
    where: { estado: 'aprobado', createdAt: { gte: desde }, ...where },
    select: { monto: true, comisionPct: true, terminal: { select: { id: true, alias: true, sedeId: true, sede: { select: { nombre: true } }, titular: { select: { id: true, nombre: true } } } } },
  });
  const total = vacia();
  const tiendas = new Map<string, FilaResumen & { empresa: string; sedeId: string | null; nombre: string; terminales: Map<string, FilaResumen & { id: string; alias: string }> }>();
  for (const c of cobros) {
    const monto = Number(c.monto);
    const pct = Number(c.comisionPct);
    const t = c.terminal;
    const clave = `${t.titular.id}:${t.sedeId ?? ''}`;
    let tienda = tiendas.get(clave);
    if (!tienda) { tienda = { ...vacia(), empresa: t.titular.nombre, sedeId: t.sedeId, nombre: t.sede?.nombre ?? 'Sin tienda asignada', terminales: new Map() }; tiendas.set(clave, tienda); }
    let term = tienda.terminales.get(t.id);
    if (!term) { term = { ...vacia(), id: t.id, alias: t.alias }; tienda.terminales.set(t.id, term); }
    sumar(total, monto, pct); sumar(tienda, monto, pct); sumar(term, monto, pct);
  }
  return {
    total,
    tiendas: [...tiendas.values()]
      .sort((a, b) => b.bruto - a.bruto)
      .map(({ terminales, ...t }) => ({ ...t, terminales: [...terminales.values()].sort((a, b) => b.bruto - a.bruto) })),
  };
}

const periodoDe = (req: Request): Periodo => (PERIODOS as readonly string[]).includes(req.query.periodo as string) ? (req.query.periodo as Periodo) : 'hoy';

// GET /api/datafonos/resumen?periodo=hoy|7d|mes
router.get('/resumen', authenticate, conCuenta('recargar'), async (req: Request, res: Response) => {
  const cuenta = req.cuenta!;
  // Las ventas por tienda son de la cuenta principal: una sede (que no ve el saldo) no las ve
  if (cuenta.esSubcuenta) return res.status(403).json({ ok: false, mensaje: 'Las ventas por tienda las ve la cuenta principal' });
  const periodo = periodoDe(req);
  const desde = inicioDePeriodo(periodo);
  const r = await resumenDeCobros({ terminal: { titularId: cuenta.titularId } }, desde);
  res.json({ ok: true, periodo, desde, ...r });
});

// ══ POST /api/datafonos/webhooks/:token ══
// Aviso de Kushki One por cada cambio de estado de un cobro. No trae firma: la URL lleva un código secreto, solo se
// aceptan avisos del terminal al que se le mandó el cobro y la aprobación se confirma siempre con Kushki antes de
// acreditar. Siempre 2xx salvo que haya que reintentar (Kushki no reintenta los 4xx).
router.post('/webhooks/:token', webhookLimiter, async (req: Request, res: Response) => {
  if (!(await tokenWebhookValido(req.params.token))) {
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
  // Business-Code por empresa: las que tienen datáfonos (y las que ya tienen código aunque aún no tengan datáfonos)
  const codigos = await prisma.comercioKushkiOne.findMany({ include: { user: { select: { nombre: true } } } });
  const empresas = new Map<string, { titularId: string; nombre: string; configurado: boolean; termina: string; terminales: number }>();
  for (const t of terminales) {
    const e = empresas.get(t.titularId) ?? { titularId: t.titularId, nombre: t.titular.nombre, configurado: false, termina: '', terminales: 0 };
    e.terminales += 1;
    empresas.set(t.titularId, e);
  }
  for (const c of codigos) {
    const e = empresas.get(c.userId) ?? { titularId: c.userId, nombre: c.user.nombre, configurado: false, termina: '', terminales: 0 };
    const codigo = await businessCodeDeTitular(c.userId);
    e.configurado = !!codigo;
    e.termina = codigo ? terminaEn(codigo) : '';
    empresas.set(c.userId, e);
  }
  res.json({
    ok: true,
    urlPublica: !!urlPublicaApi(),
    empresas: [...empresas.values()].sort((a, b) => a.nombre.localeCompare(b.nombre)),
    terminales: terminales.map((t) => ({
      id: t.id, serial: t.serial, alias: t.alias, modelo: t.modelo, activo: t.activo,
      titularId: t.titularId, titular: t.titular.nombre, sedeId: t.sedeId, sede: t.sede?.nombre ?? null, cobros: t._count.cobros,
    })),
  });
});

// PUT /api/datafonos/admin/empresas/:titularId/business-code  → guarda (o reemplaza) el Business-Code de Kushki One de la empresa
// DELETE /api/datafonos/admin/empresas/:titularId/business-code
// Es el Private Merchant ID de la Branch de card present de esa empresa. Se guarda cifrado y no se vuelve a mostrar.
const businessCodeSchema = z.object({ businessCode: z.string().trim().regex(/^[A-Za-z0-9_-]{8,128}$/, 'El Business-Code solo lleva letras, números, guion y guion bajo (8 a 128 caracteres)') });

async function empresaValida(titularId: string) {
  const u = await prisma.user.findUnique({ where: { id: titularId }, select: { id: true, rol: true, cuentaPadreId: true, eliminadoAt: true } });
  return u && u.rol === 'usuario' && !u.cuentaPadreId && !u.eliminadoAt ? u : null;
}

router.put('/admin/empresas/:titularId/business-code', authenticate, requireAdmin, async (req: Request, res: Response) => {
  const parse = businessCodeSchema.safeParse(req.body);
  if (!parse.success) return res.status(400).json({ ok: false, mensaje: parse.error.errors[0].message });
  if (!(await empresaValida(req.params.titularId))) return res.status(404).json({ ok: false, mensaje: 'Empresa no encontrada (los datáfonos van en la cuenta principal, no en una sede)' });
  const businessCodeCif = encrypt(parse.data.businessCode);
  await prisma.comercioKushkiOne.upsert({ where: { userId: req.params.titularId }, create: { userId: req.params.titularId, businessCodeCif }, update: { businessCodeCif, activo: true } });
  // La auditoría guarda solo el final del código, nunca el valor
  await prisma.auditLog.create({ data: { userId: req.user!.id, accion: 'GUARDAR_BUSINESS_CODE_KUSHKI_ONE', tabla: 'comercios_kushki_one', registroId: req.params.titularId, ip: req.ip, datos: { termina: terminaEn(parse.data.businessCode) } } }).catch(() => {});
  res.json({ ok: true, termina: terminaEn(parse.data.businessCode) });
});

router.delete('/admin/empresas/:titularId/business-code', authenticate, requireAdmin, async (req: Request, res: Response) => {
  const pendientes = await prisma.cobroDatafono.count({ where: { terminal: { titularId: req.params.titularId }, estado: { in: ['pendiente', 'reembolsando'] } } });
  if (pendientes > 0) return res.status(409).json({ ok: false, mensaje: `Esta empresa tiene ${pendientes} cobro(s) en curso que necesitan ese código. Espera a que terminen` });
  const r = await prisma.comercioKushkiOne.deleteMany({ where: { userId: req.params.titularId } });
  if (r.count === 0) return res.status(404).json({ ok: false, mensaje: 'Esta empresa no tiene Business-Code guardado' });
  await prisma.auditLog.create({ data: { userId: req.user!.id, accion: 'QUITAR_BUSINESS_CODE_KUSHKI_ONE', tabla: 'comercios_kushki_one', registroId: req.params.titularId, ip: req.ip } }).catch(() => {});
  res.json({ ok: true });
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

// POST /api/datafonos/admin/terminales/:id/probar  → comprueba la conexión con el terminal sin mover dinero
router.post('/admin/terminales/:id/probar', authenticate, requireAdmin, async (req: Request, res: Response) => {
  const terminal = await prisma.terminalKushki.findUnique({ where: { id: req.params.id } });
  if (!terminal) return res.status(404).json({ ok: false, mensaje: 'Datáfono no encontrado' });
  try {
    const info = await infoTerminal(terminal.serial);
    res.json({ ok: true, conectado: true, ...info });
  } catch (err: any) {
    const mensaje = err instanceof KushkiError ? descripcionDeError(err) : 'No se pudo consultar al terminal';
    logger.warn('Prueba de conexión con el datáfono fallida', { terminal: terminal.serial, err: err.message, codigo: err.codigo, status: err.status });
    // 200 con conectado:false: la prueba se hizo; el resultado es que no hubo conexión (y el motivo)
    res.json({ ok: true, conectado: false, mensaje });
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

// GET /api/datafonos/admin/resumen?periodo=hoy|7d|mes  → ventas aprobadas por empresa, tienda y datáfono
router.get('/admin/resumen', authenticate, requireAdmin, async (req: Request, res: Response) => {
  const periodo = periodoDe(req);
  const desde = inicioDePeriodo(periodo);
  res.json({ ok: true, periodo, desde, ...(await resumenDeCobros({}, desde)) });
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
