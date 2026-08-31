'use client';
import { useEffect, useState } from 'react';
import { useRouter, usePathname } from 'next/navigation';
import { useAuthStore } from '@/store/authStore';
import Link from 'next/link';
import {
  LayoutDashboard, Users, GitBranch, ArrowLeftRight,
  Landmark, Percent, Building2, AlertTriangle, FileText,
  Settings, ClipboardList, UserCheck, LogOut, Search
} from 'lucide-react';
import { NotificationBell } from '@/components/admin/NotificationBell';
import { ThemeToggle } from '@/components/ThemeToggle';

const NAV = [
  { section: 'GENERAL', items: [
    { href: '/admin',               icon: LayoutDashboard, label: 'Dashboard'          },
    { href: '/admin/usuarios',      icon: Users,           label: 'Usuarios'           },
    { href: '/admin/referidos',     icon: GitBranch,       label: 'Referidos'          },
    { href: '/admin/transacciones', icon: ArrowLeftRight,  label: 'Transacciones'      },
  ]},
  { section: 'OPERACIONES', items: [
    { href: '/admin/retiros',       icon: Landmark,        label: 'Retiros'            },
    { href: '/admin/comisiones',    icon: Percent,         label: 'Comisiones'         },
    { href: '/admin/bancos',        icon: Building2,       label: 'Bancos'             },
  ]},
  { section: 'SEGURIDAD', items: [
    { href: '/admin/alertas',       icon: AlertTriangle,   label: 'Alertas'            },
    { href: '/admin/reportes',      icon: FileText,        label: 'Reportes'           },
  ]},
  { section: 'SISTEMA', items: [
    { href: '/admin/configuracion',      icon: Settings,      label: 'Configuracion'      },
    { href: '/admin/auditoria-admin',    icon: ClipboardList, label: 'Auditoria Admin'    },
    { href: '/admin/auditoria-usuarios', icon: UserCheck,     label: 'Auditoria Usuarios' },
  ]},
];

const PAGE_TITLES: Record<string, { title: string; sub: string }> = {
  '/admin':                    { title: 'Dashboard',           sub: 'Resumen general de la plataforma'        },
  '/admin/usuarios':           { title: 'Usuarios',            sub: 'Gestion de usuarios registrados'         },
  '/admin/referidos':          { title: 'Referidos',           sub: 'Programa de referidos'                   },
  '/admin/transacciones':      { title: 'Transacciones',       sub: 'Historial global de movimientos'         },
  '/admin/retiros':            { title: 'Retiros pendientes',  sub: 'Cola de aprobacion de retiros'           },
  '/admin/comisiones':         { title: 'Comisiones',          sub: 'Ingresos por comisiones del 3%'          },
  '/admin/bancos':             { title: 'Bancos',              sub: 'Bancos habilitados para retiro'           },
  '/admin/alertas':            { title: 'Alertas de riesgo',   sub: 'Deteccion de operaciones inusuales'      },
  '/admin/reportes':           { title: 'Reportes',            sub: 'Exportacion y reportes regulatorios'     },
  '/admin/configuracion':      { title: 'Configuracion',       sub: 'Parametros del sistema'                  },
  '/admin/auditoria-admin':    { title: 'Auditoria Admin',     sub: 'Registro de acciones administrativas'    },
  '/admin/auditoria-usuarios': { title: 'Auditoria Usuarios',  sub: 'Cambios en cuentas de usuario'           },
};

