'use client';
import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '@/lib/api';
import { Bell, CheckCheck, X, AlertTriangle, CheckCircle, Info, Clock } from 'lucide-react';

function timeAgo(d: string) {
  const diff = Date.now() - new Date(d).getTime();
  if (diff < 60000) return 'Hace unos segundos';
  if (diff < 3600000) return `Hace ${Math.floor(diff/60000)} min`;
  if (diff < 86400000) return `Hace ${Math.floor(diff/3600000)} h`;
  return new Date(d).toLocaleDateString('es-CO', { day:'numeric', month:'short', hour:'2-digit', minute:'2-digit' });
}

const TIPO: Record<string, any> = {
  ok:      { icon: CheckCircle,   color:'#6CC998', bg:'rgba(108,201,152,.15)' },
  warning: { icon: AlertTriangle, color:'#d4a017', bg:'rgba(212,160,23,.15)'  },
  info:    { icon: Info,          color:'#852EC7', bg:'rgba(133,46,199,.15)'  },
  error:   { icon: AlertTriangle, color:'#C0392B', bg:'rgba(192,57,43,.15)'   },
};

export function NotificationBell() {
  const [open, setOpen] = useState(false);
  const qc = useQueryClient();

  const { data } = useQuery({
    queryKey: ['admin-notifs'],
    queryFn:  () => api.get('/admin/notifications'),
    select:   d => d.data,
    refetchInterval: 30000,
  });

  const markRead = useMutation({
    mutationFn: () => api.put('/admin/notifications/read'),
    onSuccess:  () => qc.invalidateQueries({ queryKey:['admin-notifs'] }),
  });

  const notifs: any[] = data?.notificaciones || [];
  const unread: number = data?.sin_leer || 0;

  return (
    <div style={{ position:'relative' }}>
      <button onClick={() => setOpen(!open)}
        style={{ width:38, height:38, borderRadius:11, background:'rgba(133,46,199,.1)', border:'1px solid rgba(133,46,199,.2)', color:'rgba(255,255,255,.7)', cursor:'pointer', display:'flex', alignItems:'center', justifyContent:'center', position:'relative' }}>
        <Bell size={17}/>
        {unread > 0 && <span style={{ position:'absolute', top:6, right:6, width:8, height:8, borderRadius:'50%', background:'#C0392B', border:'2px solid #16123a' }}/>}
      </button>

      {open && (
        <>
          <div style={{ position:'fixed', inset:0, zIndex:49 }} onClick={() => setOpen(false)}/>
          <div style={{ position:'absolute', top:46, right:0, width:340, maxHeight:480, background:'#1e1a3e', border:'1px solid rgba(133,46,199,.3)', borderRadius:16, overflow:'hidden', zIndex:50, boxShadow:'0 16px 48px rgba(0,0,0,.5)' }}>
            <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between', padding:'14px 18px', borderBottom:'1px solid rgba(133,46,199,.15)' }}>
              <div style={{ fontSize:14, fontWeight:700, color:'#fff' }}>
                Notificaciones {unread > 0 && <span style={{ fontSize:11, background:'rgba(192,57,43,.2)', color:'#C0392B', padding:'2px 8px', borderRadius:20, marginLeft:6 }}>{unread} sin leer</span>}
              </div>
              <div style={{ display:'flex', gap:8 }}>
                {unread > 0 && <button onClick={() => markRead.mutate()} style={{ display:'flex', alignItems:'center', gap:4, fontSize:11, color:'#6CC998', background:'none', border:'none', cursor:'pointer', fontWeight:600 }}><CheckCheck size={12}/> Leer todas</button>}
                <button onClick={() => setOpen(false)} style={{ background:'none', border:'none', color:'rgba(255,255,255,.4)', cursor:'pointer', display:'flex' }}><X size={16}/></button>
              </div>
            </div>
            <div style={{ overflowY:'auto', maxHeight:400 }}>
              {notifs.length === 0 ? (
                <div style={{ textAlign:'center', padding:'40px 20px', color:'rgba(255,255,255,.3)' }}><Bell size={32} style={{ marginBottom:10, opacity:.3 }}/><div style={{ fontSize:13 }}>Sin notificaciones</div></div>
              ) : notifs.map(n => {
                const s = TIPO[n.tipo] || TIPO.info;
                const Icon = s.icon;
                return (
                  <div key={n.id} style={{ display:'flex', gap:12, padding:'13px 18px', borderBottom:'1px solid rgba(255,255,255,.04)', background:n.leida?'transparent':'rgba(133,46,199,.05)' }}>
                    <div style={{ width:34, height:34, borderRadius:10, background:s.bg, display:'flex', alignItems:'center', justifyContent:'center', flexShrink:0 }}><Icon size={16} color={s.color}/></div>
                    <div style={{ flex:1, minWidth:0 }}>
                      <div style={{ fontSize:13, fontWeight:n.leida?400:600, color:'#fff', marginBottom:2 }}>{n.titulo}</div>
                      {n.mensaje && <div style={{ fontSize:11, color:'rgba(255,255,255,.5)', overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>{n.mensaje}</div>}
                      <div style={{ fontSize:10, color:'rgba(255,255,255,.3)', marginTop:4, display:'flex', alignItems:'center', gap:4 }}><Clock size={9}/>{timeAgo(n.createdAt)}</div>
                    </div>
                    {!n.leida && <div style={{ width:7, height:7, borderRadius:'50%', background:'#852EC7', flexShrink:0, marginTop:4 }}/>}
                  </div>
                );
              })}
            </div>
          </div>
        </>
      )}
    </div>
  );
}
