import { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import { prisma } from '../index';

export interface AuthUser {
  id: string;
  cedula: string;
  nombre: string;
  rol: string;
  subRol?: string | null;
}

declare global {
  namespace Express {
    interface Request {
      user?: AuthUser;
    }
  }
}

export function authenticate(req: Request, res: Response, next: NextFunction) {
  const header = req.headers.authorization;
  const token  = header?.startsWith('Bearer ') ? header.slice(7) : null;

  if (!token) {
    return res.status(401).json({ ok: false, mensaje: 'Token de acceso requerido' });
  }

  try {
    const payload = jwt.verify(token, process.env.JWT_SECRET!) as AuthUser;
    req.user = payload;
    next();
  } catch (err: any) {
    if (err.name === 'TokenExpiredError') {
      return res.status(401).json({ ok: false, mensaje: 'Token expirado', code: 'TOKEN_EXPIRED' });
    }
    return res.status(401).json({ ok: false, mensaje: 'Token inválido' });
  }
}

export function requireAdmin(req: Request, res: Response, next: NextFunction) {
  if (req.user?.rol !== 'admin') {
    return res.status(403).json({ ok: false, mensaje: 'Acceso restringido a administradores' });
  }
  next();
}

export function requireSuperAdmin(req: Request, res: Response, next: NextFunction) {
  if (req.user?.rol !== 'admin') {
    return res.status(403).json({ ok: false, mensaje: 'Acceso restringido' });
  }
  next();
}

// Audit middleware — logs admin actions automatically
export function audit(accion: string, tabla?: string) {
  return async (req: Request, _res: Response, next: NextFunction) => {
    next();
    if (req.user) {
      try {
        await prisma.auditLog.create({
          data: {
            userId: req.user.id,
            accion,
            tabla: tabla || null,
            ip: req.ip || null,
            datos: { method: req.method, path: req.path },
          },
        });
      } catch { /* non-critical */ }
    }
  };
}
