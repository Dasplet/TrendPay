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
import { firmaKushkiValida } from '../utils/kushkiWebhook';
import { terminalDelAviso, webhookSecretDeTitular, procesarAvisoTerminal, claveDelAviso, resumenParaRegistro, serialesDelAviso } from '../utils/ventasTerminal';
import { encrypt } from '../utils/security';
import { sincronizarEmpresa } from '../utils/sincronizarVentas';
import { importarVentasCsv } from '../utils/importarVentas';
import multer from 'multer';
import { terminaEn } from '../utils/comerciosKushki';

const router = Router();
const subidaCsv = multer({ storage: multer.memoryStorage(), limits: { fileSize: 2 * 1024 * 1024, files: 1 } });

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
  tipo: c.tipo,       // cobro | reembolso
  origen: c.origen,   // terminal (digitado en el datáfono) | trendpay
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

// Los cobros los ve la cuenta principal (todos los de su empresa) y la tienda a la que pertenece el datáfono; las demás sedes no
function visibilidadCobros(req: Request) {
  const cuenta = req.cuenta!;
  return cuenta.esSubcuenta
    ? { terminal: { titularId: cuenta.titularId }, OR: [{ terminal: { sedeId: req.user!.id } }, { userId: req.user!.id }] }
    : { terminal: { titularId: cuenta.titularId } };
}

