'use client';

import { useMemo, useState } from 'react';
import { Download, Search } from 'lucide-react';
import { useQuery } from '@tanstack/react-query';
import { walletApi } from '@/lib/api';
import { EmptyState, compactCOP, fmtCOP } from '@/components/user/UserTheme';

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

  const txs = data?.transacciones || [];
  const filtered = useMemo(() => txs.filter((tx: any) => {
    const text = `${tx.descripcion || ''} ${tx.codigo || ''} ${tx.tipo || ''}`.toLowerCase();
    const matchesText = !query || text.includes(query.toLowerCase());
    const matchesEstado = !estado || String(tx.estado || '').toLowerCase() === estado.toLowerCase();
    const matchesTipo = !tipo || String(tx.tipo || '').toLowerCase().includes(tipo.toLowerCase());
    return matchesText && matchesEstado && matchesTipo;
  }), [txs, query, estado, tipo]);

  const recibido = filtered.filter((t: any) => Number(t.monto_neto) > 0).reduce((s: number, t: any) => s + Number(t.monto_neto || 0), 0);
  const retirado = filtered.filter((t: any) => Number(t.monto_neto) < 0).reduce((s: number, t: any) => s + Math.abs(Number(t.monto_neto || 0)), 0);

  return (
    <div className="tp-user-page">
      <header className="tp-page-header">
        <h1>Historial</h1>
        <button className="tp-icon-button"><Download size={22} /></button>
      </header>

      <section className="tp-stat-row">
        <article className="tp-stat-card"><span>Recibido</span><strong className="tp-success">{fmtCOP(recibido)}</strong></article>
        <article className="tp-stat-card"><span>Retirado a bancos</span><strong className="tp-danger">{fmtCOP(retirado)}</strong></article>
      </section>

      <section className="tp-filter-card">
        <label className="tp-search-box">
          <Search size={20} />
          <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Buscar por nombre, banco, monto o código" />
        </label>
        <div className="tp-filter-row">
          <select value={tipo} onChange={(e) => setTipo(e.target.value)}>
            <option value="">Todas las operaciones</option>
            <option value="consignacion">Consignaciones</option>
            <option value="qr">Cobros QR</option>
            <option value="envio">Envíos</option>
            <option value="retiro">Retiros banco</option>
          </select>
          <select value={estado} onChange={(e) => setEstado(e.target.value)}>
            <option value="">Todos los estados</option>
            <option value="completada">Completada</option>
            <option value="pendiente">Pendiente</option>
            <option value="rechazada">Rechazada</option>
          </select>
        </div>
        <p>{filtered.length} movimientos encontrados</p>
        <button className="tp-clear-link" onClick={() => { setQuery(''); setTipo(''); setEstado(''); }}>Limpiar filtros</button>
      </section>

      <div className="tp-tab-row">
        {['Todo', 'Consignaciones', 'Cobros QR', 'Envíos', 'Retiros banco'].map((tab) => <button key={tab}>{tab}</button>)}
      </div>

      {filtered.length === 0 ? <EmptyState /> : (
        <section className="tp-transaction-list">
          {filtered.map((tx: any) => (
            <article key={tx.id} className="tp-transaction-item">
              <span className={Number(tx.monto_neto) > 0 ? 'income' : 'expense'}>{Number(tx.monto_neto) > 0 ? '+' : '-'}</span>
              <div>
                <strong>{tx.descripcion || 'Movimiento TrendPay'}</strong>
                <small>{new Date(tx.created_at).toLocaleString('es-CO')} · {tx.estado || 'completada'}</small>
              </div>
              <b className={Number(tx.monto_neto) > 0 ? 'tp-success' : 'tp-danger'}>{Number(tx.monto_neto) > 0 ? '+' : '-'}{compactCOP(Math.abs(Number(tx.monto_neto || 0)))}</b>
            </article>
          ))}
        </section>
      )}
    </div>
  );
}
