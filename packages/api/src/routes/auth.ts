import { Router, Request, Response } from 'express';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { z } from 'zod';
import { randomUUID, randomInt } from 'node:crypto';
import { prisma } from '../index';
import { authenticate, AuthUser } from '../middleware/auth';
import type { NextFunction } from 'express';
import { authLimiter } from '../middleware/rateLimiter';
import { logger } from '../utils/logger';
import { INCLUDE_BILLETERA, datosBilletera } from '../utils/cuentas';
import { sendOtpEmail } from '../utils/email';
import { emitirCodigo, verificarCodigo, exigir2fa } from '../utils/verificacion2fa';
import { maskEmail } from '../utils/security';

const router = Router();

// ── Token helpers ──
function generateTokens(user: AuthUser) {
  const accessToken = jwt.sign(
    { id: user.id, cedula: user.cedula, nombre: user.nombre, rol: user.rol, subRol: user.subRol },
    process.env.JWT_SECRET!,
    { expiresIn: process.env.JWT_EXPIRES_IN || '15m' } as jwt.SignOptions
  );
  const refreshToken = jwt.sign(
    { id: user.id, jti: randomUUID() }, // jti evita colisiones si se emiten dos tokens en el mismo segundo
    process.env.JWT_REFRESH_SECRET!,
    { expiresIn: process.env.JWT_REFRESH_EXPIRES_IN || '30d' } as jwt.SignOptions
  );
  return { accessToken, refreshToken };
}

// ── Session helpers ──
const SESSION_MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000; // 30 días

async function createSession(req: Request, userId: string, refreshToken: string) {
  await prisma.session.create({
    data: {
      userId,
      refreshToken,
      userAgent: req.headers['user-agent'] || null,
      ip: req.ip || null,
      expiresAt: new Date(Date.now() + SESSION_MAX_AGE_MS),
    },
  });
}

function setRefreshCookie(res: Response, refreshToken: string) {
  res.cookie('refreshToken', refreshToken, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'strict',
    maxAge: SESSION_MAX_AGE_MS,
  });
}

// Emite tokens + sesión y responde con el usuario — el tramo final común
// tanto del login directo como de completar un login con 2FA.
async function completeLogin(req: Request, res: Response, user: any) {
  const authUser: AuthUser = { id: user.id, cedula: user.cedula, nombre: user.nombre, rol: user.rol, subRol: user.subRol };
  const { accessToken, refreshToken } = generateTokens(authUser);

  await createSession(req, user.id, refreshToken);
  setRefreshCookie(res, refreshToken);

  logger.info('Login exitoso', { userId: user.id, cedula: user.cedula });

  res.json({ ok: true, accessToken, refreshToken /* también en body para móvil */, usuario: { id: user.id, cedula: user.cedula, nombre: user.nombre, correo: user.correo, celular: user.celular, ciudad: user.ciudad, rol: user.rol, subRol: user.subRol, kycVerificado: user.kycVerificado, requiere2fa: user.requiere2fa, ...datosBilletera(user) } });
}

// ── 2FA de login: si la cuenta la tiene encendida, después del PIN se pide un código que llega al correo ──
function checkAccountBlocked(user: { bloqueado: boolean; bloqueadoHasta: Date | null }): string | null {
  if (!user.bloqueado || !user.bloqueadoHasta || user.bloqueadoHasta <= new Date()) return null;
  const mins = Math.ceil((user.bloqueadoHasta.getTime() - Date.now()) / 60000);
  return `Cuenta bloqueada. Intenta en ${mins} minutos.`;
}

async function registerFailedPinAttempt(userId: string, intentosPinActual: number): Promise<string> {
  const intentos = intentosPinActual + 1;
  const update: any = { intentosPin: intentos };
  if (intentos >= 5) {
    update.bloqueado = true;
    update.bloqueadoHasta = new Date(Date.now() + 30 * 60 * 1000); // 30 min
    update.intentosPin = 0;
  }
  await prisma.user.update({ where: { id: userId }, data: update });
  const restantes = Math.max(0, 5 - intentos);
  return intentos >= 5 ? 'Cuenta bloqueada por 30 minutos' : `PIN incorrecto. ${restantes} intentos restantes`;
}

