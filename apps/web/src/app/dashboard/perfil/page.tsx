'use client';

import Link from 'next/link';
import { Building2, Camera, ChevronRight, Lock, Pencil, ShieldCheck, Trash2 } from 'lucide-react';
import { useRef } from 'react';
import toast from 'react-hot-toast';
import { useAuthStore } from '@/store/authStore';
import { StatusPill, UserAvatar } from '@/components/user/UserTheme';
import { Panel, PanelHeader } from '@/components/admin/ui';
import { puede } from '@/lib/permisos';

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
      updateProfilePhoto(reader.result as string);
      toast.success('Foto de perfil actualizada');
    };
    reader.onerror = () => toast.error('No se pudo cargar la imagen');
    reader.readAsDataURL(file);
  }

  const options = [
    ...(user?.cuentaPadre ? [] : [{ icon: <Lock size={16} />, title: 'Seguridad y PIN', desc: 'Cambiar PIN, verificación en dos pasos y sesiones activas', tone: 'purple', href: '/dashboard/seguridad' }]),
    ...(puede(user, 'retirar') ? [{ icon: <Building2 size={16} />, title: 'Bancos para retiro', desc: 'Vincular y administrar tus cuentas bancarias', tone: 'green', href: '/dashboard/bancos' }] : []),
  ];

  return (
    <div className="tp-user-page">
      <Panel style={{ maxWidth: 820 }}>
        <div className="tp-profile-hero">
          <div className="tp-avatar-wrap">
            <UserAvatar user={user} size="lg" />
            <input
              ref={fileInputRef}
              type="file"
              accept="image/*"
              className="tp-hidden-file"
              onChange={(event) => handleProfilePhoto(event.target.files?.[0])}
            />
            <button type="button" onClick={() => fileInputRef.current?.click()} aria-label="Cambiar foto de perfil"><Camera size={14} /></button>
          </div>
          <div>
            <h2>{user?.nombre}</h2>
            <p>CC {user?.cedula}{user?.ciudad ? ` · ${user.ciudad}` : ''}{user?.cuentaPadre ? ` · Tienda de ${user.cuentaPadre.nombre}` : ''}</p>
            <div className="tp-profile-actions">
              <StatusPill tone={user?.kycVerificado ? 'success' : 'muted'}><ShieldCheck size={13} /> {user?.kycVerificado ? 'Identidad verificada' : 'Identidad sin verificar'}</StatusPill>
              <Link href="/dashboard/perfil/editar"><Pencil size={13} /> Editar información</Link>
              {user?.avatarDataUrl && <button type="button" onClick={() => { updateProfilePhoto(null); toast.success('Foto eliminada'); }}><Trash2 size={13} /> Quitar foto</button>}
            </div>
          </div>
        </div>
      </Panel>

      {options.length > 0 && (
      <Panel style={{ maxWidth: 820 }}>
        <PanelHeader title="Tu cuenta" />
        <div className="tp-profile-list">
          {options.map((item) => (
            <Link key={item.title} href={item.href} className="tp-profile-option">
              <span className={`tp-op-icon tp-op-${item.tone}`}>{item.icon}</span>
              <div><strong>{item.title}</strong><small>{item.desc}</small></div>
              <ChevronRight size={16} />
            </Link>
          ))}
        </div>
      </Panel>
      )}
    </div>
  );
}
