import { Request, Response, NextFunction } from 'express';
import { prisma } from '../index';

// ══════════════════════════════════════
// SUBCUENTAS EMPRESARIALES
// ══════════════════════════════════════
// Una cuenta padre es dueña de la billetera; sus subcuentas (User.cuentaPadreId)
// no tienen billetera propia y operan sobre la del padre, limitadas por sus
// permisos. Todo acceso a "la billetera del usuario" debe pasar por el titular
// (titularId), nunca por req.user.id directamente.

export type Permiso = 'verSaldo' | 'recargar' | 'enviar' | 'retirar';
export type Permisos = Record<Permiso, boolean>;

export interface Cuenta {
  titularId: string;   // dueño de la billetera (el padre, o el propio usuario)
  esSubcuenta: boolean;
  permisos: Permisos;
}

declare global {
  namespace Express {
    interface Request {
      cuenta?: Cuenta;
    }
  }
}

interface UsuarioConPermisos {
  id: string;
  cuentaPadreId: string | null;
  permisoVerSaldo: boolean;
  permisoRecargar: boolean;
  permisoEnviar: boolean;
  permisoRetirar: boolean;
}

export function cuentaDe(user: UsuarioConPermisos): Cuenta {
  return {
    titularId: user.cuentaPadreId ?? user.id,
    esSubcuenta: user.cuentaPadreId !== null,
    permisos: {
      verSaldo: user.permisoVerSaldo,
      recargar: user.permisoRecargar,
      enviar: user.permisoEnviar,
      retirar: user.permisoRetirar,
    },
  };
}

export async function cargarCuenta(userId: string): Promise<Cuenta | null> {
  const user = await prisma.user.findUnique({ where: { id: userId } });
  return user ? cuentaDe(user) : null;
}

// Ids de todos los usuarios que comparten la billetera del titular (él y sus
// subcuentas) — para listar historial, consignaciones o retiros "de la empresa".
export async function miembrosDe(titularId: string): Promise<string[]> {
  const subcuentas = await prisma.user.findMany({ where: { cuentaPadreId: titularId }, select: { id: true } });
  return [titularId, ...subcuentas.map((s) => s.id)];
}

const MENSAJES_SIN_PERMISO: Record<Permiso, string> = {
  verSaldo: 'Tu cuenta no tiene permiso para ver el saldo',
  recargar: 'Tu cuenta no tiene permiso para recargar',
  enviar: 'Tu cuenta no tiene permiso para enviar dinero',
  retirar: 'Tu cuenta no tiene permiso para retirar',
};

// Middleware: carga req.cuenta (debe ir después de authenticate) y exige los
// permisos indicados. Sin argumentos solo carga la cuenta.
export function conCuenta(...requeridos: Permiso[]) {
  return async (req: Request, res: Response, next: NextFunction) => {
    try {
      const cuenta = await cargarCuenta(req.user!.id);
      if (!cuenta) return res.status(404).json({ ok: false, mensaje: 'Usuario no encontrado' });
      const faltante = requeridos.find((p) => !cuenta.permisos[p]);
      if (faltante) return res.status(403).json({ ok: false, mensaje: MENSAJES_SIN_PERMISO[faltante], code: 'SIN_PERMISO' });
      req.cuenta = cuenta;
      next();
    } catch (err) {
      next(err);
    }
  };
}

// Include de Prisma para armar el payload de /me, /login, /profile: trae la
// billetera propia y, si es subcuenta, la del padre.
export const INCLUDE_BILLETERA = {
  wallet: true,
  cuentaPadre: { select: { id: true, nombre: true, wallet: true } },
} as const;

interface UsuarioConBilletera extends UsuarioConPermisos {
  wallet: { id: string; saldo: { toString(): string } } | null;
  cuentaPadre?: { id: string; nombre: string; wallet: { id: string; saldo: { toString(): string } } | null } | null;
}

// Campos de billetera/permisos que se agregan al objeto `usuario` que ve el
// frontend. Si la cuenta no puede ver el saldo, saldo va en null.
export function datosBilletera(user: UsuarioConBilletera) {
  const cuenta = cuentaDe(user);
  const wallet = cuenta.esSubcuenta ? user.cuentaPadre?.wallet : user.wallet;
  const saldo = cuenta.permisos.verSaldo ? Number.parseFloat(wallet?.saldo.toString() || '0') : null;
  return {
    saldo,
    walletId: wallet?.id,
    permisos: cuenta.permisos,
    cuentaPadre: user.cuentaPadre ? { id: user.cuentaPadre.id, nombre: user.cuentaPadre.nombre } : null,
  };
}

// Oculta el saldo en respuestas de operaciones para cuentas sin verSaldo.
export function saldoVisible(cuenta: Cuenta | undefined, saldo: number | undefined): number | undefined {
  return cuenta && !cuenta.permisos.verSaldo ? undefined : saldo;
}
