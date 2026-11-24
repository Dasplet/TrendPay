'use client';

import { useEffect, useState } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import Link from 'next/link';
import { LogOut } from 'lucide-react';
import { useQuery } from '@tanstack/react-query';
import { datafonosApi } from '@/lib/api';
import { useTiempoReal, ETIQUETA_ESTADO } from '@/lib/tiempoReal';
import { useAuthStore } from '@/store/authStore';
import { BrandLogo, UserAvatar, firstName, userMenu } from '@/components/user/UserTheme';
import { permisoDeRuta, puede } from '@/lib/permisos';
import { CodigoOperacion } from '@/components/user/CodigoOperacion';
import { NotificacionesUsuario } from '@/components/user/NotificacionesUsuario';
import { ThemeToggle } from '@/components/ThemeToggle';

// Título y subtítulo de la barra superior según la pantalla (se toma la ruta más específica que coincida)
const TITULOS: [string, { title: string; sub: string }][] = [
  ['/dashboard/seguridad/sesiones', { title: 'Sesiones activas', sub: 'Dónde está abierta tu cuenta' }],
  ['/dashboard/seguridad/cambiar-pin', { title: 'Cambiar PIN', sub: 'Tu clave de 4 dígitos' }],
  ['/dashboard/seguridad/verificacion-2fa', { title: 'Verificación en dos pasos', sub: 'Un código al correo para proteger tu cuenta' }],
  ['/dashboard/seguridad', { title: 'Seguridad', sub: 'PIN, verificación en dos pasos y sesiones' }],
  ['/dashboard/perfil/editar', { title: 'Editar perfil', sub: 'Tus datos de contacto' }],
  ['/dashboard/perfil', { title: 'Mi perfil', sub: 'Tus datos y tu cuenta' }],
  ['/dashboard/bancos/nuevo', { title: 'Vincular banco', sub: 'Nueva cuenta para tus retiros' }],
  ['/dashboard/bancos', { title: 'Mis bancos', sub: 'Cuentas para tus retiros' }],
  ['/dashboard/retirar-banco', { title: 'Retirar a banco', sub: 'Envía tu saldo a una cuenta bancaria' }],
  ['/dashboard/cobrar-qr', { title: 'Cobrar', sub: 'Recibe pagos con tu QR' }],
  ['/dashboard/pagar-qr', { title: 'Pagar con QR', sub: 'Confirma el pago antes de enviarlo' }],
  ['/dashboard/ventas', { title: 'Mis ventas', sub: 'Datáfonos y página web, en vivo' }],
  ['/dashboard/historial', { title: 'Historial', sub: 'Todos los movimientos de tu cuenta' }],
];

