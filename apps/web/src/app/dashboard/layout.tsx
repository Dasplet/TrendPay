'use client';

import { useEffect, useState } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import Link from 'next/link';
import { LogOut } from 'lucide-react';
import { useAuthStore } from '@/store/authStore';
import { BrandLogo, UserAvatar, fmtCOP, userMenu } from '@/components/user/UserTheme';

export default function DashboardLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  const router = useRouter();
  const pathname = usePathname();
  const user = useAuthStore((s) => s.user);
  const logout = useAuthStore((s) => s.logout);
  const [hydrated, setHydrated] = useState(false);

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

  if (!hydrated || !user) return null;

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
            <span>{fmtCOP(user.saldo)} disponible</span>
          </div>
        </div>

        <nav className="tp-sidebar-nav">
          {userMenu.map((group) => (
            <div key={group.section} className="tp-nav-group">
              <p>{group.section}</p>
              {group.items.map((item) => {
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

      <main className="tp-main-area">{children}</main>
    </div>
  );
}