type Login2faStart = { ok: true; otp: string } | { ok: false; status: number; mensaje: string };

async function startLogin2fa(user: { id: string; correo: string | null }): Promise<Login2faStart> {
  const r = await emitirCodigo(user, 'login');
  if (!r.ok) return { ok: false, status: r.status === 422 ? 500 : r.status, mensaje: r.status === 422 ? 'Esta cuenta requiere verificación en dos pasos pero no tiene un correo configurado' : r.mensaje };
  return { ok: true, otp: r.codigo };
}

// ══ POST /api/auth/login ══
const loginSchema = z.object({
  cedula: z.string().min(6).max(20),
  pin:    z.string().length(4).regex(/^\d{4}$/),
});

router.post('/login', authLimiter, async (req: Request, res: Response) => {
  const parse = loginSchema.safeParse(req.body);
  if (!parse.success) {
    return res.status(400).json({ ok: false, mensaje: 'Cédula y PIN de 4 dígitos requeridos' });
  }
  const { cedula, pin } = parse.data;

  try {
    const user = await prisma.user.findUnique({
      where: { cedula },
      include: INCLUDE_BILLETERA,
    });

    if (!user) {
      return res.status(401).json({ ok: false, mensaje: 'Cédula o PIN incorrectos' });
    }

    const blockedMsg = checkAccountBlocked(user);
    if (blockedMsg) return res.status(423).json({ ok: false, mensaje: blockedMsg });

    const pinOk = await bcrypt.compare(pin, user.pinHash);
    if (!pinOk) {
      const mensaje = await registerFailedPinAttempt(user.id, user.intentosPin);
      return res.status(401).json({ ok: false, mensaje });
    }

    // Reset intentos
    await prisma.user.update({
      where: { id: user.id },
      data: { intentosPin: 0, bloqueado: false, bloqueadoHasta: null, ultimoLogin: new Date() },
    });

    if (user.requiere2fa) {
      const result = await startLogin2fa(user);
      if (!result.ok) return res.status(result.status).json({ ok: false, mensaje: result.mensaje });
      return res.json({
        ok: true,
        requiere2fa: true,
        mensaje: `Código enviado a ${maskEmail(user.correo!)}`,
        ...(process.env.NODE_ENV !== 'production' ? { otp_debug: result.otp } : {}),
      });
    }

    await completeLogin(req, res, user);
  } catch (err: any) {
    logger.error('Error en login', { err: err.message });
    res.status(500).json({ ok: false, mensaje: 'Error interno' });
  }
});

// ══ POST /api/auth/login/verify-2fa ══
const verify2faSchema = z.object({
  cedula: z.string().min(6).max(20),
  otp:    z.string().min(4).max(8),
});

router.post('/login/verify-2fa', authLimiter, async (req: Request, res: Response) => {
  const parse = verify2faSchema.safeParse(req.body);
  if (!parse.success) return res.status(400).json({ ok: false, mensaje: 'Datos inválidos' });
  const { cedula, otp } = parse.data;

  try {
    const user = await prisma.user.findUnique({ where: { cedula }, include: INCLUDE_BILLETERA });
    if (!user?.requiere2fa) return res.status(400).json({ ok: false, mensaje: 'Código no encontrado. Inicia sesión de nuevo.' });
    const r = await verificarCodigo(user.id, 'login', otp);
    if (!r.ok) return res.status(400).json({ ok: false, mensaje: r.mensaje });

    await completeLogin(req, res, user);
  } catch (err: any) {
    logger.error('Error verificando 2FA de login', { err: err.message, cedula });
    res.status(500).json({ ok: false, mensaje: 'Error interno' });
  }
});

