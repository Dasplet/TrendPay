'use client';
import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { adminApi } from '@/lib/api';
import { Panel, PanelHeader, Avatar, Btn } from '@/components/admin/ui';
import toast from 'react-hot-toast';
import { Settings2, ShieldCheck, Check } from 'lucide-react';

function ParamRow({ label, sub, value, onChange }: any) {
  const [editing, setEditing] = useState(false);
  const [val, setVal] = useState(value);
  return (
    <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between', padding:'18px 24px', borderBottom:'1px solid rgba(var(--adm-fg-rgb),.05)' }}>
      <div>
        <div style={{ fontSize:14, fontWeight:600, color:'var(--adm-text)', marginBottom:3 }}>{label}</div>
        <div style={{ fontSize:12, color:'rgba(var(--adm-fg-rgb),.4)' }}>{sub}</div>
      </div>
      <div style={{ display:'flex', alignItems:'center', gap:10 }}>
        {editing ? (
          <input value={val} onChange={e=>setVal(e.target.value)} onBlur={()=>{setEditing(false);onChange(val);}}
            style={{ width:80, background:'rgba(var(--adm-card-rgb),.8)', border:'1.5px solid #852EC7', borderRadius:8, padding:'6px 10px', fontSize:14, fontWeight:700, color:'var(--adm-text)', textAlign:'center', outline:'none' }} autoFocus />
        ) : (
          <div style={{ background:'rgba(var(--adm-card-rgb),.7)', border:'1px solid rgba(133,46,199,.2)', borderRadius:8, padding:'6px 14px', fontSize:14, fontWeight:700, color:'var(--adm-text)', minWidth:80, textAlign:'center', cursor:'pointer' }} onClick={()=>setEditing(true)}>
            {val}
          </div>
        )}
        <button onClick={()=>{setEditing(false);onChange(val);toast.success('Guardado');}} style={{ width:32, height:32, borderRadius:8, background:'rgba(133,46,199,.2)', border:'1px solid rgba(133,46,199,.3)', color:'#c088f0', cursor:'pointer', display:'flex', alignItems:'center', justifyContent:'center' }}><Check size={16} /></button>
      </div>
    </div>
  );
}

export default function ConfiguracionPage() {
  const [cfg, setCfg] = useState({ comision:'3', limite_diario:'3.0M', limite_mensual:'20M', retiros_gratuitos:'2' });
  const { data } = useQuery({ queryKey:['admin-users'], queryFn:()=>adminApi.users({ limit:200 }), select:d=>d.data });
  const users: any[] = data?.usuarios||[];

  const ROLES = ['Usuario','Administrador','Super Admin','Operador'];

  return (
    <div style={{ display:'grid', gridTemplateColumns:'1.2fr 1fr', gap:16 }}>
      <Panel>
        <PanelHeader title="Parámetros del sistema" icon={<Settings2 size={16} />} />
        <ParamRow label="Comisión por transacción" sub="Se aplica a todas las operaciones" value={cfg.comision} onChange={(v:string)=>setCfg(p=>({...p,comision:v}))} />
        <ParamRow label="Límite diario de retiro"  sub="Por usuario · Superfinanciera"    value={cfg.limite_diario} onChange={(v:string)=>setCfg(p=>({...p,limite_diario:v}))} />
        <ParamRow label="Límite mensual de retiro" sub="Por usuario · Superfinanciera"    value={cfg.limite_mensual} onChange={(v:string)=>setCfg(p=>({...p,limite_mensual:v}))} />
        <ParamRow label="Retiros gratuitos por mes" sub="Primeros N retiros sin comisión" value={cfg.retiros_gratuitos} onChange={(v:string)=>setCfg(p=>({...p,retiros_gratuitos:v}))} />
      </Panel>

      <Panel>
        <PanelHeader title="Roles y accesos" icon={<ShieldCheck size={16} />} />
        <div style={{ padding:'8px 0', maxHeight:500, overflowY:'auto' }}>
          {users.map((u:any)=>(
            <div key={u.id} style={{ display:'flex', alignItems:'center', gap:12, padding:'12px 20px', borderBottom:'1px solid rgba(var(--adm-fg-rgb),.04)' }}>
              <div style={{ flexShrink:0 }}><Avatar name={u.nombre||'?'} size={36} /></div>
              <div style={{ flex:1, minWidth:0 }}>
                <div style={{ fontSize:13, fontWeight:600, color:'var(--adm-text)', overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>{u.nombre}</div>
                <div style={{ fontSize:11, color:'var(--adm-muted)', overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>CC {u.cedula}</div>
              </div>
              <select defaultValue={u.rol==='admin'?'Super Admin':'Usuario'}
                onChange={e=>toast.success(`Rol de ${u.nombre?.split(' ')[0]} actualizado a ${e.target.value}`)}
                style={{ flexShrink:0, width:150, background:'rgba(var(--adm-card-rgb),.7)', border:'1px solid rgba(133,46,199,.2)', borderRadius:8, padding:'6px 10px', fontSize:12, color:'var(--adm-text)', cursor:'pointer', outline:'none' }}>
                {ROLES.map(r=><option key={r}>{r}</option>)}
              </select>
            </div>
          ))}
          {users.length===0 && <div style={{ textAlign:'center', padding:32, color:'rgba(var(--adm-fg-rgb),.3)', fontSize:13 }}>Sin usuarios</div>}
        </div>
      </Panel>
    </div>
  );
}
