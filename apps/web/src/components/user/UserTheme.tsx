'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import QRCode from 'qrcode';
import {
  ArrowRight,
  Banknote,
  Building2,
  Camera,
  Check,
  ChevronRight,
  CreditCard,
  Download,
  Eye,
  EyeOff,
  History,
  Home,
  Lock,
  LogOut,
  Mail,
  QrCode,
  Search,
  Send,
  ShieldCheck,
  Smartphone,
  Users,
  Wallet,
  X,
} from 'lucide-react';
import type { ReactNode } from 'react';
import { useAuthStore, type User } from '@/store/authStore';
import { banksApi } from '@/lib/api';

export function fmtCOP(value?: number | string | null) {
  const n = Number(value || 0);
  return new Intl.NumberFormat('es-CO', {
    style: 'currency',
    currency: 'COP',
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  }).format(Number.isFinite(n) ? n : 0);
}

export function compactCOP(value?: number | string | null) {
  return fmtCOP(value).replace('COP', '').trim();
}

export function firstName(user?: User | null) {
  return user?.nombre?.split(' ')?.[0] || 'Usuario';
}

export function initials(user?: User | null) {
  const name = user?.nombre || 'Usuario Demo';
  return name
    .split(' ')
    .filter(Boolean)
    .slice(0, 2)
    .map((word) => word[0])
    .join('')
    .toUpperCase();
}

export function maskPhone(phone?: string | null) {
  const clean = String(phone || '3001234567').replace(/\D/g, '');
  if (clean.length < 4) return '300****678';
  return `${clean.slice(0, 3)}****${clean.slice(-2)}`;
}

export function BrandLogo({ compact = false }: { compact?: boolean }) {
  return (
    <div className="tp-logo" aria-label="TrendLab">
      <span className="tp-logo-bars" aria-hidden="true">
        <i />
        <i />
        <i />
      </span>
      {!compact && <strong>TrendLab.</strong>}
    </div>
  );
}

export function UserAvatar({ user, size = 'md' }: { user?: User | null; size?: 'sm' | 'md' | 'lg' }) {
  const avatar = user?.avatarDataUrl;
  return (
    <div className={`tp-avatar tp-avatar-${size} ${avatar ? 'has-image' : ''}`}>
      {avatar ? <img src={avatar} alt={user?.nombre ? `Foto de ${user.nombre}` : 'Foto de perfil'} /> : initials(user)}
    </div>
  );
}

export function StatusPill({ children, tone = 'success' }: { children: ReactNode; tone?: 'success' | 'purple' | 'danger' | 'muted' }) {
  return <span className={`tp-pill tp-pill-${tone}`}>{children}</span>;
}

export function ThemeButton({
  children,
  disabled,
  onClick,
  href,
  tone = 'primary',
  type = 'button',
}: {
  children: ReactNode;
  disabled?: boolean;
  onClick?: () => void;
  href?: string;
  tone?: 'primary' | 'secondary' | 'danger' | 'ghost';
  type?: 'button' | 'submit';
}) {
  const className = `tp-button tp-button-${tone}`;
  if (href) {
    return (
      <Link className={className} href={href} aria-disabled={disabled}>
        {children}
      </Link>
    );
  }
  return (
    <button type={type} className={className} disabled={disabled} onClick={onClick}>
      {children}
    </button>
  );
}

export function OperationCard({
  icon,
  title,
  description,
  href,
  accent = 'purple',
  selected,
}: {
  icon: ReactNode;
  title: string;
  description: string;
  href?: string;
  accent?: 'purple' | 'green' | 'pink' | 'red' | 'blue';
  selected?: boolean;
}) {
  const body = (
    <>
      <span className={`tp-op-icon tp-op-${accent}`}>{icon}</span>
      <span className="tp-op-copy">
        <strong>{title}</strong>
        <small>{description}</small>
      </span>
      <ChevronRight size={18} className="tp-op-chevron" />
    </>
  );
  if (href) {
    return (
      <Link href={href} className={`tp-op-card ${selected ? 'is-selected' : ''}`}>
        {body}
      </Link>
    );
  }
  return <button className={`tp-op-card ${selected ? 'is-selected' : ''}`}>{body}</button>;
}

