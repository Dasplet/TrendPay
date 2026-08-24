import { Router, Request, Response } from 'express';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { z } from 'zod';
import { randomUUID, randomInt } from 'crypto';
import { prisma } from '../index';
import { authenticate, AuthUser } from '../middleware/auth';
import { authLimiter } from '../middleware/rateLimiter';
import { logger } from '../utils/logger';
import { sendOtpEmail } from '../utils/email';

const router = Router();

// ── Token helpers ──
function generateTokens(user: AuthUser) {
  const accessToken = jwt.sign(
    { id: user.id, cedula: user.cedula, nombre: user.nombre, rol: user.rol, subRol: user.subRol },
    process.env.JWT_SECRET!,
    { expiresIn: process.env.JWT_EXPIRES_IN || '15m' } as jwt.SignOptions
  );
  const refreshToken = jwt.sign(
    { id: user.id },
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

  res.json({
    ok: true,
    accessToken,
    refreshToken, // también en body para móvil
    usuario: {
      id: user.id,
      cedula: user.cedula,
      nombre: user.nombre,
      correo: user.correo,
      celular: user.celular,
      ciudad: user.ciudad,
      rol: user.rol,
      subRol: user.subRol,
      kycVerificado: user.kycVerificado,
      codigoReferido: user.codigoReferido,
      saldo: parseFloat(user.wallet?.saldo.toString() || '0'),
      walletId: user.wallet?.id,
    },
  });
}

// ── 2FA de login (paso extra por correo para cuentas marcadas como sensibles) ──
const login2faStore = new Map<string, { otp: string; expires: Date; userId: string }>();
const LOGIN_2FA_TTL_MS = 10 * 60 * 1000;

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
      include: { wallet: true },
    });

    if (!user) {
      return res.status(401).json({ ok: false, mensaje: 'Cédula o PIN incorrectos' });
    }

    // Check if blocked
    if (user.bloqueado && user.bloqueadoHasta && user.bloqueadoHasta > new Date()) {
      const mins = Math.ceil((user.bloqueadoHasta.getTime() - Date.now()) / 60000);
      return res.status(423).json({ ok: false, mensaje: `Cuenta bloqueada. Intenta en ${mins} minutos.` });
    }

    const pinOk = await bcrypt.compare(pin, user.pinHash);
    if (!pinOk) {
      const intentos = user.intentosPin + 1;
      const update: any = { intentosPin: intentos };
      if (intentos >= 5) {
        update.bloqueado = true;
        update.bloqueadoHasta = new Date(Date.now() + 30 * 60 * 1000); // 30 min
        update.intentosPin = 0;
      }
      await prisma.user.update({ where: { id: user.id }, data: update });
      const restantes = Math.max(0, 5 - intentos);
      return res.status(401).json({
        ok: false,
        mensaje: intentos >= 5 ? 'Cuenta bloqueada por 30 minutos' : `PIN incorrecto. ${restantes} intentos restantes`,
      });
    }

    // Reset intentos
    await prisma.user.update({
      where: { id: user.id },
      data: { intentosPin: 0, bloqueado: false, bloqueadoHasta: null, ultimoLogin: new Date() },
    });

    if (user.requiere2fa) {
      if (!user.correo) {
        return res.status(500).json({ ok: false, mensaje: 'Esta cuenta requiere verificación en dos pasos pero no tiene un correo configurado' });
      }
      const otp = String(randomInt(100000, 1000000));
      login2faStore.set(cedula, { otp, expires: new Date(Date.now() + LOGIN_2FA_TTL_MS), userId: user.id });
      try {
        const enviado = await sendOtpEmail(user.correo, otp);
        if (!enviado) logger.info(`2FA login para ${cedula}: ${otp} (correo no configurado, modo debug)`);
      } catch (err: any) {
        login2faStore.delete(cedula);
        logger.error('Error enviando código 2FA de login', { err: err.message, cedula });
        return res.status(500).json({ ok: false, mensaje: 'No pudimos enviar el código de verificación. Intenta de nuevo.' });
      }
      return res.json({
        ok: true,
        requiere2fa: true,
        mensaje: `Código enviado a ${user.correo.replace(/(.{2}).*(@.*)/, '$1***$2')}`,
        ...(process.env.NODE_ENV !== 'production' ? { otp_debug: otp } : {}),
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
    const stored = login2faStore.get(cedula);
    if (!stored) return res.status(400).json({ ok: false, mensaje: 'Código no encontrado. Inicia sesión de nuevo.' });
    if (new Date() > stored.expires) { login2faStore.delete(cedula); return res.status(400).json({ ok: false, mensaje: 'Código expirado. Inicia sesión de nuevo.' }); }
    if (stored.otp !== otp) return res.status(400).json({ ok: false, mensaje: 'Código incorrecto' });

    login2faStore.delete(cedula);

    const user = await prisma.user.findUnique({ where: { id: stored.userId }, include: { wallet: true } });
    if (!user) return res.status(404).json({ ok: false, mensaje: 'Usuario no encontrado' });

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
  codigo_referido: z.string().optional(),
});

router.post('/register', authLimiter, async (req: Request, res: Response) => {
  const parse = registerSchema.safeParse(req.body);
  if (!parse.success) {
    return res.status(400).json({ ok: false, mensaje: parse.error.errors[0].message });
  }
  const { cedula, nombre, correo, pin, celular, ciudad, codigo_referido } = parse.data;

  try {
    // Check duplicates
    const exists = await prisma.user.findFirst({
      where: { OR: [{ cedula }, { correo }] },
    });
    if (exists) {
      const campo = exists.cedula === cedula ? 'cédula' : 'correo';
      return res.status(400).json({ ok: false, mensaje: `Esta ${campo} ya está registrada` });
    }

    // Resolve referrer
    let referidorId: string | null = null;
    if (codigo_referido) {
      const referidor = await prisma.user.findUnique({ where: { codigoReferido: codigo_referido.toUpperCase() } });
      if (referidor) referidorId = referidor.id;
    }

    const pinHash      = await bcrypt.hash(pin, parseInt(process.env.BCRYPT_ROUNDS || '12'));
    const codigoPropio = 'REF-' + cedula.slice(-6).padStart(6, '0');
    const userId       = randomUUID();

    const user = await prisma.user.create({
      data: {
        id: userId,
        cedula,
        nombre,
        correo,
        celular: celular || null,
        ciudad: ciudad || null,
        pinHash,
        codigoReferido: codigoPropio,
        referidoPorId: referidorId,
        wallet: { create: { saldo: 0 } },
      },
      include: { wallet: true },
    });

    // Create referral relationship
    if (referidorId) {
      await prisma.referral.create({
        data: { referidorId, referidoId: userId },
      }).catch(() => {});
    }

    // Welcome notification
    await prisma.notification.create({
      data: {
        userId: user.id,
        tipo: 'ok',
        titulo: '¡Bienvenido a TrendPay!',
        mensaje: `Hola ${nombre.split(' ')[0]}, tu billetera virtual está lista.${referidorId ? ' Tu referido fue vinculado correctamente.' : ''}`,
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
        codigoReferido: user.codigoReferido,
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
    const payload = jwt.verify(token, process.env.JWT_REFRESH_SECRET!) as { id: string };

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
router.get('/sessions', authenticate, async (req: Request, res: Response) => {
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

// ══ DELETE /api/auth/sessions/:id ══
router.delete('/sessions/:id', authenticate, async (req: Request, res: Response) => {
  try {
    const session = await prisma.session.findUnique({ where: { id: req.params.id } });
    if (!session || session.userId !== req.user!.id) {
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
router.post('/sessions/revoke-others', authenticate, async (req: Request, res: Response) => {
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
router.put('/change-pin', authenticate, async (req: Request, res: Response) => {
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

    const nuevoHash = await bcrypt.hash(pin_nuevo, parseInt(process.env.BCRYPT_ROUNDS || '12'));
    await prisma.user.update({ where: { id: user.id }, data: { pinHash: nuevoHash } });

    // Audit
    await prisma.userAuditLog.create({
      data: { userId: user.id, accion: 'CAMBIO_PIN', campo: 'pin', valorAntes: '****', valorDespues: '****', ip: req.ip },
    });

    res.json({ ok: true, mensaje: 'PIN actualizado correctamente' });
  } catch (err: any) {
    res.status(500).json({ ok: false, mensaje: 'Error actualizando PIN' });
  }
});

// ══ GET /api/auth/me ══
router.get('/me', authenticate, async (req: Request, res: Response) => {
  try {
    const user = await prisma.user.findUnique({
      where: { id: req.user!.id },
      include: { wallet: true },
    });
    if (!user) return res.status(404).json({ ok: false });
    res.json({
      ok: true,
      usuario: {
        id: user.id, cedula: user.cedula, nombre: user.nombre,
        correo: user.correo, celular: user.celular, ciudad: user.ciudad,
        rol: user.rol, subRol: user.subRol, kycVerificado: user.kycVerificado,
        codigoReferido: user.codigoReferido,
        saldo: parseFloat(user.wallet?.saldo.toString() || '0'),
        walletId: user.wallet?.id,
      },
    });
  } catch {
    res.status(500).json({ ok: false });
  }
});


// ══ OTP store (memory — usar Redis en producción) ══
const otpStore = new Map<string, { otp: string; expires: Date }>();

// ══ POST /api/auth/validate-email ══
router.post('/validate-email', async (req: Request, res: Response) => {
  const { correo } = req.body;
  if (!correo) return res.status(400).json({ ok: false });
  const emailRegex = /^[a-zA-Z0-9._%+\-]+@[a-zA-Z0-9.\-]+\.[a-zA-Z]{2,}$/;
  if (!emailRegex.test(correo)) return res.json({ ok: false, mensaje: 'Formato de correo inválido' });
  const disposable = ['mailinator','guerrillamail','tempmail','yopmail','throwam','sharklasers','fakeinbox'];
  const domain = correo.split('@')[1]?.toLowerCase();
  if (disposable.some((d: string) => domain?.includes(d))) return res.json({ ok: false, mensaje: 'No se permiten correos temporales o desechables' });
  const existing = await prisma.user.findUnique({ where: { correo } }).catch(() => null);
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
    mensaje: correo ? `Código enviado a ${correo.replace(/(.{2}).*(@.*)/, '$1***$2')}` : `Código enviado al celular ****${celular?.slice(-4)}`,
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
