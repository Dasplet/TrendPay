'use client';
import Link from 'next/link';
import { useQuery } from '@tanstack/react-query';
import { AlertTriangle, ArrowRight, ShieldCheck } from 'lucide-react';
import { api } from '@/lib/api';
import { Panel, PanelHeader, fmt } from '@/components/admin/ui';

type Nivel = 'alto' | 'medio' | 'info';
interface Alerta { id: string; nivel: Nivel; titulo: string; detalle: string; fecha: string; href?: string }
interface Respuesta { alertas: Alerta[]; reglas: { umbralRetiro: number; intentosPin: number; bloqueoMinutos: number } }

const ESTILO: Record<Nivel, { etiqueta: string; color: string; bg: string }> = {
  alto:  { etiqueta: 'Alto',  color: '#C0392B', bg: 'rgba(192,57,43,.15)' },
  medio: { etiqueta: 'Medio', color: '#d4a017', bg: 'rgba(212,160,23,.15)' },
  info:  { etiqueta: 'Info',  color: '#852EC7', bg: 'rgba(133,46,199,.15)' },
};

function haceCuanto(fecha: string) {
  const diff = Date.now() - new Date(fecha).getTime();
  if (diff < 60_000) return 'Hace unos segundos';
  if (diff < 3_600_000) return `Hace ${Math.floor(diff / 60_000)} min`;
  if (diff < 86_400_000) return `Hace ${Math.floor(diff / 3_600_000)} h`;
  return new Date(fecha).toLocaleDateString('es-CO', { day: 'numeric', month: 'short' });
}

// Alertas calculadas con los datos de ahora: si no hay nada que atender, no se muestra nada inventado
export default function AlertasPage() {
  const { data, isLoading, isError } = useQuery({
    queryKey: ['admin-alertas'],
    queryFn: () => api.get('/admin/alertas').then((r) => r.data as Respuesta),
    refetchInterval: 30_000,
    refetchOnWindowFocus: true,
  });
  const alertas = data?.alertas ?? [];

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      <Panel style={{ border: alertas.length ? '1px solid rgba(192,57,43,.25)' : undefined }}>
        <PanelHeader title={alertas.length ? `Alertas de riesgo activas (${alertas.length})` : 'Alertas de riesgo'} icon={<AlertTriangle size={16} />} />
        <div style={{ padding: '12px 16px', display: 'flex', flexDirection: 'column', gap: 10 }}>
          {isLoading && <div style={{ textAlign: 'center', padding: 32, opacity: 0.6, fontSize: 13 }}>Cargando…</div>}
          {isError && <div style={{ textAlign: 'center', padding: 32, color: '#C0392B', fontSize: 13 }}>No se pudieron cargar las alertas.</div>}
          {data && alertas.length === 0 && (
            <div style={{ textAlign: 'center', padding: 32, fontSize: 13, color: '#6CC998', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 8 }}>
              <ShieldCheck size={28} />
              <strong>Todo al día</strong>
              <span style={{ opacity: 0.7, color: 'var(--adm-text)' }}>No hay retiros por revisar, cuentas bloqueadas, pagos sin confirmar ni saldos negativos.</span>
            </div>
          )}
          {alertas.map((a) => {
            const e = ESTILO[a.nivel];
            return (
              <div key={a.id} style={{ display: 'flex', alignItems: 'center', gap: 14, padding: '14px 16px', background: 'rgba(var(--adm-card-rgb),.5)', borderRadius: 12, border: '1px solid rgba(133,46,199,.12)' }}>
                <div style={{ width: 44, height: 44, borderRadius: 12, background: e.bg, display: 'flex', alignItems: 'center', justifyContent: 'center', color: e.color, flexShrink: 0 }}><AlertTriangle size={20} /></div>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 3, flexWrap: 'wrap' }}>
                    <span style={{ fontSize: 14, fontWeight: 700, color: 'var(--adm-text)' }}>{a.titulo}</span>
                    <span style={{ fontSize: 11, fontWeight: 700, background: e.bg, color: e.color, padding: '2px 8px', borderRadius: 12 }}>{e.etiqueta}</span>
                  </div>
                  <div style={{ fontSize: 12, color: 'rgba(var(--adm-fg-rgb),.6)', marginBottom: 3 }}>{a.detalle}</div>
                  <div style={{ fontSize: 11, color: 'rgba(var(--adm-fg-rgb),.35)' }}>{haceCuanto(a.fecha)}</div>
                </div>
                {a.href && (
                  <Link href={a.href} style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 12, fontWeight: 600, color: '#c088f0', border: '1px solid rgba(133,46,199,.25)', borderRadius: 9, padding: '7px 12px', whiteSpace: 'nowrap' }}>
                    Revisar <ArrowRight size={13} />
                  </Link>
                )}
              </div>
            );
          })}
        </div>
      </Panel>

      {data && (
        <Panel>
          <PanelHeader title="Reglas vigentes" icon={<ShieldCheck size={16} />} />
          <div style={{ padding: '8px 0' }}>
            {[
              { label: 'Retiro de monto alto', sub: 'Se avisa cuando un retiro pendiente llega a este monto', value: fmt(data.reglas.umbralRetiro) },
              { label: 'Bloqueo por PIN incorrecto', sub: 'La cuenta se bloquea temporalmente al fallar el PIN', value: `${data.reglas.intentosPin} intentos · ${data.reglas.bloqueoMinutos} min` },
              { label: 'Retiros sin resolver', sub: 'Se avisa a las 24 h (medio) y a las 48 h (alto)', value: '24 h / 48 h' },
              { label: 'Pagos Kushki sin confirmar', sub: 'Se avisa cuando una consignación sigue pendiente', value: '30 min' },
            ].map((r) => (
              <div key={r.label} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, padding: '14px 20px', borderBottom: '1px solid rgba(var(--adm-fg-rgb),.04)' }}>
                <div>
                  <div style={{ fontSize: 14, fontWeight: 600, color: 'var(--adm-text)', marginBottom: 3 }}>{r.label}</div>
                  <div style={{ fontSize: 12, color: 'rgba(var(--adm-fg-rgb),.4)' }}>{r.sub}</div>
                </div>
                <span style={{ fontSize: 13, fontWeight: 700, color: '#6CC998', whiteSpace: 'nowrap' }}>{r.value}</span>
              </div>
            ))}
          </div>
        </Panel>
      )}
    </div>
  );
}
