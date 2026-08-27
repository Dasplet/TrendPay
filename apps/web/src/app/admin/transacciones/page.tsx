'use client';
import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { adminApi } from '@/lib/api';
import { Panel, PanelHeader, Table, Tr, Td, StatusBadge, Btn, fmt, fmtDate } from '@/components/admin/ui';
import { ArrowLeftRight, Download, FileSpreadsheet } from 'lucide-react';
import { downloadCsv } from '@/lib/exportCsv';

const FILTERS = ['Todas','Consigna','Cobro QR','Retiro','Envío'];

export default function TransaccionesPage() {
  const [filter, setFilter] = useState('Todas');
  const [search, setSearch] = useState('');

  const { data, isLoading } = useQuery({
    queryKey: ['admin-transactions'],
    queryFn: () => adminApi.transactions({ limit: 300 }),
    select: d => d.data,
  });

  let txs: any[] = data?.transacciones || [];
  if (filter !== 'Todas') txs = txs.filter((t:any) => t.categoria?.toLowerCase().includes(filter.toLowerCase().replace(' ','_')));
  if (search) txs = txs.filter((t:any) => t.descripcion?.toLowerCase().includes(search.toLowerCase()) || t.usuario_nombre?.toLowerCase().includes(search.toLowerCase()) || t.codigo?.toLowerCase().includes(search.toLowerCase()));

  function exportarCsv() {
    downloadCsv('transacciones', ['Referencia', 'Descripción', 'Usuario', 'Monto', 'Comisión', 'Estado', 'Fecha'],
      txs.map((t: any) => [t.codigo || '', t.descripcion || '', t.usuario_nombre || '', t.monto_neto || 0, t.comision_valor || 0, t.status || '', fmtDate(t.created_at)]));
  }

  let rows: React.ReactNode;
  if (isLoading) {
    rows = <Tr><Td style={{ textAlign:'center', padding:32, color:'rgba(var(--adm-fg-rgb),.3)' }} colSpan={7 as any}>Cargando...</Td></Tr>;
  } else if (txs.length === 0) {
    rows = <Tr><Td style={{ textAlign:'center', padding:32, color:'rgba(var(--adm-fg-rgb),.3)' }} colSpan={7 as any}>Sin transacciones</Td></Tr>;
  } else {
    rows = txs.map((t:any) => (
      <Tr key={t.id}>
        <Td style={{ fontFamily:'monospace', fontSize:11, color:'rgba(var(--adm-fg-rgb),.4)' }}>{(t.codigo||'—').slice(0,16)}</Td>
        <Td style={{ fontSize:12, maxWidth:220, overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>{t.descripcion}</Td>
        <Td style={{ fontSize:12, color:'rgba(var(--adm-fg-rgb),.7)' }}>{t.usuario_nombre||'—'}</Td>
        <Td style={{ fontWeight:700, color: Number.parseFloat(t.monto_neto)>0?'#6CC998':'#C0392B' }}>
          {Number.parseFloat(t.monto_neto)>0?'+':''}{fmt(t.monto_neto||0)}
        </Td>
        <Td style={{ color:'#d4a017', fontWeight:600 }}>{fmt(t.comision_valor||0)}</Td>
        <Td><StatusBadge status={t.status} /></Td>
        <Td style={{ fontSize:11, color:'rgba(var(--adm-fg-rgb),.4)', whiteSpace:'nowrap' }}>{fmtDate(t.created_at)}</Td>
      </Tr>
    ));
  }

  return (
    <Panel>
      <PanelHeader title={`${txs.length} transacciones`} icon={<ArrowLeftRight size={16} />}
        actions={
          <>
            <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Buscar..."
              style={{ background:'rgba(var(--adm-card-rgb),.6)', border:'1px solid rgba(133,46,199,.2)', borderRadius:8, padding:'6px 12px', fontSize:12, color:'var(--adm-text)', outline:'none', width:180 }} />
            <Btn variant="ghost" onClick={exportarCsv}><Download size={13} /> CSV</Btn>
            <Btn variant="ghost" onClick={exportarCsv}><FileSpreadsheet size={13} /> Excel</Btn>
          </>
        }
      />

      {/* Filter tabs */}
      <div style={{ display:'flex', gap:8, padding:'12px 16px', borderBottom:'1px solid rgba(133,46,199,.12)' }}>
        {FILTERS.map(f => (
          <button key={f} onClick={() => setFilter(f)}
            style={{ padding:'6px 14px', borderRadius:8, fontSize:12, fontWeight:600, cursor:'pointer', border: filter===f?'1px solid #852EC7':'1px solid rgba(var(--adm-fg-rgb),.1)', background: filter===f?'rgba(133,46,199,.2)':'transparent', color: filter===f?'var(--adm-text)':'rgba(var(--adm-fg-rgb),.5)', transition:'all .15s' }}>
            {f}
          </button>
        ))}
      </div>

      <Table headers={['Referencia','Descripción','Usuario','Monto','Comisión 3%','Estado','Fecha']}>
        {rows}
      </Table>
    </Panel>
  );
}