export default function DashboardLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  const router = useRouter();
  const pathname = usePathname();
  const user = useAuthStore((s) => s.user);
  const logout = useAuthStore((s) => s.logout);
  const [hydrated, setHydrated] = useState(false);
  // Tiempo real: saldo, historial y cobros se actualizan solos cada vez que cambia algo en la cuenta
  const enVivo = useTiempoReal(hydrated && !!user && user.rol !== 'admin');

  // Espera a que zustand rehidrate desde localStorage antes de decidir si redirige a /login.
  // Sin esto, una recarga completa (p. ej. abrir un enlace de pago QR compartido en una pestaña nueva)
  // manda al usuario ya autenticado a /login porque el store todavía está vacío en el primer render.
  // useAuthStore.persist no existe durante el render en el servidor — esto debe vivir por completo en useEffect.
  useEffect(() => {
    if (useAuthStore.persist.hasHydrated()) {
      setHydrated(true);
      return;
    }
    return useAuthStore.persist.onFinishHydration(() => setHydrated(true));
  }, []);

  useEffect(() => {
    if (!hydrated) return;
    if (!user) {
      router.push('/login');
      return;
    }
    if (user.rol === 'admin') router.push('/admin');
  }, [router, user, hydrated]);

  // El enlace de cobro con datáfono solo aparece si la cuenta tiene terminales asignados
  const { data: tieneDatafonos } = useQuery({
    queryKey: ['datafonos-terminales', user?.id],
    queryFn: () => datafonosApi.terminales(),
    select: (res) => (res.data.terminales as unknown[]).length > 0,
    enabled: hydrated && !!user && user.rol !== 'admin' && puede(user, 'recargar'),
    staleTime: 5 * 60_000,
  });

  // Una subcuenta que entra por URL a una operación que no tiene permitida
  // vuelve al inicio (el backend igual la rechazaría con 403).
  const permisoRequerido = permisoDeRuta(pathname);
  // El PIN, la verificación en dos pasos y las sesiones son de la cuenta principal: una tienda no entra a Seguridad
  const seguridadDeTienda = !!user?.cuentaPadre && pathname.startsWith('/dashboard/seguridad');
  const rutaBloqueada = (!!user && !!permisoRequerido && !puede(user, permisoRequerido)) || seguridadDeTienda;
  useEffect(() => {
    if (hydrated && rutaBloqueada) router.replace('/dashboard');
  }, [hydrated, rutaBloqueada, router]);

  if (!hydrated || !user || rutaBloqueada) return null;

  async function handleLogout() {
    await logout();
    router.push('/login');
  }

  const pagina = pathname === '/dashboard'
    ? { title: 'Inicio', sub: `Hola, ${firstName(user)}` }
    : (TITULOS.find(([ruta]) => pathname === ruta || pathname.startsWith(`${ruta}/`))?.[1] ?? { title: 'TrendPay', sub: '' });
  const estado = ETIQUETA_ESTADO[enVivo];
  const cuenta = user.cuentaPadre ? `Tienda de ${user.cuentaPadre.nombre}` : 'Cuenta principal';

  return (
    <div className="tp-user-shell">
      <aside className="tp-sidebar">
        <div className="tp-sidebar-logo">
          <BrandLogo />
          <div><span className="tp-sidebar-badge">{cuenta}</span></div>
        </div>

        <nav className="tp-sidebar-nav">
          {userMenu.map((group) => (
            <div key={group.section} className="tp-nav-group">
              <p>{group.section}</p>
              {group.items.filter((item) => (!item.permiso || puede(user, item.permiso)) && (!item.soloConDatafonos || tieneDatafonos) && (!item.soloPrincipal || !user.cuentaPadre)).map((item) => {
                const active = pathname === item.href || (item.href !== '/dashboard' && pathname.startsWith(item.href));
                return (
                  <Link key={item.href} href={item.href} className={`tp-nav-link ${active ? 'active' : ''}`}>
                    {item.icon}
                    <span>{item.label}</span>
                  </Link>
                );
              })}
            </div>
          ))}
        </nav>

        <div className="tp-sidebar-footer">
          <div className="tp-sidebar-user">
            <UserAvatar user={user} size="sm" />
            <div>
              <strong>{user.nombre?.split(' ').slice(0, 2).join(' ')}</strong>
              <span>{user.cuentaPadre ? user.cuentaPadre.nombre : `CC ${user.cedula}`}</span>
            </div>
          </div>
          <button onClick={handleLogout} className="tp-logout-button">
            <LogOut size={13} />
            Cerrar sesión
          </button>
        </div>
      </aside>

      <div className="tp-main-area">
        <header className="tp-topbar">
          <div className="tp-topbar-title">
            <h1>{pagina.title}</h1>
            {pagina.sub && <p>{pagina.sub}</p>}
          </div>
          <div className="tp-topbar-actions">
            <span className="tp-live" title="La pantalla se actualiza sola cada vez que algo cambia" style={{ color: estado.color, background: `${estado.color}1f` }}>
              <i />
              {estado.texto}
            </span>
            <ThemeToggle className="tp-icon-button" iconSize={17} />
            <NotificacionesUsuario />
            <UserAvatar user={user} size="sm" />
          </div>
        </header>

        {user.eliminacionProgramadaAt && (
          <div role="alert" style={{ margin: '14px 24px 0', padding: '12px 16px', borderRadius: 12, background: 'rgba(212,160,23,.15)', border: '1px solid rgba(212,160,23,.5)', fontSize: 13 }}>
            <strong>Tu cuenta se eliminará el {new Date(user.eliminacionProgramadaAt).toLocaleDateString('es-CO', { day: 'numeric', month: 'long', year: 'numeric' })}.</strong>{' '}
            Hasta entonces solo puedes retirar tu saldo. Retíralo antes de esa fecha.
          </div>
        )}
        {children}
      </div>
      <CodigoOperacion />
    </div>
  );
}