export function UserModal({ title, subtitle, children, size = 'md' }: { title: string; subtitle?: string; children: ReactNode; size?: 'sm' | 'md' | 'lg' }) {
  const router = useRouter();
  return (
    <div className="tp-modal-stage">
      <div className="tp-modal-blur" aria-hidden="true" />
      <section className={`tp-phone-modal tp-phone-${size}`}>
        <div className="tp-phone-notch" />
        <button className="tp-modal-close" onClick={() => router.push('/dashboard')} aria-label="Cerrar">
          <X size={22} />
        </button>
        <header className="tp-modal-header">
          <h1>{title}</h1>
          {subtitle && <p>{subtitle}</p>}
        </header>
        {children}
      </section>
    </div>
  );
}

export function AmountPicker({ value, setValue, options = [10000, 20000, 50000, 100000] }: { value: number; setValue: (n: number) => void; options?: number[] }) {
  return (
    <div className="tp-amount-block">
      <span>Monto (COP)</span>
      <strong>{value > 0 ? compactCOP(value) : '0'}</strong>
      <div className="tp-amount-pills">
        {options.map((opt) => (
          <button key={opt} type="button" onClick={() => setValue(opt)} className={value === opt ? 'active' : ''}>
            {compactCOP(opt)}
          </button>
        ))}
      </div>
    </div>
  );
}

export function useBanksList() {
  return useQuery({
    queryKey: ['banks-list'],
    queryFn: () => banksApi.list(),
    select: (res) => res.data.bancos || [],
  });
}

export function BankAccountFields({
  bancos,
  label = 'Selecciona el banco:',
  bancoId,
  setBancoId,
  tipoCuenta,
  setTipoCuenta,
  numeroCuenta,
  setNumeroCuenta,
  nombreTitular,
  setNombreTitular,
  cedulaTitular,
  setCedulaTitular,
}: Readonly<{
  bancos: any[];
  label?: string;
  bancoId: string;
  setBancoId: (id: string) => void;
  tipoCuenta: string;
  setTipoCuenta: (v: string) => void;
  numeroCuenta: string;
  setNumeroCuenta: (v: string) => void;
  nombreTitular: string;
  setNombreTitular: (v: string) => void;
  cedulaTitular: string;
  setCedulaTitular: (v: string) => void;
}>) {
  return (
    <>
      <p className="tp-modal-label">{label}</p>
      <div className="tp-bank-list">
        {bancos.map((b: any) => (
          <button key={b.id} onClick={() => setBancoId(b.id)} className={bancoId === b.id ? 'selected' : ''}>
            <span className="tp-bank-logo">{b.nombre.slice(0, 2).toUpperCase()}</span>
            <div><strong>{b.nombre} {b.nuevo && <em>Nuevo</em>}</strong></div>
            <ChevronRight size={19} />
          </button>
        ))}
      </div>

      <label className="tp-form-field">
        <span>Tipo de cuenta</span>
        <select value={tipoCuenta} onChange={(e) => setTipoCuenta(e.target.value)}>
          <option value="ahorros">Ahorros</option>
          <option value="corriente">Corriente</option>
        </select>
      </label>
      <label className="tp-form-field">
        <span>Número de cuenta</span>
        <input value={numeroCuenta} onChange={(e) => setNumeroCuenta(e.target.value.replace(/\D/g, ''))} placeholder="Ej. 04512345678" inputMode="numeric" />
      </label>
      <label className="tp-form-field">
        <span>Nombre del titular</span>
        <input value={nombreTitular} onChange={(e) => setNombreTitular(e.target.value)} placeholder="Nombre completo" />
      </label>
      <label className="tp-form-field">
        <span>Cédula del titular</span>
        <input value={cedulaTitular} onChange={(e) => setCedulaTitular(e.target.value.replace(/\D/g, ''))} placeholder="Ej. 1023456789" inputMode="numeric" />
      </label>
    </>
  );
}

