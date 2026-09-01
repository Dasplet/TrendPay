'use client';

import Link from 'next/link';
import { useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Bell, BellRing, CreditCard, Download, Eye, EyeOff, QrCode, Send, Trash2, TrendingUp, Wallet, Building2, CheckCheck, X } from 'lucide-react';
import { useAuthStore } from '@/store/authStore';
import { notificationsApi, walletApi } from '@/lib/api';
import { EmptyState, StatusPill, UserAvatar, compactCOP, firstName, fmtCOP } from '@/components/user/UserTheme';
import { ThemeToggle } from '@/components/ThemeToggle';

const CHART_MONTHS = ['Ene', 'Feb', 'Mar', 'Abr', 'May', 'Jun'];

function monthlyPath(values: number[]) {
  const max = Math.max(...values, 1);
  const min = Math.min(...values, 0);
  const width = 100;
  const height = 44;
  const step = width / (values.length - 1);
  return values
    .map((value, index) => {
      const x = index * step;
      const y = height - ((value - min) / Math.max(max - min, 1)) * 34 - 5;
      return `${index === 0 ? 'M' : 'L'}${x.toFixed(1)},${y.toFixed(1)}`;
    })
    .join(' ');
}

export default function DashboardPage() {
  const user = useAuthStore((s) => s.user);
  const [showBalance, setShowBalance] = useState(true);
  const [notificationsOpen, setNotificationsOpen] = useState(false);
  const queryClient = useQueryClient();

  const { data: history } = useQuery({
    queryKey: ['wallet-history-home'],
    queryFn: () => walletApi.history({ limit: 5 }),
    select: (res) => res.data,
    retry: false,
  });



  const { data: notificationData } = useQuery({
    queryKey: ['user-notifications'],
    queryFn: () => notificationsApi.list(),
    select: (res) => res.data,
    enabled: !!user,
    retry: false,
  });

  const notifications = notificationData?.notificaciones || [];
  const unreadNotifications = Number(notificationData?.unread ?? notificationData?.noLeidas ?? notifications.filter((n: any) => !n.leida).length);

  const readAllNotifications = useMutation({
    mutationFn: () => notificationsApi.readAll(),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['user-notifications'] }),
  });

  const deleteNotification = useMutation({
    mutationFn: (id: string) => notificationsApi.delete(id),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['user-notifications'] }),
  });

  const clearNotifications = useMutation({
    mutationFn: () => notificationsApi.clear(),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['user-notifications'] }),
  });

  const txs = history?.transacciones || [];
  const received = txs.filter((t: any) => Number(t.monto_neto) > 0).reduce((s: number, t: any) => s + Number(t.monto_neto || 0), 0);
  const withdrawn = txs.filter((t: any) => Number(t.monto_neto) < 0).reduce((s: number, t: any) => s + Math.abs(Number(t.monto_neto || 0)), 0);

  const chart = useMemo(() => [120000, 180000, 95000, 310000, 210000, 285400], []);
  const path = monthlyPath(chart);

  const actions = [
    { label: 'Consignar', icon: <QrCode size={30} />, href: '/dashboard/consignar', tone: 'purple' },
    { label: 'Cobrar QR', icon: <QrCode size={30} />, href: '/dashboard/cobrar-qr', tone: 'green' },
    { label: 'Enviar', icon: <Send size={30} />, href: '/dashboard/enviar', tone: 'pink' },
    { label: 'Recargar', icon: <CreditCard size={30} />, href: '/dashboard/consignar', tone: 'green' },
    { label: 'Retirar', icon: <Building2 size={30} />, href: '/dashboard/retirar-banco', tone: 'red' },
  ];

  return (
    <div className="tp-user-page">
      <header className="tp-topbar">
        <div>
          <small>Bienvenido de nuevo</small>
          <h1>{firstName(user)}</h1>
        </div>
        <div className="tp-topbar-actions">
          <ThemeToggle className="tp-icon-button" iconSize={19} />
          <div className="tp-notification-wrap">
            <button
              aria-label="Notificaciones"
              className="tp-bell-button"
              onClick={() => {
                setNotificationsOpen((value) => !value);
                if (!notificationsOpen && unreadNotifications > 0) readAllNotifications.mutate();
              }}
            >
              {unreadNotifications > 0 ? <BellRing size={22} /> : <Bell size={22} />}
              {unreadNotifications > 0 && <span>{unreadNotifications > 9 ? '9+' : unreadNotifications}</span>}
            </button>

            {notificationsOpen && (
              <section className="tp-notifications-panel">
                <header>
                  <div>
                    <strong>Notificaciones</strong>
                    <small>{notifications.length} en total</small>
                  </div>
                  <button aria-label="Cerrar notificaciones" onClick={() => setNotificationsOpen(false)}><X size={17} /></button>
                </header>

                {notifications.length === 0 ? (
                  <div className="tp-notifications-empty">
                    <Bell size={28} />
                    <p>No tienes notificaciones</p>
                  </div>
                ) : (
                  <div className="tp-notifications-list">
                    {notifications.map((n: any) => (
                      <article key={n.id} className={`tp-notification-item ${n.leida ? '' : 'unread'}`}>
                        <div className="tp-notification-icon"><BellRing size={17} /></div>
                        <div>
                          <strong>{n.titulo || 'Notificación'}</strong>
                          <p>{n.mensaje || 'Actualización de TrendPay'}</p>
                          <small>{new Date(n.createdAt || n.created_at).toLocaleString('es-CO')}</small>
                        </div>
                        <button aria-label="Eliminar notificación" onClick={() => deleteNotification.mutate(n.id)}>
                          <Trash2 size={16} />
                        </button>
                      </article>
                    ))}
                  </div>
                )}

                {notifications.length > 0 && (
                  <footer>
                    <button onClick={() => readAllNotifications.mutate()}><CheckCheck size={16} /> Marcar leídas</button>
                    <button onClick={() => clearNotifications.mutate()}><Trash2 size={16} /> Eliminar todas</button>
                  </footer>
                )}
              </section>
            )}
          </div>
          <UserAvatar user={user} />
        </div>
      </header>

      <section className="tp-balance-card">
        <div>
          <span>Saldo disponible</span>
          <button onClick={() => setShowBalance((v) => !v)} className="tp-eye-button">
            {showBalance ? <EyeOff size={18} /> : <Eye size={18} />}
          </button>
        </div>
        <strong>{showBalance ? fmtCOP(user?.saldo) : '••••••'}</strong>
        <div className="tp-balance-footer">
          <StatusPill tone="success">Verificada</StatusPill>
          <span><TrendingUp size={16} /> +18% mes</span>
        </div>
      </section>

      <section className="tp-action-grid">
        {actions.map((a) => (
          <Link key={a.label} href={a.href} className={`tp-action-card tp-action-${a.tone}`}>
            <span>{a.icon}</span>
            <strong>{a.label}</strong>
          </Link>
        ))}
      </section>

      <section className="tp-stat-row">
        <article className="tp-stat-card">
          <span>Recibido</span>
          <strong className="tp-success">{fmtCOP(received)}</strong>
          <small>{txs.filter((t: any) => Number(t.monto_neto) > 0).length} movimientos</small>
        </article>
        <article className="tp-stat-card">
          <span>Retirado a bancos</span>
          <strong className="tp-danger">{fmtCOP(withdrawn)}</strong>
          <small>{txs.filter((t: any) => String(t.tipo || '').includes('RETIRO')).length} retiros</small>
        </article>
      </section>

      <section className="tp-chart-section">
        <div className="tp-section-title">
          <h2>Saldo mensual</h2>
          <button><Download size={18} /></button>
        </div>
        <div className="tp-chart-card">
          <svg viewBox="0 0 100 52" preserveAspectRatio="none">
            <defs>
              <linearGradient id="tpArea" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor="#852EC7" stopOpacity="0.45" />
                <stop offset="100%" stopColor="#852EC7" stopOpacity="0.02" />
              </linearGradient>
            </defs>
            <path d={`${path} L100,52 L0,52 Z`} fill="url(#tpArea)" />
            <path d={path} fill="none" stroke="#9b35e7" strokeWidth="1.3" vectorEffect="non-scaling-stroke" />
            {chart.map((value, index) => {
              const max = Math.max(...chart, 1);
              const min = Math.min(...chart, 0);
              const x = index * (100 / (chart.length - 1));
              const y = 44 - ((value - min) / Math.max(max - min, 1)) * 34 + 3;
              return <circle key={CHART_MONTHS[index]} cx={x} cy={y} r="1.1" fill="#9b35e7" />;
            })}
          </svg>
          <div className="tp-chart-labels">
            {CHART_MONTHS.map((month) => <span key={month}>{month}</span>)}
          </div>
        </div>
      </section>

      <section className="tp-recent-section">
        <div className="tp-section-title">
          <h2>Últimos movimientos</h2>
          <Link href="/dashboard/historial">Ver todo</Link>
        </div>
        {txs.length === 0 ? (
          <EmptyState />
        ) : (
          <div className="tp-transaction-list">
            {txs.slice(0, 5).map((t: any) => (
              <article key={t.id} className="tp-transaction-item">
                <span className={Number(t.monto_neto) > 0 ? 'income' : 'expense'}>
                  {Number(t.monto_neto) > 0 ? <Wallet size={18} /> : <Send size={18} />}
                </span>
                <div>
                  <strong>{t.descripcion || 'Movimiento TrendPay'}</strong>
                  <small>{new Date(t.created_at).toLocaleDateString('es-CO')}</small>
                </div>
                <b className={Number(t.monto_neto) > 0 ? 'tp-success' : 'tp-danger'}>{Number(t.monto_neto) > 0 ? '+' : '-'}{compactCOP(Math.abs(Number(t.monto_neto || 0)))}</b>
              </article>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
