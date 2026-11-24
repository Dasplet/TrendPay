'use client';

import Link from 'next/link';
import { useQuery } from '@tanstack/react-query';
import { Fingerprint, KeyRound, Lock, ShieldCheck } from 'lucide-react';
import { authApi } from '@/lib/api';
import { useAuthStore } from '@/store/authStore';
import { Panel } from '@/components/admin/ui';

function sesionesLabel(count: number | null | undefined) {
  if (count == null) return '...';
  const palabra = count === 1 ? 'sesión' : 'sesiones';
  return `${count} ${palabra}`;
}

export default function SeguridadPage() {
  const dosPasos = useAuthStore((s) => s.user?.requiere2fa);
  const { data: sesionesCount } = useQuery({
    queryKey: ['auth-sessions-count'],
    queryFn: () => authApi.sessions(),
    select: (res) => res.data.sesiones?.length ?? 0,
    retry: false,
  });

  const items = [
    { icon: <KeyRound size={24} />, title: 'Cambiar PIN', desc: 'Actualiza tus 4 dígitos de seguridad', status: 'Editar', href: '/dashboard/seguridad/cambiar-pin' },
    { icon: <ShieldCheck size={24} />, title: 'Verificación 2FA', desc: 'Código al correo al entrar y en operaciones sensibles', status: dosPasos ? 'Activa' : 'Activar', href: '/dashboard/seguridad/verificacion-2fa' },
    { icon: <Fingerprint size={24} />, title: 'Biometría', desc: 'Disponible en la app móvil', status: 'Próximamente' },
    { icon: <Lock size={24} />, title: 'Sesiones activas', desc: 'Controla dónde está abierta tu cuenta', status: sesionesLabel(sesionesCount), href: '/dashboard/seguridad/sesiones' },
  ];

  return (
    <div className="tp-user-page">
      <Panel style={{ maxWidth: 820 }}>
      <section className="tp-profile-list">
        {items.map((item) =>
          item.href ? (
            <Link key={item.title} href={item.href} className="tp-profile-option">
              <span className="tp-op-icon tp-op-purple">{item.icon}</span>
              <div><strong>{item.title}</strong><small>{item.desc}</small></div>
              <em>{item.status}</em>
            </Link>
          ) : (
            <article key={item.title} className="tp-profile-option">
              <span className="tp-op-icon tp-op-purple">{item.icon}</span>
              <div><strong>{item.title}</strong><small>{item.desc}</small></div>
              <em>{item.status}</em>
            </article>
          )
        )}
      </section>
      </Panel>
    </div>
  );
}
