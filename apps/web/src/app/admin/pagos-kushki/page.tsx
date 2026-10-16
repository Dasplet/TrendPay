'use client';
import { useState } from 'react';
import toast from 'react-hot-toast';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { CreditCard, RefreshCw } from 'lucide-react';
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
    </>
  );
}
