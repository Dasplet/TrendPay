import type { Response } from 'express';
import type { PrismaClient } from '@prisma/client';
import { logger } from './logger';

// ══════════════════════════════════════
// TIEMPO REAL
// ══════════════════════════════════════
// Cada vez que algo se escribe en la base de datos (un movimiento, un retiro, un pago, un cobro de datáfono, un cambio de
// cuenta...) se avisa por una conexión abierta (Server-Sent Events) a quien tiene que verlo:
//   - los administradores reciben el aviso de todo;
//   - cada cliente solo de lo que ocurre en su empresa (su billetera y sus sedes).
// El aviso NO lleva datos: solo dice "hubo un cambio", y la pantalla vuelve a pedir lo que muestra. Así nunca se filtra
// información por este canal y la pantalla siempre ve lo que realmente hay en la base de datos.
// La conexión vive en la memoria del servidor: si algún día hay varias réplicas del API habría que compartirla (Redis).

export interface Conexion {
  id: string;
  userId: string;
  titularId: string;
  admin: boolean;
  res: Response;
}

const conexiones = new Map<string, Conexion>();
const MAX_CONEXIONES_POR_USUARIO = 5;
const RETARDO_AGRUPAR_MS = 400; // agrupa ráfagas de escrituras en un solo aviso y deja que termine la transacción

export function registrarConexion(c: Conexion): () => void {
  // Si alguien abre demasiadas pestañas se cierra la más antigua en vez de acumular conexiones
  const delUsuario = [...conexiones.values()].filter((x) => x.userId === c.userId);
  if (delUsuario.length >= MAX_CONEXIONES_POR_USUARIO) {
    const vieja = delUsuario[0];
    conexiones.delete(vieja.id);
    try { vieja.res.end(); } catch { /* ya estaba cerrada */ }
  }
  conexiones.set(c.id, c);
  return () => { conexiones.delete(c.id); };
}

export const totalConexiones = () => conexiones.size;

let pendiente = { admin: false, todos: false, titulares: new Set<string>() };
let temporizador: NodeJS.Timeout | null = null;

function escribir(c: Conexion) {
  try { c.res.write(`event: cambio\ndata: {"t":${Date.now()}}\n\n`); }
  catch { conexiones.delete(c.id); }
}

function emitir() {
  temporizador = null;
  const { admin, titulares } = pendiente;
  const { todos } = pendiente;
  pendiente = { admin: false, todos: false, titulares: new Set() };
  for (const c of conexiones.values()) {
    if (todos || (c.admin ? admin || titulares.size > 0 : titulares.has(c.titularId))) escribir(c);
  }
}

// Anota que hubo un cambio (de esta empresa, o general si no se sabe de quién) y avisa en breve, una sola vez por ráfaga
export function anotarCambio(titularId?: string | null, paraTodos = false): void {
  if (conexiones.size === 0) return;
  pendiente.admin = true;
  if (paraTodos) pendiente.todos = true;
  if (titularId) pendiente.titulares.add(titularId);
  if (!temporizador) {
    temporizador = setTimeout(emitir, RETARDO_AGRUPAR_MS);
    temporizador.unref();
  }
}

// Latido para que ningún intermediario cierre una conexión que está quieta
export function enviarLatido(c: Conexion) {
  try { c.res.write(': latido\n\n'); } catch { conexiones.delete(c.id); }
}

// ── Qué escrituras de la base de datos cuentan como un cambio visible ──
const MODELOS_VIVOS = new Set([
  'Transaction', 'Withdrawal', 'KushkiPayment', 'RapydPayment', 'CobroDatafono', 'EventoDatafono', 'Notification', 'User', 'Wallet',
  'TerminalKushki', 'ComercioKushki', 'ComercioKushkiOne', 'KushkiWebhookLog', 'AuditLog', 'UserAuditLog', 'BankAccount', 'QrCode',
  'Vinculacion', 'VinculacionDocumento', 'Referral', 'Config',
]);
const ACCIONES_DE_ESCRITURA = new Set(['create', 'createMany', 'update', 'updateMany', 'upsert', 'delete', 'deleteMany']);

// userId → empresa (cuenta principal) a la que pertenece. Se recuerda un rato para no consultar en cada escritura.
const cacheTitular = new Map<string, { titularId: string; hasta: number }>();

async function titularDe(prisma: PrismaClient, userId: string): Promise<string> {
  const guardado = cacheTitular.get(userId);
  if (guardado && guardado.hasta > Date.now()) return guardado.titularId;
  const u = await prisma.user.findUnique({ where: { id: userId }, select: { cuentaPadreId: true } });
  const titularId = u?.cuentaPadreId ?? userId;
  cacheTitular.set(userId, { titularId, hasta: Date.now() + 5 * 60_000 });
  return titularId;
}

async function avisarEscritura(prisma: PrismaClient, modelo: string, resultado: any) {
  if (conexiones.size === 0) return;
  // La configuración (comisiones, límites) la ve todo el mundo: cambia lo que muestran las pantallas de todos
  if (modelo === 'Config') { anotarCambio(null, true); return; }
  let titular: string | null = null;
  if (resultado && typeof resultado === 'object') {
    if (modelo === 'User') titular = resultado.cuentaPadreId ?? resultado.id ?? null;
    else if (modelo === 'TerminalKushki') titular = resultado.titularId ?? null;
    else if (modelo === 'ComercioKushki' || modelo === 'ComercioKushkiOne') titular = resultado.userId ?? null;
    else if (typeof resultado.userId === 'string') titular = await titularDe(prisma, resultado.userId);
  }
  anotarCambio(titular);
}

// Se engancha a la base de datos: toda escritura relevante dispara el aviso. Nunca puede romper la operación original.
export function instalarAvisosDeCambios(prisma: PrismaClient): void {
  prisma.$use(async (params, next) => {
    const resultado = await next(params);
    if (params.model && MODELOS_VIVOS.has(params.model) && ACCIONES_DE_ESCRITURA.has(params.action)) {
      avisarEscritura(prisma, params.model, resultado).catch((err: any) => logger.warn('No se pudo avisar un cambio en tiempo real', { err: err.message }));
    }
    return resultado;
  });
}
