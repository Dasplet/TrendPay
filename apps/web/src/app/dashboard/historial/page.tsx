'use client';

import { useMemo, useState } from 'react';
import { Download, History } from 'lucide-react';
import { useQuery } from '@tanstack/react-query';
import { walletApi } from '@/lib/api';
import { EmptyState, fmtCOP } from '@/components/user/UserTheme';
import { Panel, PanelHeader, StatusBadge, Table, Td, Tr, Btn, fmtDate } from '@/components/admin/ui';
import { downloadCsv } from '@/lib/exportCsv';

// Mismas pestañas de filtro que las transacciones del panel de administración. `clave` es lo que debe contener el tipo del movimiento.
const FILTROS = [
  { etiqueta: 'Todas', clave: '' },
  { etiqueta: 'Datáfono', clave: 'datafono' },
  { etiqueta: 'Página web', clave: 'web' },
  { etiqueta: 'Cobro QR', clave: 'cobro' },
  { etiqueta: 'Retiro', clave: 'retiro' },
  { etiqueta: 'Consigna', clave: 'consign' },
  { etiqueta: 'Envío', clave: 'envi' },
] as const;

export default function HistorialPage() {
  const [filtro, setFiltro] = useState<string>('Todas');
  const [busqueda, setBusqueda] = useState('');

  const { data, isLoading } = useQuery({
    queryKey: ['wallet-history-full'],
    queryFn: () => walletApi.history({ limit: 100 }),
    select: (res) => res.data,
    retry: false,
  });

  const todos: any[] = data?.transacciones || [];
  const tipoDe = (tx: any) => String(tx.tipo || '').toLowerCase();
  // Una pestaña solo aparece si hay movimientos de ese tipo (las consignaciones y los envíos viejos no estorban si no existen)
  const filtros = FILTROS.filter((f) => !f.clave || todos.some((tx) => tipoDe(tx).includes(f.clave)));
  const clave = FILTROS.find((f) => f.etiqueta === filtro)?.clave ?? '';

  const txs = useMemo(() => todos.filter((tx) => {
    if (clave && !tipoDe(tx).includes(clave)) return false;
    const texto = `${tx.descripcion || ''} ${tx.codigo || ''}`.toLowerCase();
    return !busqueda || texto.includes(busqueda.toLowerCase());
  }), [todos, clave, busqueda]);

  const recibido = txs.filter((t) => Number(t.monto_neto) > 0).reduce((s, t) => s + Number(t.monto_neto || 0), 0);
  // "Retirado a bancos" cuenta solo los retiros (no envíos ni reembolsos de datáfono)
  const retirado = txs.filter((t) => Number(t.monto_neto) < 0 && tipoDe(t).includes('retiro')).reduce((s, t) => s + Math.abs(Number(t.monto_neto || 0)), 0);

  function exportarCsv() {
    downloadCsv('historial', ['Referencia', 'Descripción', 'Monto', 'Estado', 'Fecha'],
      txs.map((t) => [t.codigo || '', t.descripcion || '', t.monto_neto || 0, t.estado || '', fmtDate(t.created_at)]));
  }

  return (
    <div className="tp-user-page">
      <div className="tp-kpis">
        <div className="tp-kpi"><span>Recibido</span><strong className="tp-success">{fmtCOP(recibido)}</strong><small>En los movimientos que se ven abajo</small></div>
        <div className="tp-kpi"><span>Retirado a bancos</span><strong className="tp-danger">{fmtCOP(retirado)}</strong><small>Solo retiros</small></div>
      </div>

      <Panel>
        <PanelHeader
          title={`${txs.length} movimientos`}
          icon={<History size={16} />}
          actions={
            <>
              <input
                value={busqueda}
                onChange={(e) => setBusqueda(e.target.value)}
                placeholder="Buscar..."
                style={{ background: 'rgba(var(--adm-card-rgb),.6)', border: '1px solid rgba(133,46,199,.2)', borderRadius: 8, padding: '6px 12px', fontSize: 12, color: 'var(--adm-text)', outline: 'none', width: 180 }}
              />
              <Btn variant="ghost" onClick={exportarCsv} disabled={txs.length === 0}><Download size={13} /> CSV</Btn>
            </>
          }
        />

        {/* Pestañas de filtro */}
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, padding: '12px 16px', borderBottom: '1px solid rgba(133,46,199,.12)' }}>
          {filtros.map((f) => {
            const activo = filtro === f.etiqueta;
            return (
              <button
                key={f.etiqueta}
                onClick={() => setFiltro(f.etiqueta)}
                style={{
                  padding: '6px 14px', borderRadius: 8, fontSize: 12, fontWeight: 600, cursor: 'pointer', transition: 'all .15s',
                  border: activo ? '1px solid #852EC7' : '1px solid rgba(var(--adm-fg-rgb),.1)',
                  background: activo ? 'rgba(133,46,199,.2)' : 'transparent',
                  color: activo ? 'var(--adm-text)' : 'rgba(var(--adm-fg-rgb),.5)',
                }}
              >
                {f.etiqueta}
              </button>
            );
          })}
        </div>

        {isLoading ? (
          <p className="tp-empty">Cargando…</p>
        ) : txs.length === 0 ? (
          <EmptyState />
        ) : (
          <Table headers={['Referencia', 'Descripción', 'Estado', 'Monto', 'Fecha']}>
            {txs.map((tx) => {
              const entra = Number(tx.monto_neto) > 0;
              return (
                <Tr key={tx.id}>
                  <Td style={{ fontFamily: 'monospace', fontSize: 11, color: 'rgba(var(--adm-fg-rgb),.4)' }}>{(tx.codigo || '—').slice(0, 16)}</Td>
                  <Td style={{ fontSize: 12, maxWidth: 320, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{tx.descripcion || 'Movimiento TrendPay'}</Td>
                  <Td><StatusBadge status={tx.estado || 'exitosa'} /></Td>
                  <Td style={{ fontWeight: 700, whiteSpace: 'nowrap', color: entra ? '#6CC998' : '#C0392B' }}>
                    {entra ? '+' : '-'}{fmtCOP(Math.abs(Number(tx.monto_neto || 0)))}
                  </Td>
                  <Td style={{ fontSize: 11, color: 'rgba(var(--adm-fg-rgb),.4)', whiteSpace: 'nowrap' }}>{fmtDate(tx.created_at)}</Td>
                </Tr>
              );
            })}
          </Table>
        )}
      </Panel>
    </div>
  );
}
