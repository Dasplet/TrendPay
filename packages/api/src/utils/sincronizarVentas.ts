import axios from 'axios';
import { prisma } from '../index';
import { logger } from './logger';
import { AMBIENTES_KUSHKI, KushkiError } from './kushki';
import { businessCodeDeTitular } from './kushkiOne';
import { procesarAvisoTerminal, terminalDelAviso, serialesDelAviso, claveDelAviso } from './ventasTerminal';
import { buscarTransaccionesWeb, itemWebAAviso, terminalWeb } from './ventasWeb';

// ══════════════════════════════════════
// SINCRONIZAR LAS VENTAS DEL DATÁFONO (sin webhook)
// ══════════════════════════════════════
// Alternativa a los avisos de Kushki: cada pocos minutos TrendPay le pregunta a Kushki las transacciones hechas en los datáfonos
// de la empresa (API de consulta de card present, con la llave privada de su Branch) y refleja las nuevas con la misma lógica
// que el webhook: la misma referencia de transacción nunca se acredita dos veces, así que pueden convivir los dos caminos.
//
// Una llave por cuenta: cada tienda (sede) puede tener su PROPIA llave de Kushki (su propio Branch). Todo lo que Kushki devuelva con
// la llave de una sede se registra en esa sede, sin necesidad de saber el serial del aparato. La llave de la empresa (cuenta
// principal) sigue sirviendo para lo que no tenga llave propia.
//
// Limitación: con la llave de la empresa la consulta no dice con certeza en qué datáfono se hizo cada venta. Si la respuesta trae el serial del aparato
// se asigna a su tienda; si no, queda en un datáfono "sin identificar" de la empresa (solo la ve la cuenta principal).

const TAMANO_PAGINA = 500;
const MAX_PAGINAS = 20;
const SOLAPE_MS = 15 * 60_000; // se vuelve a mirar un poco hacia atrás por si Kushki tarda en publicar; la referencia evita duplicados
// Pagos en línea: un PSE o un pago en efectivo se crea "pendiente" y se aprueba minutos u horas (o días) después. Para no perderlos se vuelve a
// mirar 3 días hacia atrás en cada vuelta; lo que ya está registrado se salta sin tocar nada.
const SOLAPE_WEB_MS = 3 * 86_400_000;

const baseUrl = () => (process.env.KUSHKI_POS_BASE_URL || AMBIENTES_KUSHKI.produccion).replace(/\/+$/, '');

export async function buscarTransaccionesPos(llavePrivada: string, desdeMs: number, hastaMs: number): Promise<any[]> {
  const items: any[] = [];
  for (let pagina = 1; pagina <= MAX_PAGINAS; pagina++) {
    let respuesta;
    try {
      respuesta = await axios.post(
        `${baseUrl()}/pos-analytics/v1/transactions/search`,
        { page: pagina, size: TAMANO_PAGINA, filters: { start_date: desdeMs, end_date: hastaMs } },
        { headers: { 'Private-Credential-Id': llavePrivada, 'Content-Type': 'application/json' }, timeout: 30_000 },
      );
    } catch (err: any) {
      const data = err.response?.data;
      throw new KushkiError(data?.message || err.message || 'No se pudo consultar a Kushki', err.response?.status ?? 502, { codigo: data?.code, respuesta: data });
    }
    const lote: any[] = Array.isArray(respuesta.data?.items) ? respuesta.data.items : [];
    items.push(...lote);
    if (lote.length < TAMANO_PAGINA) break;
  }
  return items;
}

// Si todos los datáfonos activos de la empresa pertenecen a la MISMA tienda, una venta sin aparato identificado sí se sabe de qué
// tienda es. Con varias tiendas no se puede adivinar: queda solo para la cuenta principal.
async function tiendaUnica(titularId: string): Promise<string | null> {
  const terminales = await prisma.terminalKushki.findMany({ where: { titularId, activo: true, NOT: { serial: { startsWith: 'SIN-IDENTIFICAR' } } }, select: { sedeId: true } });
  const sedes = new Set(terminales.map((t) => t.sedeId));
  const unica = sedes.size === 1 ? [...sedes][0] : null;
  return unica ?? null;
}

