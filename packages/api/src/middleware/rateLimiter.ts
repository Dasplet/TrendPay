import rateLimit from 'express-rate-limit';
import jwt from 'jsonwebtoken';
import type { Request } from 'express';

// Quién hace la petición según su token (firmado y vigente). null = no hay sesión válida.
export function identidadDeLaPeticion(req: Request): string | null {
  const header = req.headers.authorization;
  if (!header?.startsWith('Bearer ')) return null;
  try {
    const payload = jwt.verify(header.slice(7), process.env.JWT_SECRET!) as { id?: string };
    return typeof payload.id === 'string' ? payload.id : null;
  } catch { return null; }
}

// Las pantallas se actualizan solas (tiempo real + consultas de respaldo): las lecturas de una sesión válida no gastan el
// límite general, que protege contra abusos sin sesión y contra escrituras. Tienen su propio límite, por usuario.
export const esLecturaAutenticada = (req: Request) => req.method === 'GET' && identidadDeLaPeticion(req) !== null;

const apiWindowMs = Number.parseInt(process.env.RATE_LIMIT_WINDOW_MS || '900000'); // 15 min
const apiMax = Number.parseInt(process.env.RATE_LIMIT_MAX || '100');

export const apiLimiter = rateLimit({ windowMs: apiWindowMs, max: apiMax, standardHeaders: true, legacyHeaders: false, skip: (req) => process.env.NODE_ENV === 'test' || esLecturaAutenticada(req), message: { ok: false, mensaje: 'Demasiadas solicitudes. Intenta en 15 minutos.' } });

// Lecturas de una sesión válida: 600 por minuto por usuario (un panel de monitoreo consulta unas decenas por minuto)
export const lecturaLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: Number.parseInt(process.env.RATE_LIMIT_LECTURA_MAX || '600'),
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req) => identidadDeLaPeticion(req) ?? req.ip ?? 'anonimo',
  skip: (req) => process.env.NODE_ENV === 'test' || !esLecturaAutenticada(req),
  message: { ok: false, mensaje: 'Demasiadas consultas. Espera un momento.' },
});

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