// ══ POST /api/auth/register ══
const registerSchema = z.object({
  cedula:          z.string().min(6).max(20),
  nombre:          z.string().min(3).max(200),
  correo:          z.string().email(),
  pin:             z.string().length(4).regex(/^\d{4}$/),
  celular:         z.string().optional(),
  ciudad:          z.string().optional(),
});

router.post('/register', authLimiter, async (req: Request, res: Response) => {
  const parse = registerSchema.safeParse(req.body);
  if (!parse.success) {
    return res.status(400).json({ ok: false, mensaje: parse.error.errors[0].message });
  }
  const { cedula, nombre, correo, pin, celular, ciudad } = parse.data;

  try {
    // Check duplicates
    const exists = await prisma.user.findFirst({
      where: { OR: [{ cedula }, { correo }] },
    });
    if (exists) {
      const campo = exists.cedula === cedula ? 'cédula' : 'correo';
      return res.status(400).json({ ok: false, mensaje: `Esta ${campo} ya está registrada` });
    }

    const pinHash = await bcrypt.hash(pin, Number.parseInt(process.env.BCRYPT_ROUNDS || '12'));
    const userId  = randomUUID();

    const user = await prisma.user.create({
      data: {
        id: userId,
        cedula,
        nombre,
        correo,
        celular: celular || null,
        ciudad: ciudad || null,
        pinHash,
        wallet: { create: { saldo: 0 } },
      },
      include: { wallet: true },
    });

    // Welcome notification
    await prisma.notification.create({
      data: {
        userId: user.id,
        tipo: 'ok',
        titulo: '¡Bienvenido a TrendPay!',
        mensaje: `Hola ${nombre.split(' ')[0]}, tu billetera virtual está lista.`,
      },
    });

    const authUser: AuthUser = { id: user.id, cedula: user.cedula, nombre: user.nombre, rol: user.rol, subRol: user.subRol };
    const { accessToken, refreshToken } = generateTokens(authUser);

    await createSession(req, user.id, refreshToken);
    setRefreshCookie(res, refreshToken);

    logger.info('Nuevo usuario registrado', { userId: user.id, cedula });

    res.status(201).json({
      ok: true,
      accessToken,
      refreshToken,
      usuario: {
        id: user.id,
        cedula: user.cedula,
        nombre: user.nombre,
        correo: user.correo,
        celular: user.celular,
        ciudad: user.ciudad,
        rol: user.rol,
        saldo: 0,
        walletId: user.wallet?.id,
      },
    });
  } catch (err: any) {
    logger.error('Error en registro', { err: err.message });
    res.status(500).json({ ok: false, mensaje: 'Error creando cuenta' });
  }
});

// ══ POST /api/auth/refresh ══
router.post('/refresh', async (req: Request, res: Response) => {
  const token = req.cookies?.refreshToken || req.body?.refreshToken;
  if (!token) return res.status(401).json({ ok: false, mensaje: 'Refresh token requerido' });

  try {
    jwt.verify(token, process.env.JWT_REFRESH_SECRET!);

    const session = await prisma.session.findFirst({
      where: { refreshToken: token, revokedAt: null, expiresAt: { gt: new Date() } },
      include: { user: true },
    });

    if (!session) {
      res.clearCookie('refreshToken');
      return res.status(401).json({ ok: false, mensaje: 'Sesión inválida o expirada' });
    }

    const user = session.user;
    const authUser: AuthUser = { id: user.id, cedula: user.cedula, nombre: user.nombre, rol: user.rol, subRol: user.subRol };
    const { accessToken, refreshToken: newRefreshToken } = generateTokens(authUser);

    // Rotate refresh token
    await prisma.session.update({ where: { id: session.id }, data: { revokedAt: new Date() } });
    await createSession(req, user.id, newRefreshToken);
    setRefreshCookie(res, newRefreshToken);

    res.json({ ok: true, accessToken, refreshToken: newRefreshToken });
  } catch {
    res.clearCookie('refreshToken');
    res.status(401).json({ ok: false, mensaje: 'Refresh token inválido' });
  }
});

