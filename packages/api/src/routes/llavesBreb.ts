import { Router, Request, Response } from 'express';
import { z } from 'zod';
import { prisma } from '../index';
import { authenticate } from '../middleware/auth';
import { walletLimiter } from '../middleware/rateLimiter';
import { conCuenta } from '../utils/cuentas';
import { logger } from '../utils/logger';

// ══════════════════════════════════════
// LLAVES BRE-B
// ══════════════════════════════════════
// El cliente guarda aquí sus llaves Bre-B para, más adelante, cobrar con ellas (hoy el cobro por QR es el de TrendPay).
// Las llaves pertenecen a la cuenta principal (titular): las sedes pueden verlas pero no cambiarlas.

const router = Router();

export const TIPOS_LLAVE = ['celular', 'correo', 'documento', 'alfanumerica'] as const;
export type TipoLlave = (typeof TIPOS_LLAVE)[number];
export const MAX_LLAVES = 5;

// Devuelve la llave en su forma normal, o null si no tiene el formato de ese tipo
export function normalizarLlave(tipo: TipoLlave, valor: string): string | null {
  const v = valor.trim();
  switch (tipo) {
    case 'celular': {
      const digitos = v.replace(/[\s\-()]/g, '').replace(/^\+?57/, '');
      return /^3\d{9}$/.test(digitos) ? digitos : null;
    }
    case 'correo': return z.string().email().max(120).safeParse(v).success ? v.toLowerCase() : null;
    case 'documento': {
      const d = v.replace(/[.\s-]/g, '');
      return /^\d{5,15}$/.test(d) ? d : null;
    }
    case 'alfanumerica': return /^@[A-Za-z0-9]{3,20}$/.test(v) ? v : null;
  }
}

const crearSchema = z.object({
  tipo: z.enum(TIPOS_LLAVE),
  valor: z.string().min(3).max(120),
  alias: z.string().trim().max(40).optional(),
});

const mapLlave = (l: { id: string; tipo: string; valor: string; alias: string | null; estado: string; createdAt: Date }) =>
  ({ id: l.id, tipo: l.tipo, valor: l.valor, alias: l.alias, estado: l.estado, createdAt: l.createdAt });

// ══ GET /api/llaves-breb ══
router.get('/', authenticate, conCuenta('recargar'), async (req: Request, res: Response) => {
  try {
    const llaves = await prisma.llaveBreb.findMany({ where: { userId: req.cuenta!.titularId }, orderBy: { createdAt: 'asc' } });
    res.json({ ok: true, llaves: llaves.map(mapLlave), maximo: MAX_LLAVES, puedeEditar: req.cuenta!.titularId === req.user!.id });
  } catch (err: any) {
    logger.error('Error listando llaves Bre-B', { err: err.message, userId: req.user?.id });
    res.status(500).json({ ok: false, mensaje: 'No se pudieron cargar tus llaves' });
  }
});

// ══ POST /api/llaves-breb ══
router.post('/', authenticate, walletLimiter, conCuenta('recargar'), async (req: Request, res: Response) => {
  if (req.cuenta!.titularId !== req.user!.id) return res.status(403).json({ ok: false, mensaje: 'Solo la cuenta principal puede administrar las llaves Bre-B' });
  const parse = crearSchema.safeParse(req.body);
  if (!parse.success) return res.status(400).json({ ok: false, mensaje: 'Indica el tipo de llave y su valor' });
  const { tipo, valor, alias } = parse.data;

  const normal = normalizarLlave(tipo, valor);
  if (!normal) {
    const ayuda: Record<TipoLlave, string> = {
      celular: 'El celular debe tener 10 dígitos y empezar por 3 (ej. 3001234567)',
      correo: 'Escribe un correo válido',
      documento: 'El documento debe tener solo números (5 a 15 dígitos)',
      alfanumerica: 'La llave alfanumérica empieza por @ y lleva de 3 a 20 letras o números (ej. @micomercio)',
    };
    return res.status(400).json({ ok: false, mensaje: ayuda[tipo] });
  }

  try {
    const titularId = req.cuenta!.titularId;
    if ((await prisma.llaveBreb.count({ where: { userId: titularId } })) >= MAX_LLAVES) {
      return res.status(400).json({ ok: false, mensaje: `Puedes guardar hasta ${MAX_LLAVES} llaves Bre-B` });
    }
    if (await prisma.llaveBreb.findUnique({ where: { userId_tipo_valor: { userId: titularId, tipo, valor: normal } } })) {
      return res.status(409).json({ ok: false, mensaje: 'Esa llave ya está guardada' });
    }
    const llave = await prisma.llaveBreb.create({ data: { userId: titularId, tipo, valor: normal, alias: alias || null } });
    await prisma.userAuditLog.create({ data: { userId: titularId, accion: 'AGREGAR_LLAVE_BREB', campo: tipo, valorAntes: null, valorDespues: tipo === 'correo' ? '***' : normal.slice(0, 2) + '***', ip: req.ip } }).catch(() => {});
    res.status(201).json({ ok: true, llave: mapLlave(llave) });
  } catch (err: any) {
    if (err.code === 'P2002') return res.status(409).json({ ok: false, mensaje: 'Esa llave ya está guardada' });
    logger.error('Error guardando llave Bre-B', { err: err.message, userId: req.user?.id });
    res.status(500).json({ ok: false, mensaje: 'No se pudo guardar la llave' });
  }
});

// ══ DELETE /api/llaves-breb/:id ══
router.delete('/:id', authenticate, walletLimiter, conCuenta('recargar'), async (req: Request, res: Response) => {
  if (req.cuenta!.titularId !== req.user!.id) return res.status(403).json({ ok: false, mensaje: 'Solo la cuenta principal puede administrar las llaves Bre-B' });
  try {
    const borrada = await prisma.llaveBreb.deleteMany({ where: { id: req.params.id, userId: req.cuenta!.titularId } });
    if (borrada.count === 0) return res.status(404).json({ ok: false, mensaje: 'Llave no encontrada' });
    await prisma.userAuditLog.create({ data: { userId: req.user!.id, accion: 'QUITAR_LLAVE_BREB', campo: 'llave', valorAntes: req.params.id, valorDespues: null, ip: req.ip } }).catch(() => {});
    res.json({ ok: true });
  } catch (err: any) {
    logger.error('Error quitando llave Bre-B', { err: err.message, userId: req.user?.id });
    res.status(500).json({ ok: false, mensaje: 'No se pudo quitar la llave' });
  }
});

export default router;
