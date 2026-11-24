'use client';

import { useMemo, useState } from 'react';
import { Search } from 'lucide-react';
import { useQuery } from '@tanstack/react-query';
import { walletApi } from '@/lib/api';
import { EmptyState, fmtCOP } from '@/components/user/UserTheme';
import { Panel, StatusBadge, Table, Td, Tr, Btn, fmtDate } from '@/components/admin/ui';

export default function HistorialPage() {
  const [query, setQuery] = useState('');
  const [estado, setEstado] = useState('');
  const [tipo, setTipo] = useState('');

  const { data } = useQuery({
    queryKey: ['wallet-history-full'],
    queryFn: () => walletApi.history({ limit: 100 }),
    select: (res) => res.data,
    retry: false,
  });

  const txs: any[] = data?.transacciones || [];
  const filtered = useMemo(() => txs.filter((tx) => {
    const text = `${tx.descripcion || ''} ${tx.codigo || ''} ${tx.tipo || ''}`.toLowerCase();
    const matchesText = !query || text.includes(query.toLowerCase());
    const matchesEstado = !estado || String(tx.estado || '').toLowerCase() === estado.toLowerCase();
    const matchesTipo = !tipo || String(tx.tipo || '').toLowerCase().includes(tipo.toLowerCase());
    return matchesText && matchesEstado && matchesTipo;
  }), [txs, query, estado, tipo]);

  const recibido = filtered.filter((t) => Number(t.monto_neto) > 0).reduce((s, t) => s + Number(t.monto_neto || 0), 0);
  // "Retirado a bancos" cuenta solo los retiros (no envíos ni reembolsos de datáfono)
  const retirado = filtered.filter((t) => Number(t.monto_neto) < 0 && String(t.tipo || '').toLowerCase().includes('retiro')).reduce((s, t) => s + Math.abs(Number(t.monto_neto || 0)), 0);
  const hayFiltros = !!(query || tipo || estado);

  return (
    <div className="tp-user-page">
      <div className="tp-kpis">
        <div className="tp-kpi"><span>Recibido</span><strong className="tp-success">{fmtCOP(recibido)}</strong><small>En los movimientos que se ven abajo</small></div>
        <div className="tp-kpi"><span>Retirado a bancos</span><strong className="tp-danger">{fmtCOP(retirado)}</strong><small>Solo retiros</small></div>
      </div>

      <Panel>
        <div className="tp-filter-card">
          <label className="tp-search-box">
            <Search size={14} />
            <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Buscar por descripción o código" />
          </label>
          <select value={tipo} onChange={(e) => setTipo(e.target.value)} style={{ width: 220 }}>
            <option value="">Todas las operaciones</option>
            <option value="qr">Cobros QR</option>
            <option value="retiro">Retiros banco</option>
            <option value="datafono">Datáfono (cobros y reembolsos)</option>
            <option value="web">Página web (pagos y reembolsos)</option>
            <option value="consigna">Consignaciones</option>
            <option value="envio">Envíos</option>
          </select>
          <select value={estado} onChange={(e) => setEstado(e.target.value)} style={{ width: 180 }}>
            <option value="">Todos los estados</option>
            <option value="exitosa">Exitosa</option>
            <option value="pendiente">Pendiente</option>
            <option value="rechazada">Rechazada</option>
          </select>
          <span className="tp-filter-count">{filtered.length} movimientos</span>
          {hayFiltros && <Btn variant="ghost" onClick={() => { setQuery(''); setTipo(''); setEstado(''); }}>Limpiar filtros</Btn>}
        </div>

        {filtered.length === 0 ? <EmptyState /> : (
          <Table headers={['Descripción', 'Código', 'Fecha', 'Estado', 'Monto']}>
            {filtered.map((tx) => {
              const entra = Number(tx.monto_neto) > 0;
              return (
                <Tr key={tx.id}>
                  <Td style={{ fontSize: 13, maxWidth: 340, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{tx.descripcion || 'Movimiento TrendPay'}</Td>
                  <Td style={{ fontFamily: 'monospace', fontSize: 11, color: 'rgba(var(--adm-fg-rgb),.4)' }}>{(tx.codigo || '—').slice(0, 16)}</Td>
                  <Td style={{ fontSize: 11, color: 'rgba(var(--adm-fg-rgb),.45)', whiteSpace: 'nowrap' }}>{fmtDate(tx.created_at)}</Td>
                  <Td><StatusBadge status={tx.estado || 'exitosa'} /></Td>
                  <Td style={{ fontWeight: 700, whiteSpace: 'nowrap', color: entra ? 'var(--tp-success)' : 'var(--tp-danger)' }}>
                    {entra ? '+' : '-'}{fmtCOP(Math.abs(Number(tx.monto_neto || 0)))}
                  </Td>
                </Tr>
              );
            })}
          </Table>
        )}
      </Panel>
    </div>
  );
}
