'use client';

import { useQuery } from '@tanstack/react-query';
import { datafonosApi } from '@/lib/api';
import { useAuthStore } from '@/store/authStore';
import { EmptyState, UserModal, fmtCOP } from '@/components/user/UserTheme';
import { ResumenVentas } from '@/components/datafonos/ResumenVentas';

interface Movimiento {
  id: string; estado: string; monto: number; neto?: number; terminal: string; tipo: 'cobro' | 'reembolso'; creado: string; ticketNumber: string | null;
}

// Los cobros y devoluciones se hacen en el datáfono (el cajero digita el valor en el aparato). Aquí solo se ven: cada uno llega a
// TrendPay por aviso de Kushki y se refleja al instante en el saldo y en los movimientos. No se cobra ni se reembolsa desde TrendPay.
export default function DatafonoPage() {
  // La cuenta principal ve el resumen por tienda; una sede (que no ve el saldo) solo ve sus movimientos
  const esPrincipal = useAuthStore((s) => !s.user?.cuentaPadre);
  const { data, isLoading } = useQuery({
    queryKey: ['datafonos-cobros'],
    queryFn: () => datafonosApi.cobros().then((r) => r.data.cobros as Movimiento[]),
  });
  const movimientos = (data ?? []).filter((m) => m.estado === 'aprobado' || m.estado === 'reembolsado');

  return (
    <UserModal title="Datáfonos" subtitle="Cada cobro y devolución hecha en el datáfono se refleja aquí y en tu saldo, en vivo" size="lg">
      <div className="tp-modal-content">
        {esPrincipal && (
          <>
            <p className="tp-modal-label">Ventas con datáfono</p>
            <ResumenVentas />
            <hr className="tp-divider" />
          </>
        )}

        <p className="tp-modal-label">Últimos movimientos</p>
        {isLoading && <p>Cargando…</p>}
        {!isLoading && movimientos.length === 0 && <EmptyState title="Todavía no hay cobros con datáfono" />}
        {movimientos.map((m) => {
          const reembolso = m.tipo === 'reembolso';
          return (
            <div key={m.id} style={{ display: 'flex', justifyContent: 'space-between', gap: 8, padding: '8px 0', fontSize: 14, borderBottom: '1px solid rgba(128,128,128,.15)' }}>
              <span>
                {new Date(m.creado).toLocaleString('es-CO', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' })} · {m.terminal}
                <small style={{ display: 'block', opacity: 0.65 }}>{reembolso ? 'Reembolso' : m.estado === 'reembolsado' ? 'Cobro reembolsado' : 'Cobro'}{m.ticketNumber ? ` · Ticket ${m.ticketNumber}` : ''}</small>
              </span>
              <strong style={{ color: reembolso || m.estado === 'reembolsado' ? '#c0392b' : '#2e9e6b', textDecoration: m.estado === 'reembolsado' ? 'line-through' : 'none' }}>
                {reembolso ? '−' : '+'}{fmtCOP(m.monto)}
              </strong>
            </div>
          );
        })}
      </div>
    </UserModal>
  );
}
