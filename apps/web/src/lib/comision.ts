'use client';
import { useQuery } from '@tanstack/react-query';
import { walletApi } from '@/lib/api';

// Misma cuenta que hace el servidor: en pesos enteros, redondeando hacia arriba
export function calcularComision(monto: number, pct: number): number {
  const comision = Math.ceil((monto * pct) / 100 - 1e-9);
  return comision > 0 ? comision : 0;
}

// La comisión general vigente (la que fija el administrador). Mientras carga se usa 3%, y se renueva sola en vivo.
export function useComision(): number {
  const { data } = useQuery({
    queryKey: ['wallet-comision'],
    queryFn: () => walletApi.comision().then((r) => Number(r.data.comisionPct)),
  });
  return typeof data === 'number' && Number.isFinite(data) ? data : 3;
}

export const textoPct = (pct: number) => `${Number.isInteger(pct) ? pct : pct.toString().replace('.', ',')}%`;
