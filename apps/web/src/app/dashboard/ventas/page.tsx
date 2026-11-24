'use client';

import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { datafonosApi } from '@/lib/api';
import { EmptyState, fmtCOP } from '@/components/user/UserTheme';
import { Panel, Table, Td, Tr, Btn, fmtDate } from '@/components/admin/ui';
import { PanelTitle } from '@/components/admin/dash';

interface Fila { cobros: number; bruto: number; comision: number; neto: number }
interface Terminal extends Fila { id: string; alias: string; canal?: 'datafono' | 'web' }
interface Tienda extends Fila { empresa: string; sedeId: string | null; nombre: string; terminales: Terminal[] }
interface Resumen { total: Fila; porCanal?: { datafono: Fila; web: Fila }; tiendas: Tienda[] }
interface Movimiento {
  id: string; estado: string; monto: number; neto?: number; terminal: string; tipo: 'cobro' | 'reembolso'; creado: string;
  ticketNumber: string | null; canal?: 'datafono' | 'web';
}

// Etiqueta de origen: página web (morado) o datáfono (azul)
function Canal({ web }: Readonly<{ web: boolean }>) {
  const color = web ? '#c088f0' : '#4a90d9';
  return <span style={{ background: `${color}26`, color, padding: '3px 10px', borderRadius: 20, fontSize: 11, fontWeight: 600, whiteSpace: 'nowrap' }}>{web ? 'Página web' : 'Datáfono'}</span>;
}

const PERIODOS = [
  { clave: 'hoy', etiqueta: 'Hoy' },
  { clave: '7d', etiqueta: '7 días' },
  { clave: 'mes', etiqueta: 'Este mes' },
] as const;

