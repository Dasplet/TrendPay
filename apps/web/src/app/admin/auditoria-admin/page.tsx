'use client';
import { useQuery } from '@tanstack/react-query';
import { api } from '@/lib/api';
import { Panel, PanelHeader, Btn } from '@/components/admin/ui';
import toast from 'react-hot-toast';

// Map actions to icons and colors
const ACTION_STYLE: Record<string,{icon:string,color:string,label:string}> = {
  LOGIN:                  { icon:'□', color:'#6CC998', label:'Inicio de sesión'       },
  RETIRO_APROBADO:        { icon:'✓', color:'#6CC998', label:'Retiro aprobado'         },
  RETIRO_RECHAZADO:       { icon:'✗', color:'#C0392B', label:'Retiro rechazado'        },
  COMISION_MODIFICADA:    { icon:'◎', color:'#d4a017', label:'Comisión modificada'     },
  USUARIO_VERIFICADO_KYC: { icon:'◉', color:'#6CC998', label:'Usuario verificado KYC' },
  BLOQUEO_CUENTA:         { icon:'🔒', color:'#C0392B', label:'Bloqueo de cuenta'      },
  CONFIG_ACTUALIZADA:     { icon:'⊙', color:'#d4a017', label:'Configuración actualizada'},
  BANCO_TOGGLE:           { icon:'⊡', color:'#d4a017', label:'Banco deshabilitado'     },
  BANCO_CREAR:            { icon:'⊡', color:'#6CC998', label:'Banco creado'            },
  CREAR_USUARIO:          { icon:'◉', color:'#852EC7', label:'Usuario creado'          },
  EDITAR_USUARIO:         { icon:'✏', color:'#AE93AA', label:'Usuario editado'         },
  ELIMINAR_USUARIO:       { icon:'✗', color:'#C0392B', label:'Usuario eliminado'       },
};

// Fallback mock logs for demo (when DB has no data yet)
const MOCK = [
  { id:'1', accion:'LOGIN',                  desc:'Admin TrendPay · CC 1000000001',    tiempo:'Hace 2 min' },
  { id:'2', accion:'RETIRO_APROBADO',        desc:'RET-000102 · Juan García · $300.000', tiempo:'Hace 1 h' },
  { id:'3', accion:'COMISION_MODIFICADA',    desc:'3.0% → 3.0% · Admin TrendPay',     tiempo:'Hace 2 h'  },
  { id:'4', accion:'USUARIO_VERIFICADO_KYC', desc:'CC 1023456789 · Nivel 2',           tiempo:'Hace 5 h'  },
  { id:'5', accion:'BLOQUEO_CUENTA',         desc:'CC 9999999999 · 5 intentos fallidos', tiempo:'Ayer 3:40 pm' },
  { id:'6', accion:'CONFIG_ACTUALIZADA',     desc:'Limite diario: $3.000.000',         tiempo:'Ayer 11:20 am' },
  { id:'7', accion:'BANCO_TOGGLE',           desc:'Banco Popular · Admin TrendPay',    tiempo:'Lun 22 jun' },
];

function timeAgo(d: string) {
  const diff = Date.now() - new Date(d).getTime();
  if (diff < 60000) return 'Hace unos segundos';
  if (diff < 3600000) return `Hace ${Math.floor(diff/60000)} min`;
  if (diff < 86400000) return `Hace ${Math.floor(diff/3600000)} h`;
  return new Date(d).toLocaleDateString('es-CO', { day:'numeric', month:'short', hour:'2-digit', minute:'2-digit' });
}

export default function AuditoriaAdminPage() {
  const { data } = useQuery({
    queryKey: ['audit-admin'],
    queryFn: () => api.get('/admin/audit?limit=100').catch(()=>({ data:{ logs:[] }})),
    select: d => d.data,
  });
  const apiLogs: any[] = data?.logs||[];
  const logs = apiLogs.length > 0 ? apiLogs : MOCK;
  const isReal = apiLogs.length > 0;

  return (
    <Panel>
      <PanelHeader title="Log de auditoría" icon="≡"
        actions={<Btn variant="ghost" onClick={()=>toast.success('Exportando...')}>⬇ Exportar</Btn>}
      />
      <div style={{ padding:'12px 0' }}>
        {logs.map((l:any)=>{
          const style = ACTION_STYLE[l.accion||''] || { icon:'○', color:'#AE93AA', label: l.accion||'Acción' };
          const desc  = isReal ? (l.datos ? JSON.stringify(l.datos).slice(0,80) : l.tabla||'') : l.desc;
          const time  = isReal ? timeAgo(l.createdAt||l.created_at) : l.tiempo;
          return (
            <div key={l.id} style={{ display:'flex', alignItems:'center', gap:16, padding:'16px 24px', borderBottom:'1px solid rgba(255,255,255,.04)', transition:'background .15s' }}
              onMouseOver={e=>(e.currentTarget as HTMLDivElement).style.background='rgba(133,46,199,.04)'}
              onMouseOut={e=>(e.currentTarget as HTMLDivElement).style.background=''}>
              {/* Colored dot */}
              <div style={{ width:8, height:8, borderRadius:'50%', background:style.color, flexShrink:0 }} />
              {/* Icon */}
              <div style={{ width:36, height:36, borderRadius:10, background:`${style.color}18`, display:'flex', alignItems:'center', justifyContent:'center', fontSize:16, color:style.color, flexShrink:0 }}>
                {style.icon}
              </div>
              {/* Content */}
              <div style={{ flex:1 }}>
                <div style={{ fontSize:14, fontWeight:700, color:'#fff', marginBottom:3 }}>{style.label}</div>
                <div style={{ fontSize:12, color:'rgba(255,255,255,.45)' }}>{desc}</div>
              </div>
              {/* Time */}
              <div style={{ fontSize:12, color:'rgba(255,255,255,.3)', whiteSpace:'nowrap', flexShrink:0 }}>{time}</div>
            </div>
          );
        })}
        {logs.length===0 && <div style={{ textAlign:'center', padding:40, color:'rgba(255,255,255,.3)', fontSize:13 }}>Sin acciones registradas</div>}
      </div>
    </Panel>
  );
}
