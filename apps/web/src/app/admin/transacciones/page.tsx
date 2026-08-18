'use client';
import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { adminApi } from '@/lib/api';
import { Panel, PanelHeader, Table, TR, TD, StatusBadge, Btn, fmt, fmtDate } from '@/components/admin/ui';
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

  return (
    <Panel>
      <PanelHeader title={`${txs.length} transacciones`} icon={<ArrowLeftRight size={16} />}
        actions={
          <>
            <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Buscar..."
              style={{ background:'rgba(30,12,65,.6)', border:'1px solid rgba(133,46,199,.2)', borderRadius:8, padding:'6px 12px', fontSize:12, color:'#fff', outline:'none', width:180 }} />
            <Btn variant="ghost" onClick={exportarCsv}><Download size={13} /> CSV</Btn>
            <Btn variant="ghost" onClick={exportarCsv}><FileSpreadsheet size={13} /> Excel</Btn>
          </>
        }
      />

      {/* Filter tabs */}
      <div style={{ display:'flex', gap:8, padding:'12px 16px', borderBottom:'1px solid rgba(133,46,199,.12)' }}>
        {FILTERS.map(f => (
          <button key={f} onClick={() => setFilter(f)}
            style={{ padding:'6px 14px', borderRadius:8, fontSize:12, fontWeight:600, cursor:'pointer', border: filter===f?'1px solid #852EC7':'1px solid rgba(255,255,255,.1)', background: filter===f?'rgba(133,46,199,.2)':'transparent', color: filter===f?'#fff':'rgba(255,255,255,.5)', transition:'all .15s' }}>
            {f}
          </button>
        ))}
      </div>

      <Table headers={['Referencia','Descripción','Usuario','Monto','Comisión 3%','Estado','Fecha']}>
        {isLoading ? (
          <TR><TD style={{ textAlign:'center', padding:32, color:'rgba(255,255,255,.3)' }} colSpan={7 as any}>Cargando...</TD></TR>
        ) : txs.length === 0 ? (
          <TR><TD style={{ textAlign:'center', padding:32, color:'rgba(255,255,255,.3)' }} colSpan={7 as any}>Sin transacciones</TD></TR>
        ) : txs.map((t:any) => (
          <TR key={t.id}>
            <TD style={{ fontFamily:'monospace', fontSize:11, color:'rgba(255,255,255,.4)' }}>{(t.codigo||'—').slice(0,16)}</TD>
            <TD style={{ fontSize:12, maxWidth:220, overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>{t.descripcion}</TD>
            <TD style={{ fontSize:12, color:'rgba(255,255,255,.7)' }}>{t.usuario_nombre||'—'}</TD>
            <TD style={{ fontWeight:700, color: parseFloat(t.monto_neto)>0?'#6CC998':'#C0392B' }}>
              {parseFloat(t.monto_neto)>0?'+':''}{fmt(t.monto_neto||0)}
            </TD>
            <TD style={{ color:'#d4a017', fontWeight:600 }}>{fmt(t.comision_valor||0)}</TD>
            <TD><StatusBadge status={t.status} /></TD>
            <TD style={{ fontSize:11, color:'rgba(255,255,255,.4)', whiteSpace:'nowrap' }}>{fmtDate(t.created_at)}</TD>
          </TR>
        ))}
      </Table>
    </Panel>
  );
}