// Todo lo que entra por ventas: los cobros que se digitan en el datáfono y los pagos en línea de la página web. TrendPay no cobra
// ni reembolsa desde aquí: cada venta y cada devolución llega desde Kushki y se refleja en el saldo y en los movimientos, en vivo.
// La cuenta principal ve todas sus tiendas; una tienda solo ve las suyas.
export default function MisVentasPage() {
  const [periodo, setPeriodo] = useState<(typeof PERIODOS)[number]['clave']>('hoy');

  const resumenQ = useQuery({
    queryKey: ['datafonos-resumen', false, periodo],
    queryFn: () => datafonosApi.resumen(periodo).then((r) => r.data as Resumen),
    refetchInterval: 30_000,
  });
  const movimientosQ = useQuery({
    queryKey: ['datafonos-cobros'],
    queryFn: () => datafonosApi.cobros().then((r) => r.data.cobros as Movimiento[]),
    refetchInterval: 30_000,
  });

  const resumen = resumenQ.data;
  const movimientos = (movimientosQ.data ?? []).filter((m) => m.estado === 'aprobado' || m.estado === 'reembolsado');
  const hayComision = (resumen?.total.comision ?? 0) > 0;
  const plural = (n: number, uno: string, varios: string) => `${n} ${n === 1 ? uno : varios}`;

  return (
    <div className="tp-user-page">
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
        {PERIODOS.map((p) => (
          <Btn key={p.clave} variant={periodo === p.clave ? 'primary' : 'ghost'} onClick={() => setPeriodo(p.clave)}>{p.etiqueta}</Btn>
        ))}
      </div>

      {resumenQ.isError && <p className="tp-danger" style={{ fontSize: 13 }}>No se pudieron cargar las ventas.</p>}

      <div className="tp-kpis">
        <div className="tp-kpi">
          <span>Ventas del periodo</span>
          <strong>{fmtCOP(resumen?.total.bruto ?? 0)}</strong>
          <small>{plural(resumen?.total.cobros ?? 0, 'cobro aprobado', 'cobros aprobados')}</small>
        </div>
        <div className="tp-kpi">
          <span>Datáfonos</span>
          <strong>{fmtCOP(resumen?.porCanal?.datafono.bruto ?? 0)}</strong>
          <small>{plural(resumen?.porCanal?.datafono.cobros ?? 0, 'cobro', 'cobros')}</small>
        </div>
        <div className="tp-kpi">
          <span>Página web</span>
          <strong>{fmtCOP(resumen?.porCanal?.web.bruto ?? 0)}</strong>
          <small>{plural(resumen?.porCanal?.web.cobros ?? 0, 'pago', 'pagos')}</small>
        </div>
        {hayComision && (
          <div className="tp-kpi">
            <span>Neto que recibes</span>
            <strong className="tp-success">{fmtCOP(resumen?.total.neto ?? 0)}</strong>
            <small>Después de {fmtCOP(resumen?.total.comision ?? 0)} de comisión</small>
          </div>
        )}
      </div>

      <Panel>
        <PanelTitle title="Por tienda y punto de venta" sub="Cada datáfono y la página web, con lo que vendió en el periodo" />
        <div style={{ paddingTop: 8 }}>
          {!resumen || resumen.tiendas.length === 0 ? (
            <EmptyState title="Todavía no hay cobros aprobados en este periodo" />
          ) : (
            <Table headers={['Tienda / punto de venta', 'Origen', 'Cobros', 'Ventas', 'Comisión', 'Neto']}>
              {resumen.tiendas.flatMap((t) => [
                <Tr key={`t-${t.sedeId ?? 'sin'}-${t.empresa}`}>
                  <Td style={{ fontWeight: 700 }}>{t.nombre}</Td>
                  <Td>{null}</Td>
                  <Td>{t.cobros}</Td>
                  <Td style={{ fontWeight: 700 }}>{fmtCOP(t.bruto)}</Td>
                  <Td>{t.comision > 0 ? fmtCOP(t.comision) : '—'}</Td>
                  <Td>{fmtCOP(t.neto)}</Td>
                </Tr>,
                ...t.terminales.map((d) => (
                  <Tr key={`d-${d.id}`}>
                    <Td style={{ paddingLeft: 32, color: 'rgba(var(--adm-fg-rgb),.65)' }}>{d.alias}</Td>
                    <Td><Canal web={d.canal === 'web'} /></Td>
                    <Td>{d.cobros}</Td>
                    <Td>{fmtCOP(d.bruto)}</Td>
                    <Td>{d.comision > 0 ? fmtCOP(d.comision) : '—'}</Td>
                    <Td>{fmtCOP(d.neto)}</Td>
                  </Tr>
                )),
              ])}
            </Table>
          )}
        </div>
      </Panel>

      <Panel>
        <PanelTitle title="Últimos movimientos" sub="Ventas y reembolsos más recientes" />
        <div style={{ paddingTop: 8 }}>
          {movimientosQ.isLoading ? (
            <p className="tp-empty">Cargando…</p>
          ) : movimientos.length === 0 ? (
            <EmptyState title="Todavía no hay ventas" />
          ) : (
            <Table headers={['Fecha', 'Punto de venta', 'Origen', 'Tipo', 'Ticket', 'Monto']}>
              {movimientos.map((m) => {
                const reembolso = m.tipo === 'reembolso';
                const anulada = m.estado === 'reembolsado';
                return (
                  <Tr key={m.id}>
                    <Td style={{ fontSize: 11, color: 'rgba(var(--adm-fg-rgb),.45)', whiteSpace: 'nowrap' }}>{fmtDate(m.creado)}</Td>
                    <Td>{m.terminal}</Td>
                    <Td><Canal web={m.canal === 'web'} /></Td>
                    <Td>{reembolso ? 'Reembolso' : anulada ? 'Venta reembolsada' : 'Venta'}</Td>
                    <Td style={{ fontFamily: 'monospace', fontSize: 11, color: 'rgba(var(--adm-fg-rgb),.4)' }}>{m.ticketNumber ?? '—'}</Td>
                    <Td style={{ fontWeight: 700, whiteSpace: 'nowrap', color: reembolso || anulada ? 'var(--tp-danger)' : 'var(--tp-success)', textDecoration: anulada ? 'line-through' : 'none' }}>
                      {reembolso ? '−' : '+'}{fmtCOP(m.monto)}
                    </Td>
                  </Tr>
                );
              })}
            </Table>
          )}
        </div>
      </Panel>
    </div>
  );
}
