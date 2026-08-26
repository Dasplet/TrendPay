'use client';
import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { adminApi } from '@/lib/api';
import { Panel, PanelHeader, Table, TR, TD, StatusBadge, fmt, fmtDate } from '@/components/admin/ui';
import { LineChart, Line, BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer } from 'recharts';
import { TrendingUp, CircleDollarSign, Users, Clock, PieChart, ArrowLeftRight, Download, Check, Activity } from 'lucide-react';

function MetricCard({ icon, value, label, color, badge }: any) {
  const gradients: Record<string, string> = {
    purple: 'linear-gradient(135deg, #5b2d8e 0%, #3d1a6e 100%)',
    blue:   'linear-gradient(135deg, #1a3a6e 0%, #112550 100%)',
    green:  'linear-gradient(135deg, #1a4a3a 0%, #0f3028 100%)',
    red:    'linear-gradient(135deg, #5a1a2a 0%, #3d0f1a 100%)',
  };
  const bgs: Record<string, string> = {
    purple:'rgba(133,46,199,.25)',blue:'rgba(30,80,180,.25)',green:'rgba(30,120,80,.25)',red:'rgba(150,30,60,.25)',
  };
  return (
    <div style={{ background:gradients[color]||gradients.purple, borderRadius:16, padding:'28px 24px', position:'relative', overflow:'hidden', border:'1px solid rgba(var(--adm-fg-rgb),.05)' }}>
      <div style={{ position:'absolute', top:-30, right:-30, width:120, height:120, borderRadius:'50%', background:bgs[color]||bgs.purple }} />
      <div style={{ width:44, height:44, borderRadius:12, background:bgs[color]||bgs.purple, display:'flex', alignItems:'center', justifyContent:'center', fontSize:22, marginBottom:18, position:'relative' }}>{icon}</div>
      <div style={{ fontSize:32, fontWeight:900, color:'var(--adm-text)', letterSpacing:'-1px', marginBottom:4, position:'relative' }}>{value}</div>
      <div style={{ fontSize:13, color:'rgba(var(--adm-fg-rgb),.6)', position:'relative' }}>{label}</div>
      {badge && <div style={{ marginTop:10, display:'inline-flex', alignItems:'center', gap:5, background:'rgba(108,201,152,.2)', color:'#6CC998', padding:'3px 10px', borderRadius:20, fontSize:11, fontWeight:600 }}><Check size={12} /> {badge}</div>}
    </div>
  );
}

function ChartTooltip({ active, payload, label }: any) {
  if (!active||!payload?.length) return null;
  return (
    <div style={{ background:'rgba(20,10,50,.97)', border:'1px solid rgba(133,46,199,.35)', borderRadius:10, padding:'10px 14px', fontSize:12 }}>
      <div style={{ color:'var(--adm-muted)', marginBottom:6 }}>{label}</div>
      {payload.map((p:any)=><div key={p.name} style={{ color:p.color, fontWeight:600 }}>{p.name}: {fmt(p.value||0)}</div>)}
    </div>
  );
}

