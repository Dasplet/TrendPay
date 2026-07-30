'use client';

import { useState } from 'react';
import toast from 'react-hot-toast';
import { useRouter } from 'next/navigation';
import { Save } from 'lucide-react';
import { useMutation } from '@tanstack/react-query';
import { useAuthStore } from '@/store/authStore';
import { usersApi } from '@/lib/api';
import { ThemeButton, UserModal } from '@/components/user/UserTheme';

export default function EditarPerfilPage() {
  const router = useRouter();
  const user = useAuthStore((s) => s.user);
  const refreshUser = useAuthStore((s) => s.refreshUser);

  const [nombre, setNombre] = useState(user?.nombre || '');
  const [correo, setCorreo] = useState(user?.correo || '');
  const [celular, setCelular] = useState(user?.celular || '');
  const [ciudad, setCiudad] = useState(user?.ciudad || '');

  const guardarMutation = useMutation({
    mutationFn: () => usersApi.updateProfile({ nombre, correo, celular, ciudad }),
    onSuccess: async () => {
      await refreshUser();
      toast.success('Información actualizada');
      router.push('/dashboard/perfil');
    },
    onError: (err: any) => toast.error(err.response?.data?.mensaje || 'No se pudo actualizar tu información'),
  });

  function guardar() {
    if (!nombre.trim()) return toast.error('El nombre no puede estar vacío');
    if (!correo.trim()) return toast.error('El correo no puede estar vacío');
    guardarMutation.mutate();
  }

  return (
    <UserModal title="Editar información" subtitle="Actualiza tus datos de contacto">
      <div className="tp-modal-content">
        <label className="tp-form-field">
          <span>Nombre completo</span>
          <input value={nombre} onChange={(e) => setNombre(e.target.value)} placeholder="Tu nombre completo" />
        </label>
        <label className="tp-form-field">
          <span>Correo</span>
          <input value={correo} onChange={(e) => setCorreo(e.target.value)} type="email" placeholder="correo@ejemplo.com" />
        </label>
        <label className="tp-form-field">
          <span>Celular</span>
          <input value={celular} onChange={(e) => setCelular(e.target.value.replace(/\D/g, ''))} inputMode="numeric" placeholder="Ej. 3001234567" />
        </label>
        <label className="tp-form-field">
          <span>Ciudad</span>
          <input value={ciudad} onChange={(e) => setCiudad(e.target.value)} placeholder="Ej. Medellín" />
        </label>
        <ThemeButton disabled={guardarMutation.isPending} onClick={guardar}>
          <Save size={18} /> {guardarMutation.isPending ? 'Guardando...' : 'Guardar cambios'}
        </ThemeButton>
      </div>
    </UserModal>
  );
}
