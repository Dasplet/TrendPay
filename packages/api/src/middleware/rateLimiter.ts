import rateLimit from 'express-rate-limit';

export const apiLimiter = rateLimit({
  windowMs: parseInt(process.env.RATE_LIMIT_WINDOW_MS || '900000'), // 15 min
  max: parseInt(process.env.RATE_LIMIT_MAX || '100'),
  standardHeaders: true,
  legacyHeaders: false,
  message: { ok: false, mensaje: 'Demasiadas solicitudes. Intenta en 15 minutos.' },
});

export const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 10, // Max 10 login attempts per 15 min
  standardHeaders: true,
  legacyHeaders: false,
  message: { ok: false, mensaje: 'Demasiados intentos de acceso. Intenta en 15 minutos.' },
});

export const walletLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 20,
  message: { ok: false, mensaje: 'Demasiadas operaciones. Espera un momento.' },
});