export default function AdminDashboard() {
  const [period, setPeriod] = useState('6');
  const { data:metricsData } = useQuery({ queryKey:['admin-metrics'], queryFn:()=>adminApi.metrics(), select:d=>d.data });
  const { data:txData }      = useQuery({ queryKey:['admin-tx'],      queryFn:()=>adminApi.transactions({ limit:300 }), select:d=>d.data });
  const { data:usersData }   = useQuery({ queryKey:['admin-users'],   queryFn:()=>adminApi.users({ limit:200 }), select:d=>d.data });
  const { data:chartData }   = useQuery({ queryKey:['admin-chart',period], queryFn:()=>adminApi.chart(period), select:d=>d.data });

  const m=metricsData?.metricas||{}, txs=txData?.transacciones||[], users=usersData?.usuarios||[];
  const totalSaldo=users.reduce((s:number,u:any)=>s+(Number.parseFloat(u.saldo)||0),0);
  const meses=['ene','feb','mar','abr','may','jun','jul','ago','sep','oct','nov','dic'];
  const now=new Date();

  function buildData() {
    if (period==='current') {
      const year=now.getFullYear(),month=now.getMonth(),today=now.getDate();
      const days=new Date(year,month+1,0).getDate();
      const b:any[]=[];
      for(let d=1;d<=days;d++) b.push({name:d===1?`1 ${meses[month]}`:String(d),vol:0,com:0,consigna:0,cobro:0,envio:0,retiro:0,future:d>today});
      txs.forEach((t:any)=>{
        if(!t.created_at)return;
        const d=new Date(t.created_at);
        if(d.getFullYear()!==year||d.getMonth()!==month)return;
        const idx=d.getDate()-1,vol=Math.abs(Number.parseFloat(t.monto_neto)||0);
        b[idx].vol+=vol;b[idx].com+=Number.parseFloat(t.comision_valor||0);
        const cat=(t.categoria||'').toLowerCase();
        if(cat.includes('consign'))b[idx].consigna+=vol;
        else if(cat.includes('cobro'))b[idx].cobro+=vol;
        else if(cat.includes('envi'))b[idx].envio+=vol;
        else if(cat.includes('retiro'))b[idx].retiro+=vol;
        else b[idx].consigna+=vol;
      });
      return b.map(x=>({...x,vol:x.future?null:x.vol,com:x.future?null:x.com}));
    }
    const months=Number.parseInt(period)||6;
    const bk:Record<string,any>={};
    for(let i=months-1;i>=0;i--){
      const d=new Date(now.getFullYear(),now.getMonth()-i,1);
      const key=`${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}`;
      bk[key]={name:`${meses[d.getMonth()]} ${d.getFullYear()}`,vol:0,com:0,consigna:0,cobro:0,envio:0,retiro:0};
    }
    if(chartData?.datos?.length) chartData.datos.forEach((d:any)=>{if(bk[d.mes]){bk[d.mes].vol=d.volumen;bk[d.mes].com=d.comisiones;}});
    txs.forEach((t:any)=>{
      if(!t.created_at)return;
      const d=new Date(t.created_at);
      const key=`${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}`;
      if(!bk[key])return;
      const vol=Math.abs(Number.parseFloat(t.monto_neto)||0);
      if(!chartData?.datos?.length){bk[key].vol+=vol;bk[key].com+=Number.parseFloat(t.comision_valor||0);}
      const cat=(t.categoria||'').toLowerCase();
      if(cat.includes('consign'))bk[key].consigna+=vol;
      else if(cat.includes('cobro'))bk[key].cobro+=vol;
      else if(cat.includes('envi'))bk[key].envio+=vol;
      else if(cat.includes('retiro'))bk[key].retiro+=vol;
      else bk[key].consigna+=vol;
    });
    return Object.values(bk);
  }

  const pts=buildData();
  const fmtAxis=(v:number)=>v>=1000000?`$${(v/1000000).toFixed(1)}M`:v>=1000?`$${Math.round(v/1000)}k`:'$0';
  const barColors=['#852EC7','#6CC998','var(--adm-muted)','#C0392B','#d4a017','#4a90d9','#e87575','#7cc47c'];
  const step=period==='current'?Math.ceil(pts.length/10)-1:0;

  return (
    <div style={{ display:'flex', flexDirection:'column', gap:16 }}>
      <div style={{ display:'grid', gridTemplateColumns:'repeat(4,1fr)', gap:14 }}>
        <MetricCard color="purple" icon={<TrendingUp size={22} />} value={fmt(m.total_volumen||0)} label="Volumen total procesado" />
        <MetricCard color="blue"   icon={<CircleDollarSign size={22} />} value={fmt(m.total_comisiones||0)} label={`Comisiones generadas (${m.comision_pct||3}%)`} />
        <MetricCard color="green"  icon={<Users size={22} />} value={String(users.length)} label="Usuarios registrados" />
        <MetricCard color="red"    icon={<Clock size={22} />} value={String(m.retiros_pendientes||0)} label="Retiros pendientes" badge={!m.retiros_pendientes?'Al día':undefined} />
      </div>

      <Panel>
        <PanelHeader title="Volumen mensual" icon={<TrendingUp size={16} />}
          actions={<>
            <select value={period} onChange={e=>setPeriod(e.target.value)} style={{ background:'rgba(var(--adm-card-rgb),.6)', border:'1px solid rgba(133,46,199,.2)', borderRadius:8, padding:'5px 10px', fontSize:11, color:'var(--adm-text)', cursor:'pointer' }}>
              <option value="6">Últimos 6 meses</option>
              <option value="12">Últimos 12 meses</option>
              <option value="current">Mes actual</option>
            </select>
            <button style={{ background:'rgba(133,46,199,.1)', border:'1px solid rgba(133,46,199,.25)', borderRadius:8, padding:'5px 12px', fontSize:11, color:'#c088f0', cursor:'pointer', display:'inline-flex', alignItems:'center', gap:5 }}><Download size={12} /> .xlsx</button>
          </>}
        />
        <div style={{ padding:'16px 18px 10px', height:280 }}>
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={pts} margin={{ top:10, right:20, left:10, bottom:5 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="rgba(var(--adm-fg-rgb),.04)" />
              <XAxis dataKey="name" tick={{ fill:'rgba(var(--adm-muted-rgb),.55)', fontSize:10 }} axisLine={false} tickLine={false} interval={step} />
              <YAxis tickFormatter={fmtAxis} tick={{ fill:'rgba(var(--adm-muted-rgb),.55)', fontSize:10 }} axisLine={false} tickLine={false} />
              <Tooltip content={<ChartTooltip />} />
              <Legend wrapperStyle={{ fontSize:11, color:'rgba(var(--adm-muted-rgb),.8)', paddingTop:8 }} />
              <Line type="monotone" dataKey="vol" name="Volumen" stroke="#852EC7" strokeWidth={2.5} dot={{ r:4, fill:'#852EC7', stroke:'#fff', strokeWidth:2 }} activeDot={{ r:6 }} connectNulls={false} />
              <Line type="monotone" dataKey="com" name="Comisiones" stroke="#6CC998" strokeWidth={2} dot={{ r:3, fill:'#6CC998', stroke:'#fff', strokeWidth:1.5 }} connectNulls={false} />
            </LineChart>
          </ResponsiveContainer>
        </div>
      </Panel>

      <Panel>
        <PanelHeader title="Distribución de operaciones por tipo" icon={<PieChart size={16} />}
          actions={<div style={{ display:'flex', gap:14, fontSize:11, color:'var(--adm-muted)' }}>
            {[['#852EC7','Consignas'],['#6CC998','Cobros QR'],['var(--adm-muted)','Envíos'],['#C0392B','Retiros']].map(([c,l])=>(
              <span key={l} style={{ display:'flex', alignItems:'center', gap:5 }}><span style={{ width:10,height:10,borderRadius:3,background:c as string,display:'inline-block' }}/>{l}</span>
            ))}
          </div>}
        />
        <div style={{ padding:'16px 18px 10px', height:220 }}>
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={pts} margin={{ top:5, right:20, left:10, bottom:5 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="rgba(var(--adm-fg-rgb),.04)" />
              <XAxis dataKey="name" tick={{ fill:'rgba(var(--adm-muted-rgb),.55)', fontSize:10 }} axisLine={false} tickLine={false} interval={step} />
              <YAxis tickFormatter={fmtAxis} tick={{ fill:'rgba(var(--adm-muted-rgb),.55)', fontSize:10 }} axisLine={false} tickLine={false} />
              <Tooltip content={<ChartTooltip />} />
              <Bar dataKey="consigna" name="Consignas" stackId="a" fill="rgba(133,46,199,.85)" />
              <Bar dataKey="cobro"    name="Cobros QR" stackId="a" fill="rgba(108,201,152,.85)" />
              <Bar dataKey="envio"    name="Envíos"    stackId="a" fill="rgba(var(--adm-muted-rgb),.75)" />
              <Bar dataKey="retiro"   name="Retiros"   stackId="a" fill="rgba(192,57,43,.85)" radius={[3,3,0,0]} />
            </BarChart>
          </ResponsiveContainer>
        </div>
      </Panel>

      <div style={{ display:'grid', gridTemplateColumns:'1.6fr 1fr', gap:14 }}>
        <Panel>
          <PanelHeader title="Saldos en plataforma" icon={<CircleDollarSign size={16} />} />
          <div style={{ padding:'16px 20px' }}>
            <div style={{ fontSize:28, fontWeight:900, color:'var(--adm-text)', letterSpacing:'-.5px', marginBottom:2 }}>{fmt(totalSaldo)}</div>
            <div style={{ fontSize:11, color:'var(--adm-muted)', marginBottom:16 }}>Total en billeteras activas</div>
            {users.slice(0,8).map((u:any,i:number)=>{
              const saldo=Number.parseFloat(u.saldo)||0,pct=totalSaldo>0?Math.round(saldo/totalSaldo*100):0;
              return (
                <div key={u.id} style={{ marginBottom:12 }}>
                  <div style={{ display:'flex', justifyContent:'space-between', fontSize:12, marginBottom:4 }}>
                    <span style={{ color:'rgba(var(--adm-fg-rgb),.7)' }}>{u.nombre?.split(' ')[0]||'—'}</span>
                    <span style={{ color:barColors[i%barColors.length], fontWeight:700 }}>{fmt(saldo)}</span>
                  </div>
                  <div style={{ height:3, background:'rgba(var(--adm-fg-rgb),.07)', borderRadius:2, overflow:'hidden' }}>
                    <div style={{ height:'100%', width:`${pct}%`, background:barColors[i%barColors.length], borderRadius:2 }} />
                  </div>
                </div>
              );
            })}
          </div>
        </Panel>
        <Panel>
          <PanelHeader title="Estado del sistema" icon={<Activity size={16} />} />
          <div style={{ padding:'8px 0' }}>
            {[['API Backend'],['Base de datos'],['ACH Colombia'],['Rapyd'],['PSE Débito']].map(([n])=>(
              <div key={n} style={{ display:'flex', justifyContent:'space-between', alignItems:'center', padding:'13px 20px', borderBottom:'1px solid rgba(var(--adm-fg-rgb),.04)' }}>
                <span style={{ fontSize:13, color:'rgba(var(--adm-fg-rgb),.75)' }}>{n}</span>
                <span style={{ display:'flex', alignItems:'center', gap:6, fontSize:12, fontWeight:600, color:'#6CC998' }}>
                  <span style={{ width:7,height:7,borderRadius:'50%',background:'#6CC998',display:'inline-block' }}/>Operando
                </span>
              </div>
            ))}
          </div>
        </Panel>
      </div>

      <Panel>
        <PanelHeader title="Transacciones recientes" icon={<ArrowLeftRight size={16} />}
          actions={<a href="/admin/transacciones" style={{ fontSize:12, color:'var(--adm-text)', textDecoration:'none', fontWeight:600, background:'rgba(133,46,199,.2)', border:'1px solid rgba(133,46,199,.3)', borderRadius:8, padding:'6px 14px' }}>Ver todas →</a>}
        />
        <Table headers={['Referencia','Descripción','Usuario','Monto','Estado','Fecha']}>
          {txs.length===0 ? (
            <TR><TD style={{ textAlign:'center', padding:32, color:'rgba(var(--adm-fg-rgb),.3)' }} colSpan={6 as any}>Sin transacciones</TD></TR>
          ):txs.slice(0,8).map((t:any)=>(
            <TR key={t.id}>
              <TD style={{ fontFamily:'monospace', fontSize:11, color:'rgba(var(--adm-fg-rgb),.4)' }}>{(t.codigo||'—').slice(0,14)}</TD>
              <TD style={{ fontSize:12, maxWidth:280, overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>{t.descripcion}</TD>
              <TD style={{ fontSize:12, color:'rgba(var(--adm-fg-rgb),.65)' }}>{(t.usuario_nombre||'—').split(' ')[0]}</TD>
              <TD style={{ fontWeight:700, color:Number.parseFloat(t.monto_neto)>=0?'#6CC998':'#C0392B' }}>{fmt(t.monto_neto||0)}</TD>
              <TD><StatusBadge status={t.status} /></TD>
              <TD style={{ fontSize:11, color:'rgba(var(--adm-fg-rgb),.4)', whiteSpace:'nowrap' }}>{fmtDate(t.created_at)}</TD>
            </TR>
          ))}
        </Table>
      </Panel>
    </div>
  );
}
