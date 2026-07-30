'use client';
import { Panel, PanelHeader, Btn } from '@/components/admin/ui';
import toast from 'react-hot-toast';

const EXPORTS = [
  { icon:'⇄', label:'Transacciones — Mes actual',  desc:'Solo las TX del mes en curso',         period:'current' },
  { icon:'⇄', label:'Transacciones — 6 meses',     desc:'Últimos 6 meses de operaciones',        period:'6m'     },
  { icon:'⇄', label:'Transacciones — 12 meses',    desc:'Historial del último año',              period:'12m'    },
  { icon:'◉', label:'Lista de usuarios',            desc:'Datos, saldos y KYC de todos',          period:'users'  },
  { icon:'◎', label:'Reporte de comisiones',        desc:'Comisiones generadas por período',      period:'com'    },
  { icon:'◈', label:'Referidos',                    desc:'Relaciones de referido y comisiones',   period:'ref'    },
  { icon:'⊏', label:'Cola de retiros',              desc:'Retiros pendientes y procesados',       period:'wd'     },
];

const REGULATORY = [
  { icon:'◎', label:'Informe UIAF mensual',  desc:'Operaciones inusuales · Superfinanciera', color:'#C0392B' },
  { icon:'⊟', label:'Declaración DIAN',      desc:'Compatibilidad tributaria',               color:'#d4a017' },
  { icon:'↑', label:'Informe de actividad',  desc:'Resumen operacional del período',         color:'#852EC7' },
  { icon:'◎', label:'Reporte de saldos',     desc:'Saldos totales en plataforma',            color:'#6CC998' },
];

function download(label: string, type: string) {
  toast.success(`Generando ${label} en formato ${type}...`);
}

export default function ReportesPage() {
  return (
    <div style={{ display:'grid', gridTemplateColumns:'1.4fr 1fr', gap:16 }}>

      {/* Exports */}
      <Panel>
        <PanelHeader title="Exportación de datos" icon="⊟" />
        <div style={{ padding:'8px 0' }}>
          {EXPORTS.map(e => (
            <div key={e.label} style={{ display:'flex', alignItems:'center', gap:14, padding:'14px 20px', borderBottom:'1px solid rgba(255,255,255,.04)' }}>
              <div style={{ width:36, height:36, borderRadius:10, background:'rgba(133,46,199,.15)', display:'flex', alignItems:'center', justifyContent:'center', fontSize:18, color:'#852EC7', flexShrink:0 }}>
                {e.icon}
              </div>
              <div style={{ flex:1 }}>
                <div style={{ fontSize:13, fontWeight:600, color:'#fff', marginBottom:2 }}>{e.label}</div>
                <div style={{ fontSize:11, color:'#AE93AA' }}>{e.desc}</div>
              </div>
              <div style={{ display:'flex', gap:6 }}>
                <Btn variant="ghost" onClick={() => download(e.label,'CSV')} style={{ fontSize:11, padding:'5px 10px' }}>📄 CSV</Btn>
                <Btn variant="ghost" onClick={() => download(e.label,'Excel')} style={{ fontSize:11, padding:'5px 10px' }}>📋 Excel</Btn>
              </div>
            </div>
          ))}
        </div>
      </Panel>

      {/* Regulatory */}
      <Panel>
        <PanelHeader title="Reportes regulatorios" icon="⊟" />
        <div style={{ padding:'8px 0' }}>
          {REGULATORY.map(r => (
            <div key={r.label} style={{ display:'flex', alignItems:'center', gap:12, padding:'14px 20px', borderBottom:'1px solid rgba(255,255,255,.04)' }}>
              <div style={{ width:36, height:36, borderRadius:10, background:`${r.color}20`, display:'flex', alignItems:'center', justifyContent:'center', fontSize:18, color:r.color, flexShrink:0 }}>
                {r.icon}
              </div>
              <div style={{ flex:1 }}>
                <div style={{ fontSize:13, fontWeight:600, color:'#fff', marginBottom:2 }}>{r.label}</div>
                <div style={{ fontSize:11, color:'#AE93AA' }}>{r.desc}</div>
              </div>
              <div style={{ display:'flex', gap:6 }}>
                <Btn variant="ghost" onClick={() => download(r.label,'CSV')} style={{ fontSize:11, padding:'5px 10px' }}>📄 CSV</Btn>
                <Btn variant="ghost" onClick={() => download(r.label,'Excel')} style={{ fontSize:11, padding:'5px 10px' }}>📋 Excel</Btn>
              </div>
            </div>
          ))}
        </div>
      </Panel>
    </div>
  );
}
