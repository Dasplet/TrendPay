'use client';

import { X } from 'lucide-react';
import { useEffect, useId, useRef } from 'react';
import type { ReactNode } from 'react';

// ── Metric card ──
export function MetricCard({ icon, value, label, color = '#852EC7', bg = 'rgba(133,46,199,.15)' }:
  { icon: ReactNode; value: string; label: string; color?: string; bg?: string }) {
  return (
    <div style={{ background:'var(--adm-panel)', border:'1px solid rgba(133,46,199,.18)', borderRadius:16, padding:'24px 24px', position:'relative', overflow:'hidden' }}>
      <div style={{ position:'absolute', top:-20, right:-20, width:100, height:100, borderRadius:'50%', background: bg, opacity:.4 }} />
      <div style={{ width:44, height:44, borderRadius:12, background:bg, display:'flex', alignItems:'center', justifyContent:'center', marginBottom:16, color }}>
        {icon}
      </div>
      <div style={{ fontSize:28, fontWeight:900, color:'var(--adm-text)', letterSpacing:'-.5px', marginBottom:4 }}>{value}</div>
      <div style={{ fontSize:12, color:'var(--adm-muted)' }}>{label}</div>
    </div>
  );
}

// ── Panel wrapper ──
export function Panel({ children, style }: { children: React.ReactNode; style?: React.CSSProperties }) {
  return (
    <div style={{ background:'var(--adm-panel)', border:'1px solid rgba(133,46,199,.18)', borderRadius:16, overflow:'hidden', ...style }}>
      {children}
    </div>
  );
}

// ── Panel header ──
export function PanelHeader({ title, icon, actions }: { title: string; icon?: ReactNode; actions?: React.ReactNode }) {
  return (
    <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between', padding:'16px 20px', borderBottom:'1px solid rgba(133,46,199,.12)' }}>
      <div style={{ display:'flex', alignItems:'center', gap:8, fontSize:14, fontWeight:700, color:'var(--adm-text)' }}>
        {icon && <span style={{ color:'#852EC7', display:'inline-flex' }}>{icon}</span>}
        {title}
      </div>
      {actions && <div style={{ display:'flex', gap:8, alignItems:'center' }}>{actions}</div>}
    </div>
  );
}