export function InfoDestination({ saldo, label = 'Destino: Tu billetera virtual', description = 'El dinero llega a tu saldo · No a un banco' }: { saldo?: number; label?: string; description?: string }) {
  return (
    <div className="tp-info-dest">
      <div className="tp-info-icon"><Wallet size={22} /></div>
      <div>
        <strong>{label}</strong>
        <p>{description}</p>
        {typeof saldo === 'number' && <small>Saldo actual: {fmtCOP(saldo)}</small>}
      </div>
    </div>
  );
}

export function FakeQr({ user, amount, concept }: { user?: User | null; amount?: number; concept?: string }) {
  return (
    <div className="tp-qr-box">
      <div className="tp-fake-qr" aria-label="QR demo">
        {Array.from({ length: 36 }).map((_, idx) => <i key={idx} />)}
      </div>
      <p>{user?.correo || 'usuario@trendpay.co'} · CC {user?.cedula || '1023456789'}</p>
      {(amount || concept) && <small>{amount ? compactCOP(amount) : 'Monto libre'}{concept ? ` · ${concept}` : ''}</small>}
    </div>
  );
}

export function RealQr({ value, size = 220 }: { value: string; size?: number }) {
  const [dataUrl, setDataUrl] = useState<string | null>(null);

  useEffect(() => {
    if (!value) { setDataUrl(null); return; }
    let cancelled = false;
    QRCode.toDataURL(value, { width: size, margin: 1, color: { dark: '#1a0840', light: '#ffffff' } })
      .then((url) => { if (!cancelled) setDataUrl(url); })
      .catch(() => { if (!cancelled) setDataUrl(null); });
    return () => { cancelled = true; };
  }, [value, size]);

  return (
    <div className="tp-qr-box">
      {dataUrl ? (
        <img src={dataUrl} width={size} height={size} alt="Código QR para pagar" style={{ borderRadius: 12, display: 'block', margin: '0 auto' }} />
      ) : (
        <div className="tp-fake-qr" aria-hidden="true">
          {Array.from({ length: 36 }).map((_, idx) => <i key={idx} />)}
        </div>
      )}
    </div>
  );
}

export function EmptyState({ title = 'Sin movimientos', icon = <History size={40} /> }: { title?: string; icon?: ReactNode }) {
  return (
    <div className="tp-empty">
      <div>{icon}</div>
      <p>{title}</p>
    </div>
  );
}

export const userMenu = [
  { section: 'Principal', items: [
    { href: '/dashboard', label: 'Inicio', icon: <Home size={19} /> },
    { href: '/dashboard/historial', label: 'Historial', icon: <History size={19} /> },
  ]},
  { section: 'Operaciones', items: [
    { href: '/dashboard/consignar', label: 'Consignar', icon: <QrCode size={19} /> },
    { href: '/dashboard/cobrar-qr', label: 'Cobrar QR', icon: <QrCode size={19} /> },
    { href: '/dashboard/enviar', label: 'Enviar', icon: <Send size={19} /> },
    { href: '/dashboard/retirar-banco', label: 'Retirar a banco', icon: <Building2 size={19} /> },
  ]},
  { section: 'Cuenta', items: [
    { href: '/dashboard/perfil', label: 'Mi perfil', icon: <UserIcon /> },
    { href: '/dashboard/referidos', label: 'Mis referidos', icon: <Users size={19} /> },
    { href: '/dashboard/seguridad', label: 'Seguridad', icon: <Lock size={19} /> },
    { href: '/dashboard/bancos', label: 'Mis bancos', icon: <CreditCard size={19} /> },
  ]},
];

function UserIcon() {
  return (
    <svg width="19" height="19" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M20 21a8 8 0 0 0-16 0" />
      <circle cx="12" cy="7" r="4" />
    </svg>
  );
}

export const icons = { ArrowRight, Banknote, Building2, Camera, Check, CreditCard, Download, Eye, EyeOff, History, Home, Lock, LogOut, Mail, QrCode, Search, Send, ShieldCheck, Smartphone, Users, Wallet, X };
