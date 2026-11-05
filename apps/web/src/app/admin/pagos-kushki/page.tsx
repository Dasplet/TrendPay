'use client';
import { useState } from 'react';
import toast from 'react-hot-toast';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { CreditCard, RefreshCw, Webhook } from 'lucide-react';
import { adminApi } from '@/lib/api';
import { Panel, PanelHeader, Table, Tr, Td, StatusBadge, Btn, fmt, fmtDate } from '@/components/admin/ui';

const FILTERS = [
  { label: 'Todos', value: '' },
  { label: 'Pendientes', value: 'pendiente' },
  { label: 'Completados', value: 'completado' },
  { label: 'Rechazados', value: 'rechazado' },
];

interface Total { estado: string; cantidad: number; monto: number }

export default function PagosKushkiPage() {
  const queryClient = useQueryClient();
  const [estado, setEstado] = useState('');

  const { data, isLoading } = useQuery({
    queryKey: ['admin-kushki-pagos', estado],
    queryFn: () => adminApi.kushkiPagos(estado ? { estado } : undefined),
    select: (d) => d.data,
  });

  const conciliar = useMutation({
    mutationFn: () => adminApi.kushkiConciliar(),
    onSuccess: ({ data: res }) => {
      const r = res.resumen;
      toast.success(`Conciliación: ${r.revisados} revisados · ${r.completados} acreditados · ${r.rechazados} rechazados · ${r.pendientes} siguen pendientes${r.errores ? ` · ${r.errores} con error` : ''}`);
      queryClient.invalidateQueries({ queryKey: ['admin-kushki-pagos'] });
    },
    onError: (err: any) => toast.error(err.response?.data?.mensaje || 'No se pudo conciliar'),
  });

  const avisosQ = useQuery({
    queryKey: ['admin-kushki-webhooks'],
    queryFn: () => adminApi.kushkiWebhooks(),
    select: (d) => d.data,
    refetchInterval: 15000,
  });
  const avisos: any[] = avisosQ.data?.avisos || [];

  const pagos: any[] = data?.pagos || [];
  const totales: Total[] = data?.totales || [];

  let rows: React.ReactNode;
  if (isLoading) {
    rows = <Tr><Td style={{ textAlign: 'center', padding: 32, color: 'rgba(var(--adm-fg-rgb),.3)' }} colSpan={6 as any}>Cargando...</Td></Tr>;
  } else if (pagos.length === 0) {
    rows = <Tr><Td style={{ textAlign: 'center', padding: 32, color: 'rgba(var(--adm-fg-rgb),.3)' }} colSpan={6 as any}>Sin pagos</Td></Tr>;
  } else {
    rows = pagos.map((p) => (
      <Tr key={p.id}>
        <Td style={{ fontSize: 11, color: 'rgba(var(--adm-fg-rgb),.4)', whiteSpace: 'nowrap' }}>{fmtDate(p.createdAt)}</Td>
        <Td style={{ fontSize: 12 }}>{p.usuario}<div style={{ fontSize: 10, color: 'rgba(var(--adm-fg-rgb),.4)' }}>{p.cedula}</div></Td>
        <Td style={{ fontSize: 12, textTransform: 'uppercase' }}>{p.metodo}</Td>
        <Td style={{ fontWeight: 700 }}>{fmt(p.monto)}</Td>
        <Td><StatusBadge status={p.estado} /></Td>
        <Td style={{ fontFamily: 'monospace', fontSize: 11, color: 'rgba(var(--adm-fg-rgb),.4)' }}>{p.ticketNumber || '—'}</Td>
      </Tr>
    ));
  }

  return (
    <>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 12, marginBottom: 16 }}>
        {totales.map((t) => (
          <Panel key={t.estado} style={{ padding: 16 }}>
            <StatusBadge status={t.estado} />
            <div style={{ fontSize: 22, fontWeight: 800, marginTop: 8 }}>{fmt(t.monto)}</div>
            <div style={{ fontSize: 11, color: 'rgba(var(--adm-fg-rgb),.5)' }}>{t.cantidad} pagos</div>
          </Panel>
        ))}
      </div>

      <Panel>
        <PanelHeader title="Pagos Kushki (tarjeta y PSE)" icon={<CreditCard size={16} />}
          actions={
            <Btn variant="primary" disabled={conciliar.isPending} onClick={() => conciliar.mutate()}
              title="Consulta a Kushki los PSE pendientes y acredita los aprobados">
              <RefreshCw size={13} /> {conciliar.isPending ? 'Conciliando...' : 'Conciliar PSE ahora'}
            </Btn>
          }
        />
        <div style={{ display: 'flex', gap: 8, padding: '12px 16px', borderBottom: '1px solid rgba(133,46,199,.12)' }}>
          {FILTERS.map((f) => (
            <button key={f.label} onClick={() => setEstado(f.value)}
              style={{ padding: '6px 14px', borderRadius: 8, fontSize: 12, fontWeight: 600, cursor: 'pointer', border: estado === f.value ? '1px solid #852EC7' : '1px solid rgba(var(--adm-fg-rgb),.1)', background: estado === f.value ? 'rgba(133,46,199,.2)' : 'transparent', color: estado === f.value ? 'var(--adm-text)' : 'rgba(var(--adm-fg-rgb),.5)' }}>
              {f.label}
            </button>
          ))}
        </div>
        <Table headers={['Fecha', 'Usuario', 'Método', 'Monto', 'Estado', 'Ticket Kushki']}>
          {rows}
        </Table>
      </Panel>

      <Panel style={{ marginTop: 16 }}>
        <PanelHeader title="Avisos de Kushki (webhook de retiros)" icon={<Webhook size={16} />}
          actions={<Btn variant="ghost" onClick={() => avisosQ.refetch()} title="Actualizar"><RefreshCw size={13} /> Actualizar</Btn>} />
        <div style={{ padding: '12px 16px', fontSize: 12, color: 'rgba(var(--adm-fg-rgb),.6)', borderBottom: '1px solid rgba(133,46,199,.12)', lineHeight: 1.6 }}>
          Cada vez que Kushki llama a TrendPay para avisar el resultado de un retiro, queda aquí (incluso si se rechaza). Se actualiza solo cada 15 segundos.
          {avisosQ.data && !avisosQ.data.secretoConfigurado && (
            <div style={{ color: '#d4a017', fontWeight: 600, marginTop: 4 }}>Falta KUSHKI_WEBHOOK_SECRET en el servidor: todos los avisos se rechazarán.</div>
          )}
        </div>
        <Table headers={['Fecha', 'Ticket', 'Firma', 'Respuesta', 'Detalle', 'Origen']}>
          {avisos.length === 0 ? (
            <Tr><Td colSpan={6 as any} style={{ textAlign: 'center', padding: 28, fontSize: 12, color: 'rgba(var(--adm-fg-rgb),.4)', lineHeight: 1.6 }}>
              Aún no ha llegado ninguna llamada de Kushki. Si ya hiciste retiros por ACH y esto sigue vacío, Kushki no tiene registrada la URL del webhook de TrendPay.
            </Td></Tr>
          ) : avisos.map((a) => (
            <Tr key={a.id}>
              <Td style={{ fontSize: 11, color: 'rgba(var(--adm-fg-rgb),.4)', whiteSpace: 'nowrap' }}>{fmtDate(a.createdAt)}</Td>
              <Td style={{ fontFamily: 'monospace', fontSize: 11 }}>{a.ticket || '—'}</Td>
              <Td>
                <span style={{ background: a.firmaValida ? 'rgba(108,201,152,.15)' : 'rgba(192,57,43,.15)', color: a.firmaValida ? '#6CC998' : '#C0392B', padding: '3px 10px', borderRadius: 20, fontSize: 11, fontWeight: 600, whiteSpace: 'nowrap' }}>
                  {a.firmaValida ? 'Válida' : 'Inválida'}
                </span>
              </Td>
              <Td style={{ fontWeight: 700, fontSize: 12 }}>{a.estadoHttp}</Td>
              <Td style={{ fontSize: 12, maxWidth: 320 }}>{a.detalle || '—'}</Td>
              <Td style={{ fontFamily: 'monospace', fontSize: 11, color: 'rgba(var(--adm-fg-rgb),.4)' }}>{a.ip || '—'}</Td>
            </Tr>
          ))}
        </Table>
      </Panel>
    </>
  );
}
