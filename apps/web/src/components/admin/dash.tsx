'use client';

import type { ReactNode } from 'react';
import Link from 'next/link';

// Piezas visuales del dashboard admin: tarjetas KPI con anillo, filas con
// barra de progreso y alertas. Todos los colores salen de las variables
// --adm-* para que funcionen igual en tema claro y oscuro.

export const ACCENT = '#852EC7';
export const ACCENT_L = '#b36bf0';
export const GREEN = '#6CC998';
export const BLUE = '#4a90d9';
export const RED = '#E5484D';
export const AMBER = '#d4a017';

export function clamp(n: number, min = 0, max = 100) {
  return Math.min(max, Math.max(min, Number.isFinite(n) ? n : 0));
}

// ── Anillo de progreso ──
export function Ring({ pct, color, label, size = 72 }: Readonly<{ pct: number; color: string; label: string; size?: number }>) {
  const r = 18;
  const c = 2 * Math.PI * r;
  const p = clamp(pct);
  return (
    <div style={{ position: 'relative', width: size, height: size, flexShrink: 0 }}>
      <svg viewBox="0 0 44 44" width={size} height={size} style={{ transform: 'rotate(-90deg)' }} aria-hidden="true">
        <circle cx="22" cy="22" r={r} fill="none" stroke="rgba(var(--adm-fg-rgb),.09)" strokeWidth="5" />
        <circle cx="22" cy="22" r={r} fill="none" stroke={color} strokeWidth="5" strokeLinecap="round"
          strokeDasharray={`${(p / 100) * c} ${c}`} style={{ transition: 'stroke-dasharray .6s ease' }} />
      </svg>
      <div style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: size * 0.2, fontWeight: 800, color: 'var(--adm-text)' }}>
        {label}
      </div>
    </div>
  );
}

// ── Tarjeta KPI con anillo ──
export function KpiRing({ title, value, ringPct, ringLabel, color, sub, subColor }: Readonly<{
  title: string; value: string; ringPct: number; ringLabel: string; color: string; sub: string; subColor?: string;
}>) {
  return (
    <div style={{ background: 'var(--adm-panel)', border: '1px solid rgba(133,46,199,.18)', borderRadius: 16, padding: '18px 20px' }}>
      <div style={{ fontSize: 11, fontWeight: 800, letterSpacing: '.8px', textTransform: 'uppercase', color: 'var(--adm-muted)', marginBottom: 12 }}>{title}</div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
        <Ring pct={ringPct} color={color} label={ringLabel} />
        <div style={{ minWidth: 0 }}>
          <div style={{ fontSize: 26, fontWeight: 900, color: 'var(--adm-text)', letterSpacing: '-.5px', lineHeight: 1.1, whiteSpace: 'nowrap' }}>{value}</div>
          <div style={{ fontSize: 12, fontWeight: 600, color: subColor || 'var(--adm-muted)', marginTop: 4 }}>{sub}</div>
        </div>
      </div>
    </div>
  );
}

// ── Fila con barra de progreso (embudo / comparación de canales) ──
export function BarRow({ label, value, pct, color, sub }: Readonly<{ label: string; value: string; pct: number; color: string; sub?: string }>) {
  return (
    <div style={{ marginBottom: 14 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: 10, fontSize: 13, marginBottom: 6 }}>
        <span style={{ color: 'var(--adm-text)', fontWeight: 600 }}>{label}</span>
        <span style={{ color, fontWeight: 800 }}>{value}</span>
      </div>
      <div style={{ height: 7, background: 'rgba(var(--adm-fg-rgb),.08)', borderRadius: 4, overflow: 'hidden' }}>
        <div style={{ height: '100%', width: `${clamp(pct)}%`, background: color, borderRadius: 4, transition: 'width .6s ease' }} />
      </div>
      {sub && <div style={{ fontSize: 11, color: 'var(--adm-muted)', marginTop: 5 }}>{sub}</div>}
    </div>
  );
}

// ── Encabezado de panel con subtítulo ──
export function PanelTitle({ title, sub, action }: Readonly<{ title: string; sub?: string; action?: ReactNode }>) {
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 12, padding: '18px 20px 6px' }}>
      <div>
        <div style={{ fontSize: 13, fontWeight: 800, letterSpacing: '.6px', textTransform: 'uppercase', color: 'var(--adm-text)' }}>{title}</div>
        {sub && <div style={{ fontSize: 12, color: 'var(--adm-muted)', marginTop: 3 }}>{sub}</div>}
      </div>
      {action}
    </div>
  );
}

export function LinkPill({ href, children }: Readonly<{ href: string; children: ReactNode }>) {
  return (
    <Link href={href} style={{ fontSize: 12, fontWeight: 700, color: ACCENT_L, textDecoration: 'none', whiteSpace: 'nowrap' }}>
      {children}
    </Link>
  );
}

// ── Alertas ──
export type NivelAlerta = 'warn' | 'info' | 'ok' | 'danger';
const NIVELES: Record<NivelAlerta, { color: string; bg: string; icon: string }> = {
  warn: { color: AMBER, bg: 'rgba(212,160,23,.14)', icon: '!' },
  danger: { color: RED, bg: 'rgba(229,72,77,.14)', icon: '!' },
  info: { color: BLUE, bg: 'rgba(74,144,217,.14)', icon: 'i' },
  ok: { color: GREEN, bg: 'rgba(108,201,152,.14)', icon: '✓' },
};

export function AlertItem({ nivel, titulo, detalle, href }: Readonly<{ nivel: NivelAlerta; titulo: string; detalle: string; href?: string }>) {
  const n = NIVELES[nivel];
  const body = (
    <div style={{ display: 'flex', gap: 12, padding: '12px 0', borderBottom: '1px solid rgba(var(--adm-fg-rgb),.06)' }}>
      <div style={{ width: 30, height: 30, borderRadius: '50%', background: n.bg, color: n.color, display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: 900, fontSize: 14, flexShrink: 0 }}>{n.icon}</div>
      <div style={{ minWidth: 0 }}>
        <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--adm-text)' }}>{titulo}</div>
        <div style={{ fontSize: 12, color: 'var(--adm-muted)', marginTop: 2, lineHeight: 1.4 }}>{detalle}</div>
      </div>
    </div>
  );
  return href ? <Link href={href} style={{ textDecoration: 'none', display: 'block' }}>{body}</Link> : body;
}

// ── Franja inferior de cifras ──
export function StatStrip({ items }: Readonly<{ items: Array<{ label: string; value: string; color?: string }> }>) {
  return (
    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(190px, 1fr))', background: 'var(--adm-panel)', border: '1px solid rgba(133,46,199,.18)', borderRadius: 16 }}>
      {items.map((it, i) => (
        <div key={it.label} style={{ padding: '16px 22px', borderLeft: i ? '1px solid rgba(var(--adm-fg-rgb),.07)' : 'none' }}>
          <div style={{ fontSize: 10.5, fontWeight: 800, letterSpacing: '.8px', textTransform: 'uppercase', color: 'var(--adm-muted)', marginBottom: 6 }}>{it.label}</div>
          <div style={{ fontSize: 16, fontWeight: 800, color: it.color || 'var(--adm-text)' }}>{it.value}</div>
        </div>
      ))}
    </div>
  );
}