export default function AdminLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  const router   = useRouter();
  const pathname = usePathname();
  const user     = useAuthStore(s => s.user);
  const logout   = useAuthStore(s => s.logout);
  const [search, setSearch] = useState('');
  const [hydrated, setHydrated] = useState(false);

  // Espera a que zustand rehidrate desde localStorage antes de decidir si redirige.
  // Sin esto, una recarga completa manda al admin ya autenticado a /login.
  // useAuthStore.persist no existe durante el render en el servidor — todo esto debe vivir en useEffect.
  useEffect(() => {
    if (useAuthStore.persist.hasHydrated()) { setHydrated(true); return; }
    return useAuthStore.persist.onFinishHydration(() => setHydrated(true));
  }, []);

  useEffect(() => {
    if (!hydrated) return;
    if (!user) { router.push('/login'); return; }
    if (user.rol !== 'admin') router.push('/dashboard');
  }, [user, hydrated]);

  if (!hydrated || !user) return null;

  const initials   = user.nombre?.split(' ').slice(0,2).map((w:string) => w[0]).join('').toUpperCase() || 'AT';
  const pageInfo   = PAGE_TITLES[pathname] || { title: 'Admin', sub: '' };

  async function handleLogout() {
    await logout();
    router.push('/login');
  }

  return (
    <div style={{ display:'flex', minHeight:'100vh', background:'var(--adm-bg)' }}>

      {/* Sidebar */}
      <aside style={{ width:220, flexShrink:0, position:'fixed', top:0, bottom:0, left:0, display:'flex', flexDirection:'column', zIndex:40, background:'linear-gradient(180deg,var(--adm-bg2) 0%,var(--adm-bg2b) 100%)', borderRight:'1px solid rgba(133,46,199,.18)' }}>

        {/* Logo */}
        <div style={{ padding:'18px 18px 14px', borderBottom:'1px solid rgba(133,46,199,.12)' }}>
          <img src="/tp_icon.png" alt="TrendPay" width={32} height={32} style={{ borderRadius:9 }} />
          <div style={{ marginTop:6 }}>
            <span style={{ fontSize:10, fontWeight:700, background:'rgba(133,46,199,.2)', color:'#c088f0', padding:'3px 10px', borderRadius:20, border:'1px solid rgba(133,46,199,.3)' }}>
              ADMIN PANEL
            </span>
          </div>
          <div style={{ marginTop:6 }}>
            <span style={{ fontSize:10, fontWeight:700, background:'rgba(108,201,152,.15)', color:'#6CC998', padding:'3px 10px', borderRadius:20 }}>
              SUPER ADMIN
            </span>
          </div>
        </div>

        {/* Nav */}
        <nav style={{ flex:1, padding:'10px', overflowY:'auto' }}>
          {NAV.map(group => (
            <div key={group.section} style={{ marginBottom:8 }}>
              <div style={{ fontSize:9, fontWeight:700, color:'rgba(var(--adm-muted-rgb),.5)', letterSpacing:'1.5px', padding:'8px 10px 4px', textTransform:'uppercase' }}>
                {group.section}
              </div>
              {group.items.map(item => {
                const active = pathname === item.href || (item.href !== '/admin' && pathname.startsWith(item.href));
                const Icon   = item.icon;
                return (
                  <Link key={item.href} href={item.href}
                    style={{ display:'flex', alignItems:'center', gap:10, padding:'8px 10px', borderRadius:10, marginBottom:2, textDecoration:'none', fontSize:13, fontWeight:active?600:400, transition:'all .15s',
                      background: active ? 'rgba(133,46,199,.22)' : 'transparent',
                      color:      active ? 'var(--adm-text)' : 'var(--adm-muted)',
                      borderLeft: active ? '3px solid #852EC7' : '3px solid transparent',
                    }}>
                    <Icon size={15} strokeWidth={active?2.5:1.8}/>
                    <span style={{ flex:1 }}>{item.label}</span>
                  </Link>
                );
              })}
            </div>
          ))}
        </nav>

        {/* User */}
        <div style={{ padding:'12px 14px', borderTop:'1px solid rgba(133,46,199,.12)' }}>
          <div style={{ display:'flex', alignItems:'center', gap:10, marginBottom:10 }}>
            <div style={{ width:34, height:34, borderRadius:10, background:'linear-gradient(135deg,#852EC7,#321168)', display:'flex', alignItems:'center', justifyContent:'center', fontSize:12, fontWeight:800, color:'#fff', flexShrink:0 }}>
              {initials}
            </div>
            <div style={{ minWidth:0 }}>
              <div style={{ fontSize:12, fontWeight:600, color:'var(--adm-text)', overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>{user.nombre?.split(' ').slice(0,2).join(' ')}</div>
              <div style={{ fontSize:10, color:'var(--adm-muted)' }}>super_admin · activo</div>
            </div>
          </div>
          <button onClick={handleLogout}
            style={{ width:'100%', padding:'8px 12px', borderRadius:10, background:'rgba(192,57,43,.1)', border:'1px solid rgba(192,57,43,.2)', color:'#C0392B', fontSize:12, fontWeight:600, cursor:'pointer', display:'flex', alignItems:'center', gap:6, justifyContent:'center' }}>
            <LogOut size={13}/> Cerrar sesion
          </button>
        </div>
      </aside>

      {/* Main */}
      <div style={{ marginLeft:220, flex:1, display:'flex', flexDirection:'column', minHeight:'100vh' }}>

        {/* Topbar */}
        <header style={{ height:58, display:'flex', alignItems:'center', padding:'0 28px', gap:16, flexShrink:0, background:'var(--adm-bg2b)', borderBottom:'1px solid rgba(133,46,199,.15)' }}>
          <div style={{ flex:1 }}>
            <div style={{ fontSize:18, fontWeight:800, color:'var(--adm-text)', letterSpacing:'-.3px' }}>{pageInfo.title}</div>
            <div style={{ fontSize:11, color:'var(--adm-muted)' }}>{pageInfo.sub}</div>
          </div>
          <div style={{ display:'flex', alignItems:'center', gap:10 }}>
            <div style={{ position:'relative' }}>
              <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Buscar..."
                style={{ background:'rgba(var(--adm-card-rgb),.6)', border:'1px solid rgba(133,46,199,.2)', borderRadius:10, padding:'7px 14px 7px 32px', fontSize:12, color:'var(--adm-text)', outline:'none', width:200 }}/>
              <Search size={13} style={{ position:'absolute', left:10, top:'50%', transform:'translateY(-50%)', color:'var(--adm-muted)' }}/>
            </div>
            <ThemeToggle className="adm-icon-button" iconSize={17} />
            <NotificationBell />
            <div style={{ width:34, height:34, borderRadius:10, background:'linear-gradient(135deg,#852EC7,#321168)', display:'flex', alignItems:'center', justifyContent:'center', fontSize:12, fontWeight:800, color:'#fff' }}>
              {initials}
            </div>
          </div>
        </header>

        {/* Content */}
        <main style={{ flex:1, padding:'20px 24px', overflowY:'auto' }}>
          {children}
        </main>
      </div>
    </div>
  );
}