// ══ POST /api/auth/logout ══
router.post('/logout', authenticate, async (req: Request, res: Response) => {
  const token = req.cookies?.refreshToken || req.body?.refreshToken;
  try {
    if (token) {
      await prisma.session.updateMany({
        where: { userId: req.user!.id, refreshToken: token },
        data: { revokedAt: new Date() },
      });
    }
    res.clearCookie('refreshToken');
    res.json({ ok: true, mensaje: 'Sesión cerrada correctamente' });
  } catch {
    res.json({ ok: true });
  }
});

// ══ GET /api/auth/sessions ══
router.get('/sessions', authenticate, soloCuentaPrincipal, async (req: Request, res: Response) => {
  try {
    const actualToken = req.cookies?.refreshToken || req.body?.refreshToken;
    const sessions = await prisma.session.findMany({
      where: { userId: req.user!.id, revokedAt: null, expiresAt: { gt: new Date() } },
      orderBy: { createdAt: 'desc' },
    });
    res.json({
      ok: true,
      sesiones: sessions.map((s) => ({
        id: s.id,
        userAgent: s.userAgent,
        ip: s.ip,
        createdAt: s.createdAt,
        expiresAt: s.expiresAt,
        actual: !!actualToken && s.refreshToken === actualToken,
      })),
    });
  } catch (err: any) {
    logger.error('Error consultando sesiones', { err: err.message, userId: req.user?.id });
    res.status(500).json({ ok: false, mensaje: 'Error consultando sesiones' });
  }
});

// Las tiendas (subcuentas) no administran la seguridad de su acceso: el PIN, la verificación en dos pasos y las sesiones son de la cuenta
// principal de la empresa. Si una tienda necesita cambiar su PIN, lo pide a TrendPay.
export async function soloCuentaPrincipal(req: Request, res: Response, next: NextFunction) {
  try {
    const u = await prisma.user.findUnique({ where: { id: req.user!.id }, select: { cuentaPadreId: true } });
    if (u?.cuentaPadreId) return res.status(403).json({ ok: false, mensaje: 'Esta opción solo está disponible en la cuenta principal de la empresa' });
    next();
  } catch (err: any) {
    logger.error('Error verificando el tipo de cuenta', { err: err.message, userId: req.user?.id });
    res.status(500).json({ ok: false, mensaje: 'No se pudo completar la operación' });
  }
}

// ══ DELETE /api/auth/sessions/:id ══
router.delete('/sessions/:id', authenticate, soloCuentaPrincipal, async (req: Request, res: Response) => {
  try {
    const session = await prisma.session.findUnique({ where: { id: req.params.id } });
    if (session?.userId !== req.user!.id) {
      return res.status(404).json({ ok: false, mensaje: 'Sesión no encontrada' });
    }
    await prisma.session.update({ where: { id: session.id }, data: { revokedAt: new Date() } });
    res.json({ ok: true, mensaje: 'Sesión cerrada' });
  } catch (err: any) {
    logger.error('Error cerrando sesión', { err: err.message, userId: req.user?.id, id: req.params.id });
    res.status(500).json({ ok: false, mensaje: 'Error cerrando la sesión' });
  }
});

// ══ POST /api/auth/sessions/revoke-others ══
router.post('/sessions/revoke-others', authenticate, soloCuentaPrincipal, async (req: Request, res: Response) => {
  try {
    const actualToken = req.cookies?.refreshToken || req.body?.refreshToken;
    await prisma.session.updateMany({
      where: {
        userId: req.user!.id,
        revokedAt: null,
        ...(actualToken ? { refreshToken: { not: actualToken } } : {}),
      },
      data: { revokedAt: new Date() },
    });
    res.json({ ok: true, mensaje: 'Se cerraron las demás sesiones' });
  } catch (err: any) {
    logger.error('Error cerrando otras sesiones', { err: err.message, userId: req.user?.id });
    res.status(500).json({ ok: false, mensaje: 'Error cerrando las demás sesiones' });
  }
});