// ── Table ──
export function Table({ headers, children, empty }: { headers: string[]; children: React.ReactNode; empty?: string }) {
  return (
    <div style={{ overflowX:'auto' }}>
      <table style={{ width:'100%', borderCollapse:'collapse', fontSize:13 }}>
        <thead>
          <tr>
            {headers.map(h => (
              <th key={h} style={{ padding:'10px 16px', textAlign:'left', fontSize:11, fontWeight:700, color:'rgba(var(--adm-muted-rgb),.8)', textTransform:'uppercase', letterSpacing:'.5px', borderBottom:'1px solid rgba(var(--adm-fg-rgb),.06)' }}>
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>{children}</tbody>
      </table>
    </div>
  );
}

// ── Table row ──
export function Tr({ children }: { children: React.ReactNode }) {
  return (
    <tr className="adm-table-row" style={{ borderBottom:'1px solid rgba(var(--adm-fg-rgb),.04)' }}>
      {children}
    </tr>
  );
}

// ── Td ──
export function Td({ children, style, colSpan }: { children: React.ReactNode; style?: React.CSSProperties; colSpan?: number }) {
  return <td colSpan={colSpan} style={{ padding:'12px 16px', color:'rgba(var(--adm-fg-rgb),.85)', verticalAlign:'middle', ...style }}>{children}</td>;
}

// ── Status badge ──
export function StatusBadge({ status }: { status: string }) {
  const map: Record<string, { label: string; color: string; bg: string }> = {
    exitosa:   { label:'Exitosa',   color:'#6CC998', bg:'rgba(108,201,152,.15)' },
    pendiente: { label:'Pendiente', color:'#d4a017', bg:'rgba(212,160,23,.15)'  },
    procesado: { label:'Procesado', color:'#852EC7', bg:'rgba(133,46,199,.15)'  },
    rechazada: { label:'Rechazada', color:'#C0392B', bg:'rgba(192,57,43,.15)'   },
    pagado:    { label:'Pagado',    color:'#6CC998', bg:'rgba(108,201,152,.15)' },
    activo:    { label:'Activo',    color:'#6CC998', bg:'rgba(108,201,152,.15)' },
    bloqueado: { label:'Bloqueado', color:'#C0392B', bg:'rgba(192,57,43,.15)'   },
  };
  const s = map[status?.toLowerCase()] || { label: status, color:'#AE93AA', bg:'rgba(174,147,170,.15)' };
  return (
    <span style={{ background:s.bg, color:s.color, padding:'3px 10px', borderRadius:20, fontSize:11, fontWeight:600, whiteSpace:'nowrap' }}>
      {s.label}
    </span>
  );
}

// ── KYC badge ──
export function KycBadge({ nivel }: { nivel: number }) {
  const colors = ['#d4a017','#6CC998','#852EC7'];
  return (
    <span style={{ background:`${colors[nivel]||'#AE93AA'}22`, color:colors[nivel]||'#AE93AA', padding:'3px 10px', borderRadius:20, fontSize:11, fontWeight:600 }}>
      Nivel {nivel}
    </span>
  );
}

// ── Avatar ──
export function Avatar({ name, size = 36 }: { name: string; size?: number }) {
  const initials = name.split(' ').slice(0,2).map((w:string) => w[0]||'').join('').toUpperCase();
  const colors = ['#852EC7','#6CC998','#AE93AA','#C0392B','#d4a017'];
  const color  = colors[(name.codePointAt(0) ?? 0) % colors.length];
  return (
    <div style={{ width:size, height:size, borderRadius:size/3, background:`${color}33`, border:`1px solid ${color}55`, display:'flex', alignItems:'center', justifyContent:'center', fontSize:size*0.33, fontWeight:700, color, flexShrink:0 }}>
      {initials}
    </div>
  );
}

// ── Button ──
export function Btn({ children, onClick, variant = 'default', disabled, style, title }:
  { children: React.ReactNode; onClick?: () => void; variant?: 'default'|'primary'|'danger'|'ghost'; disabled?: boolean; style?: React.CSSProperties; title?: string }) {
  const variants = {
    default: { background:'rgba(133,46,199,.1)', border:'1px solid rgba(133,46,199,.25)', color:'#c088f0' },
    primary: { background:'#852EC7', border:'1px solid #852EC7', color:'#fff' },
    danger:  { background:'rgba(192,57,43,.1)', border:'1px solid rgba(192,57,43,.3)', color:'#C0392B' },
    ghost:   { background:'transparent', border:'1px solid rgba(var(--adm-fg-rgb),.15)', color:'rgba(var(--adm-fg-rgb),.65)' },
  };
  return (
    <button onClick={onClick} disabled={disabled} title={title}
      style={{ padding:'7px 14px', borderRadius:9, fontSize:12, fontWeight:600, cursor:disabled?'not-allowed':'pointer', display:'inline-flex', alignItems:'center', gap:6, transition:'all .15s', opacity:disabled?.4:1, ...variants[variant], ...style }}>
      {children}
    </button>
  );
}

// ── Modal ──
export function Modal({ open, onClose, title, children }: { open:boolean; onClose:()=>void; title:string; children:React.ReactNode }) {
  const dialogRef = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    if (open && !dialog.open) dialog.showModal();
    else if (!open && dialog.open) dialog.close();
  }, [open]);

  return (
    // MDN's own recommended pattern for closing a native <dialog> on backdrop
    // click (e.target === dialog) — the linter doesn't special-case <dialog>
    // as interactive, but Escape/focus-trap are handled natively.
    <dialog // NOSONAR
      ref={dialogRef}
      className="adm-dialog"
      aria-label={title}
      onClose={onClose}
      onClick={e => { if (e.target === dialogRef.current) onClose(); }}
      style={{ background:'var(--adm-panel)', border:'1px solid rgba(133,46,199,.3)', borderRadius:20, width:'100%', maxWidth:480, maxHeight:'90vh', overflowY:'auto', padding:28, color:'inherit' }}
    >
      <button onClick={onClose} style={{ position:'absolute', top:16, right:16, width:28, height:28, borderRadius:8, background:'rgba(133,46,199,.12)', border:'none', color:'var(--adm-text)', cursor:'pointer', display:'flex', alignItems:'center', justifyContent:'center' }}><X size={16} /></button>
      <div style={{ fontSize:18, fontWeight:800, color:'var(--adm-text)', marginBottom:20 }}>{title}</div>
      {children}
    </dialog>
  );
}

// ── Input ──
export function Input({ label, id, ...props }: { label?: string } & React.InputHTMLAttributes<HTMLInputElement>) {
  const generatedId = useId();
  const inputId = id || generatedId;
  return (
    <div style={{ marginBottom:14 }}>
      {label && <label htmlFor={inputId} style={{ display:'block', fontSize:11, fontWeight:600, color:'var(--adm-muted)', textTransform:'uppercase', letterSpacing:'.5px', marginBottom:6 }}>{label}</label>}
      <input id={inputId} {...props} style={{ width:'100%', background:'rgba(var(--adm-card-rgb),.7)', border:'1.5px solid rgba(133,46,199,.25)', borderRadius:10, padding:'10px 12px', fontSize:13, color:'var(--adm-text)', outline:'none', fontFamily:'inherit', boxSizing:'border-box', ...props.style }} />
    </div>
  );
}

// ── Select ──
export function Select({ label, children, id, ...props }: { label?: string; children: React.ReactNode } & React.SelectHTMLAttributes<HTMLSelectElement>) {
  const generatedId = useId();
  const selectId = id || generatedId;
  return (
    <div style={{ marginBottom:14 }}>
      {label && <label htmlFor={selectId} style={{ display:'block', fontSize:11, fontWeight:600, color:'var(--adm-muted)', textTransform:'uppercase', letterSpacing:'.5px', marginBottom:6 }}>{label}</label>}
      <select id={selectId} {...props} style={{ width:'100%', background:'rgba(var(--adm-card-rgb),.7)', border:'1.5px solid rgba(133,46,199,.25)', borderRadius:10, padding:'10px 12px', fontSize:13, color:'var(--adm-text)', outline:'none', fontFamily:'inherit', boxSizing:'border-box', cursor:'pointer', ...props.style }}>
        {children}
      </select>
    </div>
  );
}

// ── Format currency ──
export function fmt(n: number | string) {
  return new Intl.NumberFormat('es-CO', { style:'currency', currency:'COP', minimumFractionDigits:0 }).format(Number(n)||0);
}

// ── Format date ──
export function fmtDate(d: string) {
  if (!d) return '—';
  const dt = new Date(d);
  const m = ['ene','feb','mar','abr','may','jun','jul','ago','sep','oct','nov','dic'];
  return `${String(dt.getDate()).padStart(2,'0')}-${m[dt.getMonth()]}-${dt.getFullYear()} | ${String(dt.getHours()).padStart(2,'0')}:${String(dt.getMinutes()).padStart(2,'0')}`;
}
