import { Request, Response, NextFunction } from 'express';
import { logger } from '../utils/logger';

export function errorHandler(err: any, req: Request, res: Response, _next: NextFunction) {
  logger.error('Error no manejado', { err: err.message, stack: err.stack, path: req.path });
  res.status(err.status || 500).json({
    ok: false,
    mensaje: process.env.NODE_ENV === 'production' ? 'Error interno del servidor' : err.message,
  });
}