// ══ POST /api/auth/verify-pin ══
router.post('/verify-pin', authenticate, async (req: Request, res: Response) => {
  const { pin } = req.body;
  if (!pin || !/^\d{4}$/.test(pin)) {
    return res.status(400).json({ ok: false, mensaje: 'PIN de 4 dígitos requerido' });
  }
  try {
    const user = await prisma.user.findUnique({ where: { id: req.user!.id } });
    if (!user) return res.status(404).json({ ok: false });
    const ok = await bcrypt.compare(pin, user.pinHash);
    res.json({ ok, mensaje: ok ? 'PIN correcto' : 'PIN incorrecto' });
  } catch {
    res.status(500).json({ ok: false });
  }
});

// ══ PUT /api/auth/change-pin ══
router.put('/change-pin', authenticate, soloCuentaPrincipal, exigir2fa, async (req: Request, res: Response) => {
  const schema = z.object({
    pin_actual:   z.string().length(4).regex(/^\d{4}$/),
    pin_nuevo:    z.string().length(4).regex(/^\d{4}$/),
    pin_confirmar: z.string().length(4).regex(/^\d{4}$/),
  });
  const parse = schema.safeParse(req.body);
  if (!parse.success) return res.status(400).json({ ok: false, mensaje: 'Datos inválidos' });
  const { pin_actual, pin_nuevo, pin_confirmar } = parse.data;

  if (pin_nuevo !== pin_confirmar) {
    return res.status(400).json({ ok: false, mensaje: 'Los PINs nuevos no coinciden' });
  }

  try {
    const user = await prisma.user.findUnique({ where: { id: req.user!.id } });
    if (!user) return res.status(404).json({ ok: false });

    const ok = await bcrypt.compare(pin_actual, user.pinHash);
    if (!ok) return res.status(400).json({ ok: false, mensaje: 'PIN actual incorrecto' });

    const nuevoHash = await bcrypt.hash(pin_nuevo, Number.parseInt(process.env.BCRYPT_ROUNDS || '12'));
    await prisma.user.update({ where: { id: user.id }, data: { pinHash: nuevoHash } });

    // Audit
    await prisma.userAuditLog.create({
      data: { userId: user.id, accion: 'CAMBIO_PIN', campo: 'pin', valorAntes: '****', valorDespues: '****', ip: req.ip },
    });

    res.json({ ok: true, mensaje: 'PIN actualizado correctamente' });
  } catch (err: any) {
    logger.error('Error actualizando PIN', { err: err.message, userId: req.user?.id });
    res.status(500).json({ ok: false, mensaje: 'Error actualizando PIN' });
  }
});

// ══ GET /api/auth/me ══
router.get('/me', authenticate, async (req: Request, res: Response) => {
  try {
    const user = await prisma.user.findUnique({
      where: { id: req.user!.id },
      include: INCLUDE_BILLETERA,
    });
    if (!user) return res.status(404).json({ ok: false });
    res.json({ ok: true, usuario: { id: user.id, cedula: user.cedula, nombre: user.nombre, correo: user.correo, celular: user.celular, ciudad: user.ciudad, rol: user.rol, subRol: user.subRol, kycVerificado: user.kycVerificado, requiere2fa: user.requiere2fa, ...datosBilletera(user) } });
  } catch {
    res.status(500).json({ ok: false });
  }
});


// ══ Verificación en dos pasos (2FA): encender, apagar y pedir códigos ══
// GET  /api/auth/2fa/estado
// POST /api/auth/2fa/solicitar   { proposito: 'activar' | 'desactivar' | 'operacion', pin }   → envía el código al correo
// POST /api/auth/2fa/activar     { codigo }
// POST /api/auth/2fa/desactivar  { pin, codigo }
const pinSchema = z.string().length(4).regex(/^\d{4}$/);

