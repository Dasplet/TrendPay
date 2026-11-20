'use client';

import { useEffect, useState } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import Link from 'next/link';
import { LogOut } from 'lucide-react';
import { useQuery } from '@tanstack/react-query';
import { datafonosApi } from '@/lib/api';
import { useTiempoReal } from '@/lib/tiempoReal';
import { useAuthStore, type User } from '@/store/authStore';
import { BrandLogo, UserAvatar, fmtCOP, userMenu } from '@/components/user/UserTheme';
import { permisoDeRuta, puede } from '@/lib/permisos';

function subtituloCuenta(user: User) {
  if (puede(user, 'verSaldo')) return `${fmtCOP(user.saldo)} disponible`;
  return user.cuentaPadre ? `Subcuenta de ${user.cuentaPadre.nombre}` : 'Saldo oculto';
}

export default function DashboardLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  const router = useRouter();
  const pathname = usePathname();
  const user = useAuthStore((s) => s.user);
  const logout = useAuthStore((s) => s.logout);
  const [hydrated, setHydrated] = useState(false);
  // Tiempo real: saldo, historial y cobros se actualizan solos cada vez que cambia algo en la cuenta
  useTiempoReal(hydrated && !!user && user.rol !== 'admin');

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
  const rutaBloqueada = !!user && !!permisoRequerido && !puede(user, permisoRequerido);
  useEffect(() => {
    if (hydrated && rutaBloqueada) router.replace('/dashboard');
  }, [hydrated, rutaBloqueada, router]);

  if (!hydrated || !user || rutaBloqueada) return null;

  async function handleLogout() {
    await logout();
    router.push('/login');
  }

  return (
    <div className="tp-user-shell">
      <aside className="tp-sidebar">
        <div className="tp-sidebar-logo">
          <BrandLogo />
        </div>

        <div className="tp-sidebar-user">
          <UserAvatar user={user} />
          <div>
            <strong>{user.nombre}</strong>
            <span>{subtituloCuenta(user)}</span>
          </div>
        </div>

        <nav className="tp-sidebar-nav">
          {userMenu.map((group) => (
            <div key={group.section} className="tp-nav-group">
              <p>{group.section}</p>
              {group.items.filter((item) => (!item.permiso || puede(user, item.permiso)) && (!item.soloConDatafonos || tieneDatafonos)).map((item) => {
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
          <button onClick={handleLogout} className="tp-logout-button">
            <LogOut size={17} />
            Cerrar sesión
          </button>
        </div>
      </aside>

      <main className="tp-main-area">
        {user.eliminacionProgramadaAt && (
          <div role="alert" style={{ margin: '12px 16px 0', padding: '12px 16px', borderRadius: 12, background: 'rgba(212,160,23,.15)', border: '1px solid rgba(212,160,23,.5)', fontSize: 14 }}>
            <strong>Tu cuenta se eliminará el {new Date(user.eliminacionProgramadaAt).toLocaleDateString('es-CO', { day: 'numeric', month: 'long', year: 'numeric' })}.</strong>{' '}
            Hasta entonces solo puedes retirar tu saldo. Retíralo antes de esa fecha.
          </div>
        )}
        {children}
      </main>
    </div>
  );
}