// Los movimientos que no se pueden atribuir a un aparato concreto van a un datáfono "sin identificar" de la empresa (y a la tienda,
// si la empresa solo tiene una). Si la tienda se descubre después, también se corrigen los movimientos que ya estaban.
export async function terminalSinIdentificar(titularId: string, sedeFija?: { id: string; nombre: string }) {
  // Con la llave propia de una sede, lo que no se pueda atribuir a un aparato queda igual en ESA sede
  if (sedeFija) {
    const serialSede = `SIN-IDENTIFICAR-${sedeFija.id.slice(0, 8)}`;
    return prisma.terminalKushki.upsert({
      where: { serial: serialSede }, update: { sedeId: sedeFija.id, titularId },
      create: { serial: serialSede, alias: `Datáfono sin identificar · ${sedeFija.nombre}`, modelo: 'Sunmi', titularId, sedeId: sedeFija.id },
    });
  }
  const serial = `SIN-IDENTIFICAR-${titularId.slice(0, 8)}`;
  const sedeId = await tiendaUnica(titularId);
  const antes = await prisma.terminalKushki.findUnique({ where: { serial } });
  const terminal = await prisma.terminalKushki.upsert({
    where: { serial }, update: { sedeId }, create: { serial, alias: 'Datáfono sin identificar', modelo: 'Sunmi', titularId, sedeId },
  });
  if (sedeId && (!antes || antes.sedeId !== sedeId)) {
    await prisma.cobroDatafono.updateMany({ where: { terminalId: terminal.id, userId: titularId }, data: { userId: sedeId } });
    await prisma.transaction.updateMany({
      where: { sedeId: null, categoria: { in: ['datafono', 'reembolso_datafono', 'pago_web', 'reembolso_web'] }, metadata: { path: ['terminal'], equals: serial } },
      data: { sedeId, userId: sedeId },
    });
  }
  return terminal;
}

// Los nombres de los campos que trae la respuesta de Kushki (sin valores), para saber si alguno identifica el aparato
function nombresDeCampos(item: any): string[] {
  const nombres: string[] = [];
  const recorrer = (obj: any, prefijo: string, nivel: number) => {
    if (!obj || typeof obj !== 'object' || Array.isArray(obj)) return;
    for (const [k, v] of Object.entries(obj)) {
      nombres.push(`${prefijo}${k}`);
      if (nivel < 2) recorrer(v, `${prefijo}${k}.`, nivel + 1);
    }
  };
  recorrer(item, '', 0);
  return nombres.slice(0, 80);
}

export interface ResumenSincronizacion {
  omitida?: string;
  revisadas: number; ventas: number; reembolsos: number; repetidas: number; ignoradas: number; sinAparato: number; errores: number;
  conSerial: boolean; // ¿la respuesta de Kushki trae el serial del aparato? (si no, las ventas no se pueden asignar a un datáfono)
  campos?: string[];  // nombres de los campos que trae la respuesta (sin valores)
  formaRespuesta?: string[]; // pagos en línea: qué trae el nivel de arriba de la respuesta de Kushki (para entender una consulta vacía)
  desde?: string; hasta?: string;
}

const vacio = (): ResumenSincronizacion => ({ revisadas: 0, ventas: 0, reembolsos: 0, repetidas: 0, ignoradas: 0, sinAparato: 0, errores: 0, conSerial: false });
const claveMarca = (titularId: string) => `ventas_pos_desde_${titularId}`;