router.get('/2fa/estado', authenticate, async (req: Request, res: Response) => {
  try {
    const user = await prisma.user.findUnique({ where: { id: req.user!.id }, select: { requiere2fa: true, correo: true } });
    if (!user) return res.status(404).json({ ok: false });
    res.json({ ok: true, activo: user.requiere2fa, correo: user.correo ? maskEmail(user.correo) : null });
  } catch { res.status(500).json({ ok: false }); }
});

// Comprueba el PIN contando los fallos igual que el login (5 fallos bloquean la cuenta 30 minutos)
async function pinValido(userId: string, pin: unknown): Promise<{ ok: true } | { ok: false; status: number; mensaje: string }> {
  const parse = pinSchema.safeParse(pin);
  if (!parse.success) return { ok: false, status: 400, mensaje: 'Ingresa tu PIN de 4 dígitos' };
  const user = await prisma.user.findUnique({ where: { id: userId } });
  if (!user) return { ok: false, status: 404, mensaje: 'Usuario no encontrado' };
  const bloqueo = checkAccountBlocked(user);
  if (bloqueo) return { ok: false, status: 423, mensaje: bloqueo };
  if (!(await bcrypt.compare(parse.data, user.pinHash))) return { ok: false, status: 401, mensaje: await registerFailedPinAttempt(user.id, user.intentosPin) };
  if (user.intentosPin > 0) await prisma.user.update({ where: { id: user.id }, data: { intentosPin: 0 } });
  return { ok: true };
}

router.post('/2fa/solicitar', authenticate, soloCuentaPrincipal, authLimiter, async (req: Request, res: Response) => {
  const proposito = req.body?.proposito;
  if (proposito !== 'activar' && proposito !== 'desactivar' && proposito !== 'operacion') return res.status(400).json({ ok: false, mensaje: 'Propósito inválido' });
  try {
    const user = await prisma.user.findUnique({ where: { id: req.user!.id } });
    if (!user) return res.status(404).json({ ok: false, mensaje: 'Usuario no encontrado' });
    if (proposito === 'activar' && user.requiere2fa) return res.status(400).json({ ok: false, mensaje: 'La verificación en dos pasos ya está activa' });
    if (proposito !== 'activar' && !user.requiere2fa) return res.status(400).json({ ok: false, mensaje: 'La verificación en dos pasos no está activa' });
    if (proposito !== 'operacion') {
      const pin = await pinValido(user.id, req.body?.pin);
      if (!pin.ok) return res.status(pin.status).json({ ok: false, mensaje: pin.mensaje });
    }
    const r = await emitirCodigo(user, proposito);
    if (!r.ok) return res.status(r.status).json({ ok: false, mensaje: r.mensaje });
    res.json({ ok: true, mensaje: `Código enviado a ${r.correo}`, correo: r.correo, vigenciaMinutos: 10, ...(process.env.NODE_ENV !== 'production' ? { otp_debug: r.codigo } : {}) });
  } catch (err: any) {
    logger.error('Error solicitando código 2FA', { err: err.message, userId: req.user?.id });
    res.status(500).json({ ok: false, mensaje: 'No se pudo enviar el código' });
  }
});

async function cambiarEstado2fa(req: Request, res: Response, activar: boolean) {
  try {
    const userId = req.user!.id;
    if (!activar) {
      const pin = await pinValido(userId, req.body?.pin);
      if (!pin.ok) return res.status(pin.status).json({ ok: false, mensaje: pin.mensaje });
    }
    const r = await verificarCodigo(userId, activar ? 'activar' : 'desactivar', req.body?.codigo);
    if (!r.ok) return res.status(400).json({ ok: false, mensaje: r.mensaje });
    await prisma.user.update({ where: { id: userId }, data: { requiere2fa: activar } });
    await prisma.userAuditLog.create({ data: { userId, accion: activar ? 'ACTIVAR_2FA' : 'DESACTIVAR_2FA', campo: 'requiere2fa', valorAntes: String(!activar), valorDespues: String(activar), ip: req.ip } }).catch(() => {});
    res.json({ ok: true, activo: activar, mensaje: activar ? 'Verificación en dos pasos activada' : 'Verificación en dos pasos desactivada' });
  } catch (err: any) {
    logger.error('Error cambiando la verificación en dos pasos', { err: err.message, userId: req.user?.id });
    res.status(500).json({ ok: false, mensaje: 'No se pudo completar el cambio' });
  }
}
router.post('/2fa/activar', authenticate, soloCuentaPrincipal, authLimiter, (req: Request, res: Response) => cambiarEstado2fa(req, res, true));
router.post('/2fa/desactivar', authenticate, soloCuentaPrincipal, authLimiter, (req: Request, res: Response) => cambiarEstado2fa(req, res, false));

