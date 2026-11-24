import { createHmac, randomInt, timingSafeEqual } from 'node:crypto';
import type { NextFunction, Request, Response } from 'express';
import { prisma } from '../index';
import { logger } from './logger';
import { sendOtpEmail } from './email';
import { maskEmail } from './security';

// ══════════════════════════════════════
// VERIFICACIÓN EN DOS PASOS (2FA)
// ══════════════════════════════════════
// Un código de 6 dígitos al correo de la cuenta. Sirve para: entrar (login), encender o apagar la verificación
// (activar / desactivar) y confirmar operaciones sensibles (operacion: enviar dinero, retirar, cambiar el PIN).
// Cada código es de un solo uso, vence a los 10 minutos y se bloquea tras 5 intentos fallidos. En la base de datos solo se
// guarda su huella, nunca el código.

export type Proposito = 'login' | 'activar' | 'desactivar' | 'operacion';

export const VIGENCIA_CODIGO_MS = 10 * 60_000;
export const MAX_INTENTOS_CODIGO = 5;
export const ESPERA_REENVIO_MS = 30_000;

const huella = (userId: string, proposito: Proposito, codigo: string) =>
  createHmac('sha256', process.env.JWT_SECRET || 'trendpay-2fa').update(`${userId}:${proposito}:${codigo}`).digest('hex');

const iguales = (a: string, b: string) => a.length === b.length && timingSafeEqual(Buffer.from(a), Buffer.from(b));

export type ResultadoEmision =
  | { ok: true; codigo: string; correo: string }
  | { ok: false; status: number; mensaje: string };

export async function emitirCodigo(user: { id: string; correo: string | null }, proposito: Proposito): Promise<ResultadoEmision> {
  if (!user.correo) return { ok: false, status: 422, mensaje: 'Esta cuenta no tiene un correo configurado para recibir el código' };

  // Para no llenar el correo de códigos: se espera un poco entre uno y otro (el anterior sigue valiendo hasta que llegue el nuevo)
  const ultimo = await prisma.codigoVerificacion.findFirst({ where: { userId: user.id, proposito }, orderBy: { createdAt: 'desc' } });
  if (ultimo && Date.now() - ultimo.createdAt.getTime() < ESPERA_REENVIO_MS) {
    const falta = Math.ceil((ESPERA_REENVIO_MS - (Date.now() - ultimo.createdAt.getTime())) / 1000);
    return { ok: false, status: 429, mensaje: `Espera ${falta} segundos antes de pedir otro código` };
  }

  const codigo = String(randomInt(100000, 1000000));
  const registro = await prisma.$transaction(async (tx) => {
    await tx.codigoVerificacion.deleteMany({ where: { userId: user.id, proposito } });
    return tx.codigoVerificacion.create({ data: { userId: user.id, proposito, codigoHash: huella(user.id, proposito, codigo), expiraAt: new Date(Date.now() + VIGENCIA_CODIGO_MS) } });
  });

  try {
    const enviado = await sendOtpEmail(user.correo, codigo);
    if (!enviado) logger.info(`Código 2FA (${proposito}) para ${user.id}: ${codigo} (correo no configurado, modo debug)`);
  } catch (err: any) {
    await prisma.codigoVerificacion.delete({ where: { id: registro.id } }).catch(() => {});
    logger.error('Error enviando el código de verificación', { err: err.message, userId: user.id, proposito });
    return { ok: false, status: 500, mensaje: 'No pudimos enviar el código de verificación. Intenta de nuevo.' };
  }
  return { ok: true, codigo, correo: maskEmail(user.correo) };
}

export type ResultadoVerificacion = { ok: true } | { ok: false; mensaje: string };

export async function verificarCodigo(userId: string, proposito: Proposito, codigo: unknown): Promise<ResultadoVerificacion> {
  const registro = await prisma.codigoVerificacion.findFirst({ where: { userId, proposito }, orderBy: { createdAt: 'desc' } });
  if (!registro) return { ok: false, mensaje: 'Código no encontrado. Pide uno nuevo.' };
  if (registro.expiraAt.getTime() < Date.now()) {
    await prisma.codigoVerificacion.delete({ where: { id: registro.id } }).catch(() => {});
    return { ok: false, mensaje: 'El código venció. Pide uno nuevo.' };
  }
  if (registro.intentos >= MAX_INTENTOS_CODIGO) {
    await prisma.codigoVerificacion.delete({ where: { id: registro.id } }).catch(() => {});
    return { ok: false, mensaje: 'Demasiados intentos. Pide un código nuevo.' };
  }
  const texto = typeof codigo === 'string' || typeof codigo === 'number' ? String(codigo).trim() : '';
  if (!/^\d{4,8}$/.test(texto) || !iguales(registro.codigoHash, huella(userId, proposito, texto))) {
    const intentos = registro.intentos + 1;
    if (intentos >= MAX_INTENTOS_CODIGO) {
      await prisma.codigoVerificacion.delete({ where: { id: registro.id } }).catch(() => {});
      return { ok: false, mensaje: 'Código incorrecto. Superaste los intentos: pide un código nuevo.' };
    }
    await prisma.codigoVerificacion.update({ where: { id: registro.id }, data: { intentos } });
    return { ok: false, mensaje: `Código incorrecto. Te quedan ${MAX_INTENTOS_CODIGO - intentos} intentos.` };
  }
  // Un solo uso: si dos peticiones llegan a la vez con el mismo código, solo una lo consume
  const borrado = await prisma.codigoVerificacion.deleteMany({ where: { id: registro.id } });
  return borrado.count === 1 ? { ok: true } : { ok: false, mensaje: 'Código no encontrado. Pide uno nuevo.' };
}

// Operaciones sensibles (enviar dinero, retirar, cambiar el PIN): si la cuenta que las hace tiene la verificación
// encendida, además del PIN hay que mandar el código del correo en el campo `codigo2fa`. Sin código responde 403 con
// requiere2fa: true para que la pantalla lo pida.
export async function exigir2fa(req: Request, res: Response, next: NextFunction) {
  try {
    const user = await prisma.user.findUnique({ where: { id: req.user!.id }, select: { requiere2fa: true } });
    if (!user?.requiere2fa) return next();
    const codigo = req.body?.codigo2fa ?? req.get('x-codigo-2fa');
    if (codigo === undefined || codigo === null || codigo === '') {
      return res.status(403).json({ ok: false, requiere2fa: true, mensaje: 'Ingresa el código que enviamos a tu correo para confirmar esta operación' });
    }
    const r = await verificarCodigo(req.user!.id, 'operacion', codigo);
    if (!r.ok) return res.status(403).json({ ok: false, requiere2fa: true, mensaje: r.mensaje });
    next();
  } catch (err: any) {
    logger.error('Error verificando el código 2FA de una operación', { err: err.message, userId: req.user?.id });
    res.status(500).json({ ok: false, mensaje: 'No se pudo verificar el código' });
  }
}