// ══ GET /api/datafonos/cobros ══
router.get('/cobros', authenticate, conCuenta('recargar'), async (req: Request, res: Response) => {
  const cobros = await prisma.cobroDatafono.findMany({
    where: visibilidadCobros(req),
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
  const donde = { id: req.params.id, ...visibilidadCobros(req) };
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
// monto ya viene con signo (negativo en un reembolso); el contador solo cuenta cobros, no reembolsos
function sumar(fila: FilaResumen, monto: number, pct: number, signo = 1) {
  const comision = Math.round((monto * pct) / 100);
  fila.cobros += signo > 0 ? 1 : 0; fila.bruto += monto; fila.comision += comision; fila.neto += monto - comision;
}

async function resumenDeCobros(where: object, desde: Date) {
  // Ventas aprobadas y reembolsos (restan el monto completo devuelto). Los cobros mandados desde TrendPay que se anularon dejan de contar.
  const cobros = await prisma.cobroDatafono.findMany({
    where: {
      createdAt: { gte: desde },
      OR: [
        { tipo: 'cobro', estado: 'aprobado' },
        // una venta hecha en el datáfono y luego reembolsada sigue contando; su reembolso (abajo) la resta: el resumen coincide con la billetera
        { tipo: 'cobro', estado: 'reembolsado', origen: 'terminal' },
        { tipo: 'reembolso', estado: 'aprobado' },
      ],
      ...where,
    },
    select: { tipo: true, monto: true, comisionPct: true, terminal: { select: { id: true, alias: true, sedeId: true, sede: { select: { nombre: true } }, titular: { select: { id: true, nombre: true } } } } },
  });
  const total = vacia();
  const tiendas = new Map<string, FilaResumen & { empresa: string; sedeId: string | null; nombre: string; terminales: Map<string, FilaResumen & { id: string; alias: string }> }>();
  for (const c of cobros) {
    const signo = c.tipo === 'reembolso' ? -1 : 1;
    const monto = Number(c.monto) * signo;
    const pct = c.tipo === 'reembolso' ? 0 : Number(c.comisionPct); // el reembolso no devuelve la comisión
    const t = c.terminal;
    const clave = `${t.titular.id}:${t.sedeId ?? ''}`;
    let tienda = tiendas.get(clave);
    if (!tienda) { tienda = { ...vacia(), empresa: t.titular.nombre, sedeId: t.sedeId, nombre: t.sede?.nombre ?? 'Sin tienda asignada', terminales: new Map() }; tiendas.set(clave, tienda); }
    let term = tienda.terminales.get(t.id);
    if (!term) { term = { ...vacia(), id: t.id, alias: t.alias }; tienda.terminales.set(t.id, term); }
    sumar(total, monto, pct, signo); sumar(tienda, monto, pct, signo); sumar(term, monto, pct, signo);
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

// ══ POST /api/datafonos/webhooks/tarjeta-presente ══
// Aviso de Kushki por cada venta o reembolso hecho DIRECTAMENTE en el datáfono (el cajero digita el valor en el aparato).
// TrendPay lo refleja: acredita o descuenta la billetera de la empresa y deja el movimiento en la tienda y en la cuenta
// principal. Se autentica con la firma HMAC de Kushki ("Webhook signature" de la consola de esa empresa): quien no la conozca
// no puede inventar una venta. Kushki reintenta cada aviso hasta 7 veces si no recibe 200/201; cada transacción se registra
// una sola vez (por su referencia). Un aviso de un aparato que no está registrado se responde 200 y queda en el registro.
router.post('/webhooks/tarjeta-presente', webhookLimiter, async (req: Request, res: Response) => {
  const aviso: Record<string, any> = req.body && typeof req.body === 'object' ? req.body : {};
  const resumen = resumenParaRegistro(aviso);
  const ticket = claveDelAviso(aviso);
  const registrar = (firmaValida: boolean, estadoHttp: number, detalle: string) =>
    registrarWebhook(req, { ticket, firmaValida, estadoHttp, detalle: `Datáfono · ${detalle}`, cuerpo: resumen });

  try {
    const terminal = await terminalDelAviso(aviso);
    if (!terminal) {
      await registrar(false, 200, `aparato no registrado en TrendPay (serial: ${serialesDelAviso(aviso).join(', ') || 'no viene'})`);
      return res.status(200).json({ ok: true });
    }

    const secreto = await webhookSecretDeTitular(terminal.titularId);
    if (!secreto) {
      await registrar(false, 503, 'falta la firma de webhooks de la empresa (se reintentará)');
      return res.status(503).json({ ok: false });
    }

    const cuerpoCrudo = (req as Request & { rawBody?: Buffer }).rawBody;
    const firmaOk = !!cuerpoCrudo && firmaKushkiValida(cuerpoCrudo, { id: req.get('x-kushki-id'), firma: req.get('x-kushki-signature'), firmaSimple: req.get('x-kushki-simplesignature') }, secreto);
    if (!firmaOk) {
      await registrar(false, 401, req.get('x-kushki-signature') || req.get('x-kushki-simplesignature') ? 'firma inválida: la firma de la empresa no coincide' : 'sin firma');
      return res.status(401).json({ ok: false });
    }

    if (!terminal.activo) {
      await registrar(true, 200, `ignorado: el datáfono ${terminal.alias} está desactivado en TrendPay`);
      return res.status(200).json({ ok: true });
    }

    const r = await procesarAvisoTerminal(terminal, aviso);
    await registrar(true, r.http, r.detalle);
    res.status(r.http).json({ ok: r.http < 400 });
  } catch (err: any) {
    logger.error('Error procesando el aviso de una venta de datáfono', { err: err.message });
    await registrar(false, 500, `error: ${String(err.message).slice(0, 120)}`);
    res.status(500).json({ ok: false });
  }
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
  type SedeLlave = { id: string; nombre: string; configurado: boolean; termina: string; terminales: number; canal: string };
  const empresas = new Map<string, { titularId: string; nombre: string; configurado: boolean; termina: string; firma: boolean; terminales: number; sedes: SedeLlave[] }>();
  for (const t of terminales) {
    const e = empresas.get(t.titularId) ?? { titularId: t.titularId, nombre: t.titular.nombre, configurado: false, termina: '', firma: false, terminales: 0, sedes: [] };
    e.terminales += 1;
    empresas.set(t.titularId, e);
  }
  // La llave de una sede (su propio Branch de Kushki) se muestra dentro de su empresa
  const duenos = await prisma.user.findMany({ where: { id: { in: codigos.map((c) => c.userId) } }, select: { id: true, nombre: true, cuentaPadreId: true, cuentaPadre: { select: { nombre: true } } } });
  const duenoDe = new Map(duenos.map((d) => [d.id, d]));
  for (const c of codigos) {
    const dueno = duenoDe.get(c.userId);
    if (dueno?.cuentaPadreId) {
      // Una tienda con llave propia hace que su empresa aparezca en la lista, aunque la empresa aún no tenga datáfonos ni llave
      if (!empresas.has(dueno.cuentaPadreId)) empresas.set(dueno.cuentaPadreId, { titularId: dueno.cuentaPadreId, nombre: dueno.cuentaPadre?.nombre ?? '', configurado: false, termina: '', firma: false, terminales: 0, sedes: [] });
      continue;
    }
    const e = empresas.get(c.userId) ?? { titularId: c.userId, nombre: c.user.nombre, configurado: false, termina: '', firma: false, terminales: 0, sedes: [] };
    const codigo = await businessCodeDeTitular(c.userId);
    e.firma = !!c.webhookSecretCif && c.activo;
    e.configurado = !!codigo;
    e.termina = codigo ? terminaEn(codigo) : '';
    empresas.set(c.userId, e);
  }
  // Todas las sedes de las empresas que se muestran (con o sin llave propia), para poder asignarles una
  const sedesDe = await prisma.user.findMany({ where: { cuentaPadreId: { in: [...empresas.keys()] }, eliminadoAt: null }, select: { id: true, nombre: true, cuentaPadreId: true }, orderBy: { nombre: 'asc' } });
  for (const s of sedesDe) {
    const codigo = await businessCodeDeTitular(s.id);
    empresas.get(s.cuentaPadreId!)!.sedes.push({ id: s.id, nombre: s.nombre, configurado: !!codigo, termina: codigo ? terminaEn(codigo) : '', terminales: terminales.filter((t) => t.sedeId === s.id && t.modelo !== 'WEB').length, canal: codigos.find((c) => c.userId === s.id)?.canal ?? 'datafono' });
  }
  res.json({
    ok: true,
    urlPublica: !!urlPublicaApi(),
    // Dirección que se registra en la consola de Kushki (Desarrolladores > Webhooks) para recibir las ventas del datáfono
    urlWebhook: urlPublicaApi() ? `${urlPublicaApi()}/api/datafonos/webhooks/tarjeta-presente` : null,
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
const credencialesSchema = z.object({
  // Opcional: solo sirve para mandar órdenes al aparato desde TrendPay (ya no se usa)
  businessCode: z.string().trim().regex(/^[A-Za-z0-9_-]{8,128}$/, 'El Business-Code solo lleva letras, números, guion y guion bajo (8 a 128 caracteres)').optional(),
  // La "Webhook signature" de la consola de Kushki (Desarrolladores > Webhooks): con ella se comprueba que cada aviso viene de Kushki
  webhookSecret: z.string().trim().regex(/^\S{8,300}$/, 'La firma de webhooks no puede tener espacios (8 a 300 caracteres)').optional(),
  // datafono = ventas de los datáfonos (card present); web = pagos en línea de la página web (card not present)
  canal: z.enum(['datafono', 'web']).optional(),
}).refine((d) => d.businessCode !== undefined || d.webhookSecret !== undefined, { message: 'Envía la firma de webhooks o el Business-Code' });

async function empresaValida(titularId: string) {
  const u = await prisma.user.findUnique({ where: { id: titularId }, select: { id: true, rol: true, cuentaPadreId: true, eliminadoAt: true } });
  return u && u.rol === 'usuario' && !u.cuentaPadreId && !u.eliminadoAt ? u : null;
}

// Una cuenta que puede tener su propia llave de Kushki: una empresa (cuenta principal) o una de sus sedes
async function duenoDeLlaveValido(id: string) {
  const u = await prisma.user.findUnique({ where: { id }, select: { id: true, rol: true, cuentaPadreId: true, eliminadoAt: true, cuentaPadre: { select: { rol: true, eliminadoAt: true, cuentaPadreId: true } } } });
  if (!u || u.rol !== 'usuario' || u.eliminadoAt) return null;
  if (!u.cuentaPadreId) return u;
  return u.cuentaPadre && u.cuentaPadre.rol === 'usuario' && !u.cuentaPadre.eliminadoAt && !u.cuentaPadre.cuentaPadreId ? u : null;
}

router.put('/admin/empresas/:titularId/business-code', authenticate, requireAdmin, async (req: Request, res: Response) => {
  const parse = credencialesSchema.safeParse(req.body);
  if (!parse.success) return res.status(400).json({ ok: false, mensaje: parse.error.errors[0].message });
  const dueno = await duenoDeLlaveValido(req.params.titularId);
  if (!dueno) return res.status(404).json({ ok: false, mensaje: 'Cuenta no encontrada' });
  const { businessCode, webhookSecret, canal } = parse.data;
  // La firma de los avisos es de la cuenta de Kushki de la empresa, no de cada tienda
  if (dueno.cuentaPadreId && webhookSecret !== undefined) return res.status(400).json({ ok: false, mensaje: 'La firma de webhooks se guarda en la cuenta principal de la empresa; en una tienda solo va su llave privada' });
  if (dueno.cuentaPadreId && businessCode === undefined) return res.status(400).json({ ok: false, mensaje: 'Envía la llave privada de la tienda' });
  const cambios = {
    ...(businessCode !== undefined ? { businessCodeCif: encrypt(businessCode) } : {}),
    ...(webhookSecret !== undefined ? { webhookSecretCif: encrypt(webhookSecret) } : {}),
    ...(canal !== undefined ? { canal } : {}),
  };
  await prisma.comercioKushkiOne.upsert({ where: { userId: req.params.titularId }, create: { userId: req.params.titularId, ...cambios }, update: { ...cambios, activo: true } });
  // La auditoría guarda solo qué se cambió y el final del código, nunca el valor
  await prisma.auditLog.create({ data: { userId: req.user!.id, accion: 'GUARDAR_BUSINESS_CODE_KUSHKI_ONE', tabla: 'comercios_kushki_one', registroId: req.params.titularId, ip: req.ip, datos: { businessCode: businessCode ? terminaEn(businessCode) : undefined, firmaWebhooks: webhookSecret ? 'actualizada' : undefined } } }).catch(() => {});
  res.json({ ok: true, termina: businessCode ? terminaEn(businessCode) : undefined, firma: webhookSecret !== undefined });
});

// POST /api/datafonos/admin/empresas/:titularId/sincronizar  → trae ahora las ventas del datáfono desde Kushki (sin esperar los 2 minutos)
// Con { desde: <fecha> } vuelve a mirar desde esa fecha (las ventas ya reflejadas no se duplican).
router.post('/admin/empresas/:titularId/sincronizar', authenticate, requireAdmin, async (req: Request, res: Response) => {
  if (!(await duenoDeLlaveValido(req.params.titularId))) return res.status(404).json({ ok: false, mensaje: 'Cuenta no encontrada' });
  const desde = typeof req.body?.desde === 'string' ? Date.parse(req.body.desde) : undefined;
  if (req.body?.desde !== undefined && (desde === undefined || Number.isNaN(desde))) return res.status(400).json({ ok: false, mensaje: 'La fecha "desde" no es válida' });
  try {
    res.json({ ok: true, resumen: await sincronizarEmpresa(req.params.titularId, { desdeMs: desde }) });
  } catch (err: any) {
    const mensaje = err instanceof KushkiError ? descripcionDeError(err) : 'No se pudo sincronizar con Kushki';
    logger.warn('Sincronización manual de ventas de datáfono fallida', { err: err.message, status: err.status });
    res.status(502).json({ ok: false, mensaje });
  }
});

// POST /api/datafonos/admin/empresas/:cuentaId/importar-ventas  (multipart: archivo = reporte .csv de la consola de Kushki)
// Refleja ventas y anulaciones que ya ocurrieron, en la cuenta elegida (una empresa o una tienda). El archivo dice qué filas son de
// datáfono y cuáles de la página web. Se puede repetir sin riesgo: cada ticket se registra una sola vez.
router.post('/admin/empresas/:titularId/importar-ventas', authenticate, requireAdmin, subidaCsv.single('archivo'), async (req: Request, res: Response) => {
  if (!(await duenoDeLlaveValido(req.params.titularId))) return res.status(404).json({ ok: false, mensaje: 'Cuenta no encontrada' });
  if (!req.file) return res.status(400).json({ ok: false, mensaje: 'Adjunta el archivo .csv de Kushki' });
  const pct = req.body?.comisionPct === undefined || req.body.comisionPct === '' ? undefined : Number(req.body.comisionPct);
  if (pct !== undefined && (!Number.isFinite(pct) || pct < 0 || pct > 20)) return res.status(400).json({ ok: false, mensaje: 'La comisión debe estar entre 0% y 20%' });
  try {
    const resumen = await importarVentasCsv(req.params.titularId, req.file.buffer.toString('utf8'), { comisionPct: pct });
    if (resumen.filas === 0) return res.status(400).json({ ok: false, mensaje: 'El archivo está vacío o no tiene el formato del reporte de Kushki (columnas separadas por "|")' });
    await prisma.auditLog.create({ data: { userId: req.user!.id, accion: 'IMPORTAR_VENTAS_KUSHKI', tabla: 'cobros_datafono', registroId: req.params.titularId, ip: req.ip, datos: { ...resumen, comisionPct: pct ?? 'vigente' } } }).catch(() => {});
    res.json({ ok: true, resumen });
  } catch (err: any) {
    logger.error('No se pudo importar el reporte de Kushki', { err: err.message });
    res.status(500).json({ ok: false, mensaje: 'No se pudo importar el archivo' });
  }
});

router.delete('/admin/empresas/:titularId/business-code', authenticate, requireAdmin, async (req: Request, res: Response) => {
  const pendientes = await prisma.cobroDatafono.count({ where: { terminal: { OR: [{ titularId: req.params.titularId }, { sedeId: req.params.titularId }] }, estado: { in: ['pendiente', 'reembolsando'] } } });
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
      terminal: c.terminal.alias, empresa: c.terminal.titular.nombre, cajero: c.origen === 'terminal' ? 'En el datáfono' : c.user.nombre, tipo: c.tipo, origen: c.origen, ticketNumber: c.ticketNumber, creado: c.createdAt,
    })),
  });
});

export default router;
