'use client';

import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { BarChart3, Building2, Eye, EyeOff, History, QrCode, ShieldCheck, TrendingUp } from 'lucide-react';
import Link from 'next/link';
import { useAuthStore } from '@/store/authStore';
import { walletApi } from '@/lib/api';
import { EmptyState, fmtCOP } from '@/components/user/UserTheme';
import { Panel, Table, Tr, Td, fmtDate } from '@/components/admin/ui';
import { LinkPill, PanelTitle } from '@/components/admin/dash';
import { puede, type Permiso } from '@/lib/permisos';

// Puntos de la gráfica (coordenadas del viewBox 100×52). La línea, el área y los puntos usan los mismos.
function chartPoints(values: number[]) {
  const max = Math.max(...values, 1);
  const min = Math.min(...values, 0);
  const step = values.length > 1 ? 100 / (values.length - 1) : 0;
  return values.map((value, index) => ({
    x: index * step,
    y: 39 - ((value - min) / Math.max(max - min, 1)) * 34,
  }));
}

export default function DashboardPage() {
  const user = useAuthStore((s) => s.user);
  const [showBalance, setShowBalance] = useState(true);
  const verSaldo = puede(user, 'verSaldo');

  const { data: mensual } = useQuery({
    queryKey: ['wallet-saldo-mensual', user?.id],
    queryFn: () => walletApi.saldoMensual(6),
    select: (res) => res.data,
    enabled: !!user && verSaldo,
    refetchInterval: 30_000,
    refetchOnWindowFocus: true,
    retry: false,
  });

  const { data: history } = useQuery({
    queryKey: ['wallet-history-home'],
    queryFn: () => walletApi.history({ limit: 6 }),
    select: (res) => res.data,
    retry: false,
  });

  const txs: any[] = history?.transacciones || [];

  // Totales y gráfica reales del mes (se refrescan solos cada 30 s y al volver a la pestaña).
  const mesActual = mensual?.mesActual;
  const received = Number(mesActual?.recibido ?? 0);
  const withdrawn = Number(mesActual?.retirado ?? 0);

  const meses: { clave: string; etiqueta: string; saldo: number }[] = mensual?.meses || [];
  const chart = useMemo(() => meses.map((m) => Number(m.saldo)), [meses]);
  const points = useMemo(() => chartPoints(chart), [chart]);
  const path = points.map((p, i) => `${i === 0 ? 'M' : 'L'}${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(' ');
  const variacion: number | null = typeof mensual?.variacionPct === 'number' ? mensual.variacionPct : null;

  const allActions: { label: string; icon: React.ReactNode; href: string; tone: string; permiso?: Permiso }[] = [
    { label: 'Mis ventas', icon: <BarChart3 size={18} />, href: '/dashboard/ventas', tone: 'purple', permiso: 'recargar' },
    { label: 'Cobrar QR', icon: <QrCode size={18} />, href: '/dashboard/cobrar-qr', tone: 'green', permiso: 'recargar' },
    { label: 'Retirar', icon: <Building2 size={18} />, href: '/dashboard/retirar-banco', tone: 'red', permiso: 'retirar' },
    { label: 'Historial', icon: <History size={18} />, href: '/dashboard/historial', tone: 'pink' },
    { label: 'Mis bancos', icon: <Building2 size={18} />, href: '/dashboard/bancos', tone: 'pink', permiso: 'retirar' },
    { label: 'Seguridad', icon: <ShieldCheck size={18} />, href: '/dashboard/seguridad', tone: 'purple' },
  ];
  const actions = allActions.filter((a) => (!a.permiso || puede(user, a.permiso)) && !(a.href === '/dashboard/seguridad' && user?.cuentaPadre));

  return (
    <div className="tp-user-page">
      {/* Cifras */}
      <div className="tp-kpis">
        <div className="tp-kpi">
          <span>
            {user?.cuentaPadre ? `Saldo de ${user.cuentaPadre.nombre}` : 'Saldo disponible'}
            {verSaldo && (
              <button onClick={() => setShowBalance((v) => !v)} className="tp-eye-button" aria-label={showBalance ? 'Ocultar saldo' : 'Mostrar saldo'}>
                {showBalance ? <EyeOff size={14} /> : <Eye size={14} />}
              </button>
            )}
          </span>
          <strong>{verSaldo && showBalance ? fmtCOP(user?.saldo) : '••••••'}</strong>
          <small className={variacion !== null && variacion < 0 ? 'tp-danger' : undefined}>
            {!verSaldo
              ? 'Esta cuenta no tiene permiso para ver el saldo'
              : variacion !== null
                ? <><TrendingUp size={12} style={{ verticalAlign: '-2px' }} /> {variacion > 0 ? '+' : ''}{variacion.toLocaleString('es-CO')}% frente al mes pasado</>
                : 'Disponible ahora'}
          </small>
        </div>
        <div className="tp-kpi">
          <span>Recibido este mes</span>
          <strong className="tp-success">{verSaldo ? fmtCOP(received) : '••••••'}</strong>
          <small>{verSaldo ? `${mesActual?.movimientos ?? 0} movimientos en el mes` : 'Sin permiso para ver saldos'}</small>
        </div>
        <div className="tp-kpi">
          <span>Retirado este mes</span>
          <strong className="tp-danger">{verSaldo ? fmtCOP(withdrawn) : '••••••'}</strong>
          <small>{verSaldo ? 'Retiros a bancos' : 'Sin permiso para ver saldos'}</small>
        </div>
      </div>

      {/* Accesos */}
      <Panel>
        <PanelTitle title="Accesos" sub="Lo que puedes hacer con esta cuenta" />
        <div className="tp-action-grid">
          {actions.map((a) => (
            <Link key={a.label} href={a.href} className={`tp-action-card tp-action-${a.tone}`}>
              <span>{a.icon}</span>
              <strong>{a.label}</strong>
            </Link>
          ))}
        </div>
      </Panel>

      <div className="tp-grid">
        {/* Gráfica */}
        <Panel style={{ minWidth: 0 }}>
          <PanelTitle title="Saldo mensual" sub="Cómo ha cambiado el saldo de la cuenta en los últimos meses" />
          <div className="tp-chart-card" style={{ padding: '14px 20px 18px' }}>
            {!verSaldo ? (
              <p className="tp-empty">Esta cuenta no tiene permiso para ver el saldo</p>
            ) : meses.length === 0 ? (
              <p className="tp-empty">Cargando…</p>
            ) : (
              <>
                <svg viewBox="0 0 100 52" preserveAspectRatio="none" style={{ overflow: 'visible' }}>
                  <defs>
                    <linearGradient id="tpArea" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" stopColor="#852EC7" stopOpacity="0.45" />
                      <stop offset="100%" stopColor="#852EC7" stopOpacity="0.02" />
                    </linearGradient>
                  </defs>
                  <path d={`${path} L100,52 L0,52 Z`} fill="url(#tpArea)" />
                  <path d={path} fill="none" stroke="#b36bf0" strokeWidth="1.6" vectorEffect="non-scaling-stroke" />
                  {points.map((p, index) => (
                    <path key={meses[index].clave} d={`M${p.x.toFixed(1)},${p.y.toFixed(1)} h0.001`} stroke="#b36bf0" strokeWidth="6" strokeLinecap="round" vectorEffect="non-scaling-stroke">
                      <title>{`${meses[index].etiqueta}: ${fmtCOP(meses[index].saldo)}`}</title>
                    </path>
                  ))}
                </svg>
                <div className="tp-chart-labels">
                  {meses.map((m) => <span key={m.clave}>{m.etiqueta}</span>)}
                </div>
              </>
            )}
          </div>
        </Panel>

        {/* Últimos movimientos */}
        <Panel style={{ minWidth: 0 }}>
          <PanelTitle title="Últimos movimientos" sub="Lo más reciente de tu cuenta" action={<LinkPill href="/dashboard/historial">Ver todo →</LinkPill>} />
          <div style={{ paddingTop: 8 }}>
            {txs.length === 0 ? (
              <EmptyState />
            ) : (
              <Table headers={['Descripción', 'Fecha', 'Monto']}>
                {txs.slice(0, 6).map((t) => {
                  const entra = Number(t.monto_neto) > 0;
                  return (
                    <Tr key={t.id}>
                      <Td style={{ fontSize: 13, maxWidth: 320, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{t.descripcion || 'Movimiento TrendPay'}</Td>
                      <Td style={{ fontSize: 11, color: 'rgba(var(--adm-fg-rgb),.45)', whiteSpace: 'nowrap' }}>{fmtDate(t.created_at)}</Td>
                      <Td style={{ fontWeight: 700, whiteSpace: 'nowrap', color: entra ? 'var(--tp-success)' : 'var(--tp-danger)' }}>
                        {entra ? '+' : '-'}{fmtCOP(Math.abs(Number(t.monto_neto || 0)))}
                      </Td>
                    </Tr>
                  );
                })}
              </Table>
            )}
          </div>
        </Panel>
      </div>
    </div>
  );
}
