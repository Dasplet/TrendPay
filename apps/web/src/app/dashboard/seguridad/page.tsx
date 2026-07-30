'use client';

import Link from 'next/link';
import { useQuery } from '@tanstack/react-query';
import { Fingerprint, KeyRound, Lock, ShieldCheck } from 'lucide-react';
import { authApi } from '@/lib/api';

export default function SeguridadPage() {
  const { data: sesionesCount } = useQuery({
    queryKey: ['auth-sessions-count'],
    queryFn: () => authApi.sessions(),
    select: (res) => res.data.sesiones?.length ?? 0,
    retry: false,
  });

  const items = [
    { icon: <KeyRound size={24} />, title: 'Cambiar PIN', desc: 'Actualiza tus 4 dígitos de seguridad', status: 'Editar', href: '/dashboard/seguridad/cambiar-pin' },
    { icon: <ShieldCheck size={24} />, title: 'Verificación 2FA', desc: 'Código adicional para operaciones sensibles', status: 'Próximamente' },
    { icon: <Fingerprint size={24} />, title: 'Biometría', desc: 'Disponible en la app móvil', status: 'Próximamente' },
    { icon: <Lock size={24} />, title: 'Sesiones activas', desc: 'Controla dónde está abierta tu cuenta', status: sesionesCount != null ? `${sesionesCount} ${sesionesCount === 1 ? 'sesión' : 'sesiones'}` : '...', href: '/dashboard/seguridad/sesiones' },
  ];

  return (
    <div className="tp-user-page">
      <header className="tp-page-header"><h1>Seguridad</h1></header>
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
    </div>
  );
}