// ══ OTP store (memory — usar Redis en producción) ══
const otpStore = new Map<string, { otp: string; expires: Date }>();

// ══ POST /api/auth/validate-email ══
router.post('/validate-email', async (req: Request, res: Response) => {
  const { correo } = req.body;
  if (!correo) return res.status(400).json({ ok: false });
  const emailRegex = /^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$/;
  if (!emailRegex.test(correo)) return res.json({ ok: false, mensaje: 'Formato de correo inválido' });
  const disposable = ['mailinator','guerrillamail','tempmail','yopmail','throwam','sharklasers','fakeinbox'];
  const domain = correo.split('@')[1]?.toLowerCase();
  if (disposable.some((d: string) => domain?.includes(d))) return res.json({ ok: false, mensaje: 'No se permiten correos temporales o desechables' });
  // El registro público sigue exigiendo un correo sin usar (si no, cualquiera podría registrar el correo de otra persona);
  // los administradores sí pueden crear varias cuentas con el mismo correo.
  const existing = await prisma.user.findFirst({ where: { correo, eliminadoAt: null } }).catch(() => null);
  if (existing) return res.json({ ok: false, mensaje: 'Este correo ya está registrado' });
  res.json({ ok: true, mensaje: 'Correo válido' });
});

// ══ POST /api/auth/send-otp ══
router.post('/send-otp', async (req: Request, res: Response) => {
  const { correo, celular } = req.body;
  const key = correo || celular;
  if (!key) return res.status(400).json({ ok: false, mensaje: 'Correo o celular requerido' });
  const otp     = String(randomInt(100000, 1000000));
  const expires = new Date(Date.now() + 10 * 60 * 1000);
  otpStore.set(key, { otp, expires });

  let enviado = false;
  if (correo) {
    try {
      enviado = await sendOtpEmail(correo, otp);
    } catch (err: any) {
      logger.error('Error enviando OTP por correo', { err: err.message, correo });
      otpStore.delete(key);
      return res.status(500).json({ ok: false, mensaje: 'No pudimos enviar el código. Intenta de nuevo.' });
    }
  }
  if (!enviado) logger.info(`OTP para ${key}: ${otp} (SMTP no configurado o envío por celular no implementado)`);

  res.json({
    ok: true,
    mensaje: correo ? `Código enviado a ${maskEmail(correo)}` : `Código enviado al celular ****${celular?.slice(-4)}`,
    ...(process.env.NODE_ENV !== 'production' ? { otp_debug: otp } : {}),
  });
});

// ══ POST /api/auth/verify-otp ══
router.post('/verify-otp', async (req: Request, res: Response) => {
  const { correo, celular, otp } = req.body;
  const key = correo || celular;
  if (!key || !otp) return res.status(400).json({ ok: false, mensaje: 'Datos requeridos' });
  const stored = otpStore.get(key);
  if (!stored) return res.status(400).json({ ok: false, mensaje: 'Código no encontrado. Solicita uno nuevo.' });
  if (new Date() > stored.expires) { otpStore.delete(key); return res.status(400).json({ ok: false, mensaje: 'Código expirado' }); }
  if (stored.otp !== String(otp)) return res.status(400).json({ ok: false, mensaje: 'Código incorrecto' });
  otpStore.delete(key);
  res.json({ ok: true, verificado: true });
});


export default router;
