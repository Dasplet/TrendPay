import rateLimit from 'express-rate-limit';

const apiWindowMs = Number.parseInt(process.env.RATE_LIMIT_WINDOW_MS || '900000'); // 15 min
const apiMax = Number.parseInt(process.env.RATE_LIMIT_MAX || '100');

export const apiLimiter = rateLimit({ windowMs: apiWindowMs, max: apiMax, standardHeaders: true, legacyHeaders: false, skip: () => process.env.NODE_ENV === 'test', message: { ok: false, mensaje: 'Demasiadas solicitudes. Intenta en 15 minutos.' } });

export const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 10, // Max 10 login attempts per 15 min
  standardHeaders: true,
  legacyHeaders: false,
  skip: () => process.env.NODE_ENV === 'test',
  message: { ok: false, mensaje: 'Demasiados intentos de acceso. Intenta en 15 minutos.' },
});

// El webhook no lleva sesión; este límite evita que se use para saturar el servidor o la base de datos.
export const webhookLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 120,
  standardHeaders: true,
  legacyHeaders: false,
  skip: () => process.env.NODE_ENV === 'test',
  message: { ok: false },
});

export const walletLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 20,
  skip: () => process.env.NODE_ENV === 'test',
  message: { ok: false, mensaje: 'Demasiadas operaciones. Espera un momento.' },
});
