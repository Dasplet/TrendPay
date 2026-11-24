'use client';

import { useQuery } from '@tanstack/react-query';
import { datafonosApi } from '@/lib/api';
import { EmptyState, UserModal, fmtCOP } from '@/components/user/UserTheme';
import { ResumenVentas } from '@/components/datafonos/ResumenVentas';

interface Movimiento {
  id: string; estado: string; monto: number; neto?: number; terminal: string; tipo: 'cobro' | 'reembolso'; creado: string;
  ticketNumber: string | null; canal?: 'datafono' | 'web';
}

// Todo lo que entra por ventas: los cobros que se digitan en el datáfono y los pagos en línea de la página web. TrendPay no cobra
// ni reembolsa desde aquí: cada venta y cada devolución llega desde Kushki y se refleja en el saldo y en los movimientos, en vivo.
// La cuenta principal ve todas sus tiendas; una tienda solo ve las suyas.
export default function MisVentasPage() {
  const { data, isLoading } = useQuery({
    queryKey: ['datafonos-cobros'],
    queryFn: () => datafonosApi.cobros().then((r) => r.data.cobros as Movimiento[]),
    refetchInterval: 30_000,
  });
  const movimientos = (data ?? []).filter((m) => m.estado === 'aprobado' || m.estado === 'reembolsado');

  return (
    <UserModal title="Mis ventas" subtitle="Datáfonos y página web, en vivo" size="lg">
      <div className="tp-modal-content">
        <p className="tp-modal-label">Resumen</p>
        <ResumenVentas />
        <hr className="tp-divider" />

        <p className="tp-modal-label">Últimos movimientos</p>
        {isLoading && <p>Cargando…</p>}
        {!isLoading && movimientos.length === 0 && <EmptyState title="Todavía no hay ventas" />}
        {movimientos.map((m) => {
          const reembolso = m.tipo === 'reembolso';
          const web = m.canal === 'web';
          return (
            <div key={m.id} style={{ display: 'flex', justifyContent: 'space-between', gap: 8, padding: '8px 0', fontSize: 14, borderBottom: '1px solid rgba(128,128,128,.15)' }}>
              <span>
                {new Date(m.creado).toLocaleString('es-CO', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' })} · {m.terminal}
                <small style={{ display: 'block', opacity: 0.65 }}>
                  {web ? 'Pago web' : 'Datáfono'} · {reembolso ? 'Reembolso' : m.estado === 'reembolsado' ? 'Reembolsado' : 'Venta'}{m.ticketNumber ? ` · Ticket ${m.ticketNumber}` : ''}
                </small>
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
