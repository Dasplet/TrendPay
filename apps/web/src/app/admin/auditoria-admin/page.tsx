'use client';
import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { api } from '@/lib/api';
import { Panel, PanelHeader, Btn } from '@/components/admin/ui';
import toast from 'react-hot-toast';
import { downloadCsv } from '@/lib/exportCsv';
import {
  LogIn, Check, X, CircleDollarSign, UserCheck, Lock, Settings2,
  Landmark, UserPlus, Pencil, UserX, List, Download, Circle, ChevronDown,
  type LucideIcon,
} from 'lucide-react';

const CAMPO_LABELS: Record<string,string> = { nombre:'Nombre', correo:'Correo', celular:'Celular', ciudad:'Ciudad', bloqueado:'Bloqueado', kycNivel:'Nivel KYC', pin:'PIN', habilitado:'Habilitado', status:'Estado' };

function fmtValor(campo: string, v: any) {
  if (v === null || v === undefined || v === '') return '—';
  if (campo === 'bloqueado' || campo === 'habilitado') return v === true || v === 'true' ? 'Sí' : 'No';
  return String(v);
}

// Map actions to icons and colors
const ACTION_STYLE: Record<string,{icon:LucideIcon,color:string,label:string}> = {
  LOGIN:                  { icon:LogIn,            color:'#6CC998', label:'Inicio de sesión'       },
  RETIRO_APROBADO:        { icon:Check,            color:'#6CC998', label:'Retiro aprobado'         },
  RETIRO_RECHAZADO:       { icon:X,                color:'#C0392B', label:'Retiro rechazado'        },
  COMISION_MODIFICADA:    { icon:CircleDollarSign, color:'#d4a017', label:'Comisión modificada'     },
  USUARIO_VERIFICADO_KYC: { icon:UserCheck,        color:'#6CC998', label:'Usuario verificado KYC' },
  BLOQUEO_CUENTA:         { icon:Lock,             color:'#C0392B', label:'Bloqueo de cuenta'      },
  CONFIG_ACTUALIZADA:     { icon:Settings2,        color:'#d4a017', label:'Configuración actualizada'},
  BANCO_TOGGLE:           { icon:Landmark,         color:'#d4a017', label:'Banco deshabilitado'     },
  BANCO_CREAR:            { icon:Landmark,         color:'#6CC998', label:'Banco creado'            },
  CREAR_USUARIO:          { icon:UserPlus,         color:'#852EC7', label:'Usuario creado'          },
  EDITAR_USUARIO:         { icon:Pencil,           color:'#AE93AA', label:'Usuario editado'         },
  ELIMINAR_USUARIO:       { icon:UserX,            color:'#C0392B', label:'Usuario eliminado'       },
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

function AuditLogDetail({ antes, despues, datos }: Readonly<{ antes: any; despues: any; datos: any }>) {
  if (antes || despues) {
    return (
      <div>
        <div style={{ fontSize:11, color:'var(--adm-muted)', textTransform:'uppercase', letterSpacing:'.05em', fontWeight:700, marginBottom:6 }}>Cambios</div>
        <div style={{ display:'grid', gap:4 }}>
          {Object.keys({ ...antes, ...despues }).map(campo => (
            <div key={campo} style={{ display:'grid', gridTemplateColumns:'120px 1fr auto 1fr', alignItems:'center', gap:8, fontSize:12 }}>
              <span style={{ color:'var(--adm-muted)' }}>{CAMPO_LABELS[campo] || campo}</span>
              <span style={{ color:'#ff8f9a', fontFamily:'monospace' }}>{fmtValor(campo, antes?.[campo])}</span>
              <span style={{ color:'var(--adm-muted)' }}>→</span>
              <span style={{ color:'#6CC998', fontFamily:'monospace' }}>{fmtValor(campo, despues?.[campo])}</span>
            </div>
          ))}
        </div>
      </div>
    );
  }
  if (datos && Object.keys(datos).length > 0) {
    return (
      <div>
        <div style={{ fontSize:11, color:'var(--adm-muted)', textTransform:'uppercase', letterSpacing:'.05em', fontWeight:700, marginBottom:6 }}>Detalle</div>
        <pre style={{ margin:0, fontSize:12, color:'rgba(var(--adm-fg-rgb),.75)', fontFamily:'monospace', whiteSpace:'pre-wrap', wordBreak:'break-word' }}>{JSON.stringify(datos, null, 2)}</pre>
      </div>
    );
  }
  return null;
}

function timeAgo(d: string) {
  const diff = Date.now() - new Date(d).getTime();
  if (diff < 60000) return 'Hace unos segundos';
  if (diff < 3600000) return `Hace ${Math.floor(diff/60000)} min`;
  if (diff < 86400000) return `Hace ${Math.floor(diff/3600000)} h`;
  return new Date(d).toLocaleDateString('es-CO', { day:'numeric', month:'short', hour:'2-digit', minute:'2-digit' });
}

export default function AuditoriaAdminPage() {
  const [expanded, setExpanded] = useState<string | null>(null);

  const { data } = useQuery({
    queryKey: ['audit-admin'],
    queryFn: () => api.get('/admin/audit?limit=100').catch(()=>({ data:{ logs:[] }})),
    select: d => d.data,
  });
  const apiLogs: any[] = data?.logs||[];
  const logs = apiLogs.length > 0 ? apiLogs : MOCK;
  const isReal = apiLogs.length > 0;

  function exportarCsv() {
    if (!isReal) return toast.error('Aún no hay registros reales para exportar');
    downloadCsv('auditoria-admin', ['Acción', 'Detalle', 'Realizado por', 'Fecha'],
      logs.map((l: any) => [
        (ACTION_STYLE[l.accion || ''] || { label: l.accion || 'Acción' }).label,
        l.datos ? JSON.stringify(l.datos).slice(0, 200) : l.tabla || '',
        l.user?.nombre || '',
        timeAgo(l.createdAt || l.created_at),
      ]));
  }

  return (
    <Panel>
      <PanelHeader title="Log de auditoría" icon={<List size={16} />}
        actions={<Btn variant="ghost" onClick={exportarCsv}><Download size={13} /> Exportar</Btn>}
      />
      <div style={{ padding:'12px 0' }}>
        {logs.map((l:any)=>{
          const style = ACTION_STYLE[l.accion||''] || { icon:Circle, color:'var(--adm-muted)', label: l.accion||'Acción' };
          const desc  = isReal ? (l.datos?.motivo || l.datos?.banco || l.tabla || '') : l.desc;
          const time  = isReal ? timeAgo(l.createdAt||l.created_at) : l.tiempo;
          const isOpen = expanded === l.id;
          const antes   = l.datos?.antes;
          const despues = l.datos?.despues;
          const hasDetail = isReal;
          const rowContent = (
            <>
              {/* Colored dot */}
              <div style={{ width:8, height:8, borderRadius:'50%', background:style.color, flexShrink:0 }} />
              {/* Icon */}
              <div style={{ width:36, height:36, borderRadius:10, background:`${style.color}18`, display:'flex', alignItems:'center', justifyContent:'center', color:style.color, flexShrink:0 }}>
                <style.icon size={16} />
              </div>
              {/* Content */}
              <div style={{ flex:1 }}>
                <div style={{ fontSize:14, fontWeight:700, color:'var(--adm-text)', marginBottom:3 }}>{style.label}</div>
                <div style={{ fontSize:12, color:'rgba(var(--adm-fg-rgb),.45)' }}>
                  {isReal ? (l.user?.nombre || 'Sistema') : desc}{desc && isReal ? ` · ${desc}` : ''}
                </div>
              </div>
              {/* Time */}
              <div style={{ fontSize:12, color:'rgba(var(--adm-fg-rgb),.3)', whiteSpace:'nowrap', flexShrink:0 }}>{time}</div>
              {hasDetail && (
                <ChevronDown size={16} style={{ color:'var(--adm-muted)', flexShrink:0, transition:'transform .15s', transform: isOpen ? 'rotate(180deg)' : 'none' }} />
              )}
            </>
          );
          return (
            <div key={l.id} style={{ borderBottom:'1px solid rgba(var(--adm-fg-rgb),.04)' }}>
              {hasDetail ? (
                <button
                  type="button"
                  className="adm-audit-row"
                  aria-expanded={isOpen}
                  onClick={() => setExpanded(isOpen ? null : l.id)}
                >
                  {rowContent}
                </button>
              ) : (
                <div style={{ display:'flex', alignItems:'center', gap:16, padding:'16px 24px' }}>
                  {rowContent}
                </div>
              )}

              {isOpen && hasDetail && (
                <div style={{ padding:'0 24px 20px 74px' }}>
                  <div style={{ background:'rgba(var(--adm-card-rgb),.5)', border:'1px solid rgba(133,46,199,.12)', borderRadius:12, padding:'14px 18px', display:'grid', gap:10 }}>
                    <div style={{ display:'flex', flexWrap:'wrap', gap:'6px 24px', fontSize:12 }}>
                      <span><span style={{ color:'var(--adm-muted)' }}>Realizado por: </span><span style={{ color:'var(--adm-text)', fontWeight:600 }}>{l.user?.nombre || 'Sistema'}</span></span>
                      {l.user?.cedula && <span><span style={{ color:'var(--adm-muted)' }}>Cédula: </span><span style={{ color:'var(--adm-text)', fontFamily:'monospace' }}>{l.user.cedula}</span></span>}
                      {l.ip && <span><span style={{ color:'var(--adm-muted)' }}>IP: </span><span style={{ color:'var(--adm-text)', fontFamily:'monospace' }}>{l.ip}</span></span>}
                      {l.registroId && <span><span style={{ color:'var(--adm-muted)' }}>Registro: </span><span style={{ color:'var(--adm-text)', fontFamily:'monospace' }}>{l.registroId}</span></span>}
                    </div>

                    <AuditLogDetail antes={antes} despues={despues} datos={l.datos} />
                  </div>
                </div>
              )}
            </div>
          );
        })}
        {logs.length===0 && <div style={{ textAlign:'center', padding:40, color:'rgba(var(--adm-fg-rgb),.3)', fontSize:13 }}>Sin acciones registradas</div>}
      </div>
    </Panel>
  );
}