// `duenoId` es quien tiene la llave: una empresa (cuenta principal) o una de sus sedes. Con la llave de una sede todo se registra
// en esa sede; con la de la empresa, el aparato decide (o queda "sin identificar").
export async function sincronizarEmpresa(duenoId: string, opciones: { desdeMs?: number } = {}): Promise<ResumenSincronizacion> {
  const llave = await businessCodeDeTitular(duenoId);
  if (!llave) return { ...vacio(), omitida: 'la cuenta no tiene la llave privada de Kushki guardada' };

  const dueno = await prisma.user.findUnique({ where: { id: duenoId }, select: { id: true, nombre: true, cuentaPadreId: true } });
  if (!dueno) return { ...vacio(), omitida: 'la cuenta no existe' };
  const titularId = dueno.cuentaPadreId ?? dueno.id;
  const sedeFija = dueno.cuentaPadreId ? { id: dueno.id, nombre: dueno.nombre } : undefined;
  // Canal de la llave: datáfonos (card present) o la página web (pagos en línea, card not present)
  const canalWeb = (await prisma.comercioKushkiOne.findUnique({ where: { userId: duenoId }, select: { canal: true } }))?.canal === 'web';

  // Si ya hay ventas "sin identificar" de esta empresa, se revisa si ahora se sabe de qué tienda son (aunque no lleguen ventas nuevas)
  if (!canalWeb && !sedeFija && await prisma.terminalKushki.findFirst({ where: { titularId, serial: { startsWith: 'SIN-IDENTIFICAR' } }, select: { id: true } })) {
    await terminalSinIdentificar(titularId);
  }

  const hasta = Date.now();
  const marca = await prisma.config.findUnique({ where: { clave: claveMarca(duenoId) } });
  // La primera vez solo se deja constancia de "desde cuándo": no se acreditan ventas anteriores (pruebas, días previos al lanzamiento)
  if (!marca && opciones.desdeMs === undefined) {
    await prisma.config.create({ data: { clave: claveMarca(duenoId), valor: String(hasta) } });
    return { ...vacio(), omitida: 'primera sincronización: se contarán las ventas desde ahora' };
  }
  const desde = opciones.desdeMs ?? Number(marca!.valor) - (canalWeb ? SOLAPE_WEB_MS : SOLAPE_MS);

  const resumen: ResumenSincronizacion = { ...vacio(), desde: new Date(desde).toISOString(), hasta: new Date(hasta).toISOString() };
  let crudos: any[];
  if (canalWeb) {
    const web = await buscarTransaccionesWeb(llave, desde, hasta);
    crudos = web.items;
    if (web.items.length === 0) resumen.formaRespuesta = web.forma;
  } else {
    crudos = await buscarTransaccionesPos(llave, desde, hasta);
  }
  resumen.revisadas = crudos.length;
  if (crudos.length > 0) resumen.campos = nombresDeCampos(crudos[0]);
  const items = canalWeb ? crudos.map(itemWebAAviso) : crudos;

  // Primero las más viejas, para que un reembolso encuentre la venta que lo precede
  const ordenadas = [...items].sort((a, b) => Number(a?.created ?? 0) - Number(b?.created ?? 0));
  const huerfano = { terminal: null as Awaited<ReturnType<typeof terminalSinIdentificar>> | null };

  // Lo que ya está registrado se salta de una vez (con ventanas largas casi todo lo que llega ya está): una sola consulta por lote
  const claveCobro = (it: any) => { const c = claveDelAviso(it); return c ? `terminal:${c}` : null; };
  const yaRegistradas = new Set<string>();
  const claves = ordenadas.map(claveCobro).filter((c): c is string => !!c);
  for (let i = 0; i < claves.length; i += 500) {
    const filas = await prisma.cobroDatafono.findMany({ where: { clientTransactionId: { in: claves.slice(i, i + 500) } }, select: { clientTransactionId: true } });
    for (const f of filas) yaRegistradas.add(f.clientTransactionId);
  }
  // Lo importado desde un reporte se registró por su ticket (no por la referencia): también se reconoce por el número de ticket
  const ticketsRegistrados = new Set<string>();
  const tickets = ordenadas.map((it) => (typeof it?.ticket_number === 'string' ? it.ticket_number : null)).filter((t): t is string => !!t);
  for (let i = 0; i < tickets.length; i += 500) {
    const filas = await prisma.cobroDatafono.findMany({ where: { ticketNumber: { in: tickets.slice(i, i + 500) } }, select: { ticketNumber: true } });
    for (const f of filas) if (f.ticketNumber) ticketsRegistrados.add(f.ticketNumber);
  }

  for (const item of ordenadas) {
    try {
      const clave = claveCobro(item);
      // Una venta ya registrada se salta; un reembolso (que comparte el ticket de la venta que anula en su campo aparte) sigue su camino normal
      if ((clave && yaRegistradas.has(clave)) || (typeof item?.ticket_number === 'string' && ticketsRegistrados.has(item.ticket_number))) { resumen.repetidas += 1; continue; }
      if (serialesDelAviso(item).length > 0) resumen.conSerial = true;
      let terminal = canalWeb ? await (huerfano.terminal ??= await terminalWeb(titularId, sedeFija)) : await terminalDelAviso(item);
      // Con llave de sede solo vale un aparato de esa misma sede; cualquier otra cosa queda en la sede de la llave
      if (!canalWeb && sedeFija && terminal && terminal.sedeId !== sedeFija.id) terminal = null;
      if (!terminal) {
        resumen.sinAparato += 1;
        huerfano.terminal ??= await terminalSinIdentificar(titularId, sedeFija);
        terminal = huerfano.terminal;
      }
      // Solo se procesan los aparatos de esta empresa
      if (terminal.titularId !== titularId) { resumen.ignoradas += 1; continue; }
      const r = await procesarAvisoTerminal(terminal, item);
      if (r.detalle.startsWith('venta aprobada')) resumen.ventas += 1;
      else if (r.detalle.startsWith('reembolso aprobado')) resumen.reembolsos += 1;
      else if (r.detalle.includes('repetid')) resumen.repetidas += 1;
      else resumen.ignoradas += 1;
    } catch (err: any) {
      resumen.errores += 1;
      logger.error('Error reflejando una venta de datáfono sincronizada', { err: err.message });
    }
  }

  // La marca solo avanza si no hubo errores: lo que falló se vuelve a intentar en la próxima vuelta
  if (resumen.errores === 0) {
    await prisma.config.upsert({ where: { clave: claveMarca(duenoId) }, create: { clave: claveMarca(duenoId), valor: String(hasta) }, update: { valor: String(hasta) } });
  }
  if (resumen.ventas + resumen.reembolsos > 0) logger.info('Ventas de datáfono sincronizadas', { ...resumen, campos: resumen.campos?.join(',') });
  return resumen;
}

