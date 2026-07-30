'use client';
import { useQuery } from '@tanstack/react-query';
import { adminApi } from '@/lib/api';
import { MetricCard, Panel, PanelHeader, Btn, fmt } from '@/components/admin/ui';
import { useState } from 'react';
import toast from 'react-hot-toast';

export default function ComisionesPage() {
  const { data } = useQuery({ queryKey:['admin-metrics'], queryFn:()=>adminApi.metrics(), select:d=>d.data });
  const { data: txData } = useQuery({ queryKey:['admin-tx-all'], queryFn:()=>adminApi.transactions({ limit:500 }), select:d=>d.data });

  const m   = data?.metricas || {};
  const txs = txData?.transacciones || [];
  const [com, setCom] = useState(3);

  const bycat: Record<string,number> = {};
  txs.forEach((t:any) => {
    const cat = t.categoria||'otros';
    bycat[cat] = (bycat[cat]||0) + parseFloat(t.comision_valor||0);
  });

  const catLabels: Record<string,string> = { consigna:'Consignaciones', cobro_qr:'Cobros QR', retiro:'Retiros', envio:'Envíos' };

  return (
    <div style={{ display:'flex', flexDirection:'column', gap:16 }}>
      <div style={{ display:'grid', gridTemplateColumns:'repeat(3,1fr)', gap:14 }}>
        <MetricCard icon="◎" value={fmt(m.total_comisiones||0)} label="Total comisiones cobradas" color="#6CC998" bg="rgba(108,201,152,.2)" />
        <MetricCard icon="%" value={`${com}%`} label="Tasa de comisión actual" color="#852EC7" bg="rgba(133,46,199,.2)" />
        <MetricCard icon="⊡" value={fmt(m.total_volumen||0)} label="Volumen base para comisión" color="#d4a017" bg="rgba(212,160,23,.2)" />
      </div>

      <div style={{ display:'grid', gridTemplateColumns:'1.6fr 1fr', gap:14 }}>
        <Panel>
          <PanelHeader title="Comisión por categoría" icon="⊟" />
          <div style={{ padding:'8px 0' }}>
            {Object.entries(bycat).map(([cat, val]) => (
              <div key={cat} style={{ display:'flex', justifyContent:'space-between', alignItems:'center', padding:'14px 20px', borderBottom:'1px solid rgba(255,255,255,.04)' }}>
                <span style={{ fontSize:14, color:'rgba(255,255,255,.8)' }}>{catLabels[cat]||cat}</span>
                <span style={{ fontSize:16, fontWeight:700, color:'#6CC998' }}>{fmt(val)}</span>
              </div>
            ))}
            {Object.keys(bycat).length === 0 && (
              <div style={{ textAlign:'center', padding:32, color:'rgba(255,255,255,.3)', fontSize:13 }}>Sin datos de comisiones</div>
            )}
          </div>
        </Panel>

        <Panel>
          <PanelHeader title="Configurar comisión" icon="⊙" />
          <div style={{ padding:20 }}>
            <div style={{ fontSize:13, color:'#AE93AA', marginBottom:16 }}>Porcentaje aplicado a todas las transacciones</div>
            <div style={{ display:'flex', alignItems:'center', gap:10, marginBottom:20 }}>
              <input type="number" value={com} onChange={e => setCom(parseFloat(e.target.value)||0)} min={0} max={20} step={0.5}
                style={{ width:80, background:'rgba(30,12,65,.7)', border:'1.5px solid rgba(133,46,199,.3)', borderRadius:10, padding:'10px 14px', fontSize:24, fontWeight:700, color:'#fff', outline:'none', textAlign:'center' }} />
              <span style={{ fontSize:24, color:'#AE93AA', fontWeight:700 }}>%</span>
            </div>
            <Btn variant="primary" style={{ width:'100%', justifyContent:'center' }} onClick={() => toast.success('Comisión actualizada al '+com+'%')}>
              ✓ Guardar comisión
            </Btn>
            <div style={{ fontSize:11, color:'rgba(255,255,255,.3)', textAlign:'center', marginTop:10 }}>
              Se aplica automáticamente a todas las operaciones
            </div>
          </div>
        </Panel>
      </div>
    </div>
  );
}
