'use client';
import { useState } from 'react';
import { Panel, PanelHeader, Btn } from '@/components/admin/ui';
import toast from 'react-hot-toast';
import { TrendingUp, Lock, Smartphone, AlertTriangle, Settings2, Eye, Check, Pencil, type LucideIcon } from 'lucide-react';

const MOCK_ALERTS: { id:number; tipo:string; titulo:string; desc:string; tiempo:string; icon:LucideIcon; color:string; bg:string }[] = [
  { id:1, tipo:'Alto', titulo:'Alto volumen inusual', desc:"Retiro de $2.800.000 · CC 1023456789 · supera el 90% del límite diario", tiempo:'Hace 8 min', icon:TrendingUp, color:'#C0392B', bg:'rgba(192,57,43,.15)' },
  { id:2, tipo:'Medio', titulo:'Intentos fallidos de PIN', desc:'3 intentos incorrectos · CC 1023456789 · dispositivo Samsung S24', tiempo:'Hace 15 min', icon:Lock, color:'#d4a017', bg:'rgba(212,160,23,.15)' },
  { id:3, tipo:'Info', titulo:'Nuevo dispositivo detectado', desc:'Admin TrendPay · Chrome en MacBook · Medellín, Colombia', tiempo:'Hace 2 h', icon:Smartphone, color:'#852EC7', bg:'rgba(133,46,199,.15)' },
];

export default function AlertasPage() {
  const [alerts, setAlerts] = useState(MOCK_ALERTS);
  const [params, setParams] = useState({ umbral: 2000000, intentos: 3, dispositivos: true });

  function dismiss(id: number) {
    setAlerts(a => a.filter(x => x.id !== id));
    toast.success('Alerta marcada como revisada');
  }

  return (
    <div style={{ display:'flex', flexDirection:'column', gap:16 }}>

      {/* Active alerts */}
      <Panel style={{ border:'1px solid rgba(192,57,43,.25)' }}>
        <PanelHeader title="Alertas de riesgo activas" icon={<AlertTriangle size={16} />} />
        <div style={{ padding:'12px 16px', display:'flex', flexDirection:'column', gap:10 }}>
          {alerts.length === 0 && (
            <div style={{ textAlign:'center', padding:32, color:'rgba(255,255,255,.3)', fontSize:13 }}>Sin alertas activas</div>
          )}
          {alerts.map(a => (
            <div key={a.id} style={{ display:'flex', alignItems:'center', gap:14, padding:'14px 16px', background:'rgba(30,12,65,.5)', borderRadius:12, border:'1px solid rgba(133,46,199,.12)' }}>
              <div style={{ width:44, height:44, borderRadius:12, background:a.bg, display:'flex', alignItems:'center', justifyContent:'center', color:a.color, flexShrink:0 }}><a.icon size={20} /></div>
              <div style={{ flex:1 }}>
                <div style={{ display:'flex', alignItems:'center', gap:10, marginBottom:3 }}>
                  <span style={{ fontSize:14, fontWeight:700, color:'#fff' }}>{a.titulo}</span>
                  <span style={{ fontSize:11, fontWeight:700, background:a.bg, color:a.color, padding:'2px 8px', borderRadius:12 }}>{a.tipo}</span>
                </div>
                <div style={{ fontSize:12, color:'rgba(255,255,255,.6)', marginBottom:3 }}>{a.desc}</div>
                <div style={{ fontSize:11, color:'rgba(255,255,255,.35)' }}>{a.tiempo}</div>
              </div>
              <div style={{ display:'flex', gap:8 }}>
                <Btn variant="ghost" style={{ padding:'6px 10px' }}><Eye size={14} /></Btn>
                <Btn variant="ghost" style={{ padding:'6px 10px' }} onClick={() => dismiss(a.id)}><Check size={14} /></Btn>
              </div>
            </div>
          ))}
        </div>
      </Panel>

      {/* Antifraud params */}
      <Panel>
        <PanelHeader title="Parámetros antifraude" icon={<Settings2 size={16} />} />
        <div style={{ padding:'8px 0' }}>
          {[
            { label:'Umbral de alerta por retiro', sub:'Monto que dispara revisión manual', value:`$${params.umbral.toLocaleString('es-CO')}`, key:'umbral' },
            { label:'Max intentos PIN antes de bloqueo', sub:'Bloqueo temporal de 15 minutos', value:`${params.intentos} intentos`, key:'intentos' },
            { label:'Revisión de nuevos dispositivos', sub:'Requiere 2FA en dispositivos nuevos', value:params.dispositivos?'Activo':'Inactivo', key:'dispositivos' },
          ].map(p => (
            <div key={p.key} style={{ display:'flex', alignItems:'center', justifyContent:'space-between', padding:'16px 20px', borderBottom:'1px solid rgba(255,255,255,.04)' }}>
              <div>
                <div style={{ fontSize:14, fontWeight:600, color:'#fff', marginBottom:3 }}>{p.label}</div>
                <div style={{ fontSize:12, color:'rgba(255,255,255,.4)' }}>{p.sub}</div>
              </div>
              <div style={{ display:'flex', alignItems:'center', gap:10 }}>
                <span style={{ fontSize:13, fontWeight:700, color:'#6CC998' }}>{p.value}</span>
                <Btn variant="ghost" style={{ padding:'5px 8px' }}><Pencil size={14} /></Btn>
              </div>
            </div>
          ))}
        </div>
      </Panel>
    </div>
  );
}
