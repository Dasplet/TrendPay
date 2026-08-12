'use client';
import { useQuery } from '@tanstack/react-query';
import { api } from '@/lib/api';
import { MetricCard, Panel, PanelHeader, Table, TR, TD, StatusBadge, Btn, fmt, fmtDate } from '@/components/admin/ui';
import { Share2, Check, Clock, CircleDollarSign, Download, Trophy, Medal } from 'lucide-react';

export default function ReferidosPage() {
  const { data } = useQuery({
    queryKey: ['admin-referidos'],
    queryFn: () => api.get('/referrals/admin?limit=100'),
    select: d => d.data,
  });
  const { data: rankData } = useQuery({
    queryKey: ['admin-ranking'],
    queryFn: () => api.get('/referrals/admin/top'),
    select: d => d.data,
  });

  const referidos = data?.referidos || [];
  const stats     = data?.stats || {};
  const ranking   = rankData?.ranking || [];

  return (
    <div style={{ display:'flex', flexDirection:'column', gap:16 }}>
      {/* Metrics */}
      <div style={{ display:'grid', gridTemplateColumns:'repeat(4,1fr)', gap:14 }}>
        <MetricCard icon={<Share2 size={22} />} value={String(stats.total||0)}    label="Total referidos"         color="#852EC7" bg="rgba(133,46,199,.2)" />
        <MetricCard icon={<Check size={22} />} value={String(stats.pagados||0)}  label="Comisiones pagadas"      color="#6CC998" bg="rgba(108,201,152,.2)" />
        <MetricCard icon={<Clock size={22} />} value={String(stats.pendientes||0)} label="Pendientes (sin 1ra TX)" color="#d4a017" bg="rgba(212,160,23,.2)" />
        <MetricCard icon={<CircleDollarSign size={22} />} value={fmt(stats.total_pagado||0)} label="Total pagado en comisiones" color="#C0392B" bg="rgba(192,57,43,.2)" />
      </div>

      <div style={{ display:'grid', gridTemplateColumns:'1.6fr 1fr', gap:14 }}>
        {/* Table */}
        <Panel>
          <PanelHeader title={`${referidos.length} relaciones de referido`} icon={<Share2 size={16} />}
            actions={
              <>
                <Btn variant="primary">+ Crear referido</Btn>
                <Btn variant="ghost"><Download size={13} /> CSV</Btn>
              </>
            }
          />
          <Table headers={['Referidor','Referido','Comisión','Estado','Fecha']}>
            {referidos.length === 0 ? (
              <TR><TD style={{ textAlign:'center', padding:32, color:'rgba(255,255,255,.3)' }} colSpan={5 as any}>Sin referidos</TD></TR>
            ) : referidos.map((r:any) => (
              <TR key={r.id}>
                <TD>
                  <div style={{ fontSize:13, fontWeight:600, color:'#fff' }}>{r.referidor_nombre}</div>
                  <div style={{ fontSize:11, color:'#AE93AA' }}>{r.referidor_cedula}</div>
                </TD>
                <TD>
                  <div style={{ fontSize:13, fontWeight:600, color:'#fff' }}>{r.referido_nombre}</div>
                  <div style={{ fontSize:11, color:'#AE93AA' }}>{r.referido_cedula}</div>
                </TD>
                <TD style={{ color:'#6CC998', fontWeight:700 }}>{fmt(r.comision_valor||1000)}</TD>
                <TD><StatusBadge status={r.status} /></TD>
                <TD style={{ fontSize:11, color:'rgba(255,255,255,.4)' }}>{fmtDate(r.created_at)}</TD>
              </TR>
            ))}
          </Table>
        </Panel>

        {/* Ranking */}
        <Panel>
          <PanelHeader title="Ranking de referidores" icon={<Trophy size={16} />} />
          <div style={{ padding:'10px 0' }}>
            {ranking.length === 0 && (
              <div style={{ textAlign:'center', padding:32, color:'rgba(255,255,255,.3)', fontSize:13 }}>Sin datos aún</div>
            )}
            {ranking.slice(0,10).map((r:any, i:number) => {
              const medalColors = ['#FFD700','#C0C0C0','#CD7F32'];
              return (
                <div key={r.id||i} style={{ display:'flex', alignItems:'center', gap:10, padding:'11px 18px', borderBottom:'1px solid rgba(255,255,255,.04)' }}>
                  <div style={{ width:26, height:26, borderRadius:8, background:i<3?'rgba(133,46,199,.2)':'rgba(255,255,255,.06)', display:'flex', alignItems:'center', justifyContent:'center', fontSize:14, flexShrink:0 }}>
                    {i<3 ? <Medal size={14} color={medalColors[i]} /> : i+1}
                  </div>
                  <div style={{ flex:1, minWidth:0 }}>
                    <div style={{ fontSize:13, fontWeight:700, color:'#fff', overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>{r.nombre}</div>
                    <div style={{ fontSize:10, color:'rgba(255,255,255,.35)' }}>CC {r.cedula} · {r.total_referidos} referido{r.total_referidos!==1?'s':''}</div>
                  </div>
                  <div style={{ textAlign:'right' }}>
                    <div style={{ fontSize:14, fontWeight:800, color: r.total_ganado>0?'#6CC998':'rgba(255,255,255,.3)' }}>{fmt(r.total_ganado||0)}</div>
                    <div style={{ fontSize:9, color:'rgba(255,255,255,.25)' }}>comisiones</div>
                  </div>
                </div>
              );
            })}
          </div>
        </Panel>
      </div>
    </div>
  );
}
