'use client';

import Link from 'next/link';
import { Building2, Camera, ChevronRight, Lock, MessageCircle, Pencil, ShieldCheck, SlidersHorizontal, Trash2, Users } from 'lucide-react';
import { useRef } from 'react';
import toast from 'react-hot-toast';
import { useAuthStore } from '@/store/authStore';
import { StatusPill, UserAvatar } from '@/components/user/UserTheme';

export default function PerfilPage() {
  const user = useAuthStore((s) => s.user);
  const updateProfilePhoto = useAuthStore((s) => s.updateProfilePhoto);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  function handleProfilePhoto(file?: File) {
    if (!file) return;
    if (!file.type.startsWith('image/')) {
      toast.error('Selecciona una imagen válida');
      return;
    }
    if (file.size > 2 * 1024 * 1024) {
      toast.error('La imagen debe pesar máximo 2 MB');
      return;
    }

    const reader = new FileReader();
    reader.onload = () => {
      updateProfilePhoto(String(reader.result));
      toast.success('Foto de perfil actualizada');
    };
    reader.onerror = () => toast.error('No se pudo cargar la imagen');
    reader.readAsDataURL(file);
  }

  const options = [
    { icon: <Lock size={22} />, title: 'Seguridad y PIN', desc: 'Cambiar PIN · sesiones activas', tone: 'purple', href: '/dashboard/seguridad' },
    { icon: <Building2 size={22} />, title: 'Bancos para retiro', desc: 'Vincular cuentas bancarias', tone: 'green', href: '/dashboard/bancos' },
    { icon: <Users size={22} />, title: 'Mis referidos', desc: 'Gana $1.000 por cada amigo', tone: 'purple', href: '/dashboard/referidos' },
    { icon: <SlidersHorizontal size={22} />, title: 'Límites de transacción', desc: 'Diario $3M · Mensual $20M', tone: 'pink' },
    { icon: <MessageCircle size={22} />, title: 'Soporte 24/7', desc: 'Próximamente', tone: 'purple' },
  ];

  return (
    <div className="tp-user-page">
      <header className="tp-page-header"><h1>Mi perfil</h1></header>

      <section className="tp-profile-hero">
        <div className="tp-avatar-wrap">
          <UserAvatar user={user} size="lg" />
          <input
            ref={fileInputRef}
            type="file"
            accept="image/*"
            className="tp-hidden-file"
            onChange={(event) => handleProfilePhoto(event.target.files?.[0])}
          />
          <button type="button" onClick={() => fileInputRef.current?.click()} aria-label="Cambiar foto de perfil"><Camera size={16} /></button>
        </div>
        <h2>{user?.nombre}</h2>
        <p>CC {user?.cedula} · {user?.ciudad || 'Medellín'}</p>
        <div className="tp-profile-actions">
          <StatusPill tone="purple"><ShieldCheck size={15} /> Identidad verificada · Nivel 2</StatusPill>
          <Link href="/dashboard/perfil/editar"><Pencil size={15} /> Editar información</Link>
          {user?.avatarDataUrl && <button type="button" onClick={() => { updateProfilePhoto(null); toast.success('Foto eliminada'); }}><Trash2 size={15} /> Quitar foto</button>}
        </div>
      </section>

      <section className="tp-profile-list">
        {options.map((item) =>
          item.href ? (
            <Link key={item.title} href={item.href} className="tp-profile-option">
              <span className={`tp-op-icon tp-op-${item.tone}`}>{item.icon}</span>
              <div><strong>{item.title}</strong><small>{item.desc}</small></div>
              <ChevronRight size={20} />
            </Link>
          ) : (
            <article key={item.title} className="tp-profile-option">
              <span className={`tp-op-icon tp-op-${item.tone}`}>{item.icon}</span>
              <div><strong>{item.title}</strong><small>{item.desc}</small></div>
            </article>
          )
        )}
      </section>
    </div>
  );
}