const MAX_EN_PARALELO = 5; // con muchas empresas, varias a la vez sin saturar a Kushki ni a la base de datos
let sincronizando = false;

export async function sincronizarTodas(): Promise<{ cuentas: number; fallidas: number; omitida?: boolean }> {
  // Si la vuelta anterior todavía no termina (muchas empresas o Kushki lento), no se empieza otra encima: duplicaría consultas
  if (sincronizando) return { cuentas: 0, fallidas: 0, omitida: true };
  sincronizando = true;
  try {
    const llaves = await prisma.comercioKushkiOne.findMany({ where: { activo: true, businessCodeCif: { not: null } }, select: { userId: true, user: { select: { cuentaPadreId: true } } } });
    // Primero las llaves de las sedes y al final las de las empresas: si la llave de una empresa también devolviera ventas de sus
    // tiendas, ya estarían registradas en la tienda correcta (una venta nunca se registra dos veces)
    const sedes = llaves.filter((l) => l.user.cuentaPadreId);
    const empresas = llaves.filter((l) => !l.user.cuentaPadreId);
    let fallidas = 0;
    for (const grupo of [sedes, empresas]) {
      // Cada grupo termina antes de empezar el siguiente; dentro del grupo, de a MAX_EN_PARALELO. Una empresa que falla no frena a las demás.
      for (let i = 0; i < grupo.length; i += MAX_EN_PARALELO) {
        await Promise.all(grupo.slice(i, i + MAX_EN_PARALELO).map(async ({ userId }) => {
          try { await sincronizarEmpresa(userId); }
          catch (err: any) { fallidas += 1; logger.warn('No se pudieron sincronizar las ventas de una cuenta', { err: err.message, status: err.status }); }
        }));
      }
    }
    return { cuentas: llaves.length, fallidas };
  } finally {
    sincronizando = false;
  }
}

export function iniciarSincronizacionVentas(): void {
  if (process.env.NODE_ENV === 'test') return;
  const timer = setInterval(() => { sincronizarTodas().catch((err: any) => logger.error('Falló la sincronización de ventas de datáfono', { err: err.message })); }, 2 * 60_000);
  timer.unref();
  logger.info('🔄 Sincronización de ventas de datáfono activa (cada 2 minutos)');
}
