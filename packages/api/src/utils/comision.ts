import { prisma } from '../index';

// Comisión general de TrendPay: se cobra encima del monto en las consignaciones (tarjeta, PSE, Bre-B) y en los envíos entre
// cuentas. Es una sola cifra, la que el administrador fija en Admin → Comisiones. (Los retiros no llevan comisión y los
// cobros con datáfono tienen la suya, en Admin → Datáfonos.)

export const CLAVE_COMISION_GENERAL = 'comision_pct';
export const COMISION_POR_DEFECTO = 3;
export const COMISION_MAXIMA = 20;

export async function comisionGeneralPct(): Promise<number> {
  const cfg = await prisma.config.findUnique({ where: { clave: CLAVE_COMISION_GENERAL } });
  const pct = cfg ? Number.parseFloat(cfg.valor) : COMISION_POR_DEFECTO;
  return Number.isFinite(pct) && pct >= 0 && pct <= COMISION_MAXIMA ? pct : COMISION_POR_DEFECTO;
}

export async function guardarComisionGeneralPct(pct: number): Promise<void> {
  await prisma.config.upsert({ where: { clave: CLAVE_COMISION_GENERAL }, create: { clave: CLAVE_COMISION_GENERAL, valor: String(pct) }, update: { valor: String(pct) } });
}

// La comisión de un monto, en pesos enteros (se redondea hacia arriba, como siempre se ha hecho)
export function calcularComision(monto: number, pct: number): number {
  const comision = Math.ceil((monto * pct) / 100 - 1e-9); // el margen evita que un decimal de máquina suba un peso de más
  return comision > 0 ? comision : 0; // sin comisión es 0 (no -0)
}
