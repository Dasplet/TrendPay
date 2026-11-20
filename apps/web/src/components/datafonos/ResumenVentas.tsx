'use client';

import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { datafonosApi } from '@/lib/api';

interface Fila { cobros: number; bruto: number; comision: number; neto: number }
interface Terminal extends Fila { id: string; alias: string }
interface Tienda extends Fila { empresa: string; sedeId: string | null; nombre: string; terminales: Terminal[] }
interface Resumen { total: Fila; tiendas: Tienda[] }

const PERIODOS = [
  { clave: 'hoy', etiqueta: 'Hoy' },
  { clave: '7d', etiqueta: '7 días' },
  { clave: 'mes', etiqueta: 'Este mes' },
] as const;

const cop = (n: number) => new Intl.NumberFormat('es-CO', { style: 'currency', currency: 'COP', minimumFractionDigits: 0 }).format(n);

// Ventas aprobadas por tienda y por datáfono. Sirve igual para el cliente (sus tiendas) y para el administrador (todas
// las empresas): solo cambia de dónde se piden los datos. Usa colores heredados para verse bien en ambos temas.
export function ResumenVentas({ admin = false }: Readonly<{ admin?: boolean }>) {
  const [periodo, setPeriodo] = useState<(typeof PERIODOS)[number]['clave']>('hoy');
  const { data, isLoading, isError } = useQuery({
    queryKey: ['datafonos-resumen', admin, periodo],
    queryFn: () => (admin ? datafonosApi.admin.resumen(periodo) : datafonosApi.resumen(periodo)).then((r) => r.data as Resumen),
    refetchInterval: 30_000,
  });
  const hayComision = (data?.total.comision ?? 0) > 0;

  return (
    <div>
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center', marginBottom: 12 }}>
        {PERIODOS.map((p) => (
          <button
            key={p.clave}
            type="button"
            onClick={() => setPeriodo(p.clave)}
            style={{
              padding: '6px 14px', borderRadius: 20, fontSize: 13, fontWeight: 600, cursor: 'pointer', color: 'inherit',
              border: periodo === p.clave ? '2px solid #852EC7' : '1.5px solid rgba(128,128,128,.35)',
              background: periodo === p.clave ? 'rgba(133,46,199,.12)' : 'transparent',
            }}
          >
            {p.etiqueta}
          </button>
        ))}
      </div>

      {isLoading && <p style={{ opacity: 0.7 }}>Cargando ventas…</p>}
      {isError && <p style={{ color: '#c0392b' }}>No se pudieron cargar las ventas.</p>}

      {data && (
        <>
          <p style={{ margin: '0 0 12px', fontSize: 14 }}>
            <strong style={{ fontSize: 22 }}>{cop(data.total.bruto)}</strong>{' '}
            <span style={{ opacity: 0.7 }}>· {data.total.cobros} cobro{data.total.cobros === 1 ? '' : 's'} aprobado{data.total.cobros === 1 ? '' : 's'}</span>
            {hayComision && <span style={{ opacity: 0.7 }}> · comisión {cop(data.total.comision)} · neto {cop(data.total.neto)}</span>}
          </p>

          {data.tiendas.length === 0 && <p style={{ opacity: 0.7 }}>Todavía no hay cobros aprobados en este período.</p>}

          {data.tiendas.map((t) => (
            <div key={`${t.empresa}:${t.sedeId ?? ''}`} style={{ border: '1px solid rgba(128,128,128,.25)', borderRadius: 12, padding: '12px 14px', marginBottom: 10 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8, flexWrap: 'wrap' }}>
                <strong>{t.nombre}{admin && <span style={{ fontWeight: 400, opacity: 0.65 }}> · {t.empresa}</span>}</strong>
                <strong>{cop(t.bruto)}</strong>
              </div>
              <div style={{ fontSize: 12, opacity: 0.7, marginBottom: 6 }}>
                {t.cobros} cobro{t.cobros === 1 ? '' : 's'}{t.comision > 0 && ` · comisión ${cop(t.comision)} · neto ${cop(t.neto)}`}
              </div>
              {t.terminales.map((d) => (
                <div key={d.id} style={{ display: 'flex', justifyContent: 'space-between', gap: 8, fontSize: 13, padding: '2px 0', opacity: 0.9 }}>
                  <span>{d.alias} <span style={{ opacity: 0.6 }}>· {d.cobros} cobro{d.cobros === 1 ? '' : 's'}</span></span>
                  <span>{cop(d.bruto)}</span>
                </div>
              ))}
            </div>
          ))}
        </>
      )}
    </div>
  );
}
