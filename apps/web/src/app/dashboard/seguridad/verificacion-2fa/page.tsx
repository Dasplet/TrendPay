'use client';

import { useState } from 'react';
import toast from 'react-hot-toast';
import { useRouter } from 'next/navigation';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ShieldCheck, ShieldOff } from 'lucide-react';
import { authApi } from '@/lib/api';
import { useAuthStore } from '@/store/authStore';
import { ThemeButton, UserModal } from '@/components/user/UserTheme';

type Paso = 'inicio' | 'codigo';

export default function Verificacion2faPage() {
  const router = useRouter();
  const queryClient = useQueryClient();
  const refreshUser = useAuthStore((s) => s.refreshUser);
  const [paso, setPaso] = useState<Paso>('inicio');
  const [pin, setPin] = useState('');
  const [codigo, setCodigo] = useState('');
  const [correo, setCorreo] = useState('');

  const estadoQ = useQuery({ queryKey: ['2fa-estado'], queryFn: () => authApi.twofaEstado(), select: (r) => r.data as { activo: boolean; correo: string | null }, retry: false });
  const activo = !!estadoQ.data?.activo;
  const accion = activo ? 'desactivar' : 'activar';

  const solicitar = useMutation({
    mutationFn: () => authApi.twofaSolicitar({ proposito: accion, pin }),
    onSuccess: ({ data }) => { setCorreo(data.correo); setCodigo(''); setPaso('codigo'); toast.success(data.mensaje); },
    onError: (err: any) => toast.error(err.response?.data?.mensaje || 'No se pudo enviar el código'),
  });

  const confirmar = useMutation({
    mutationFn: () => (activo ? authApi.twofaDesactivar({ pin, codigo }) : authApi.twofaActivar({ codigo })),
    onSuccess: async ({ data }) => {
      toast.success(data.mensaje);
      await refreshUser();
      await queryClient.invalidateQueries({ queryKey: ['2fa-estado'] });
      router.push('/dashboard/seguridad');
    },
    onError: (err: any) => toast.error(err.response?.data?.mensaje || 'No se pudo completar el cambio'),
  });

  return (
    <UserModal title="Verificación en dos pasos" subtitle={activo ? 'Está activa en tu cuenta' : 'Un código al correo para proteger tu cuenta'}>
      <div className="tp-modal-content">
        {estadoQ.isLoading ? <p className="tp-modal-label">Cargando…</p> : paso === 'inicio' ? (
          <>
            <p className="tp-modal-label">
              {activo
                ? 'Al iniciar sesión, enviar dinero, retirar o cambiar el PIN te pedimos un código de 6 dígitos que llega a tu correo. Para apagarla confirma tu PIN.'
                : 'Cuando la actives, al iniciar sesión y en las operaciones sensibles (enviar dinero, retirar, cambiar el PIN y manejar tus cuentas de banco) te pediremos un código de 6 dígitos que llega a tu correo.'}
            </p>
            {estadoQ.data?.correo && <p className="tp-modal-label">Correo de la cuenta: <strong>{estadoQ.data.correo}</strong></p>}
            <label className="tp-form-field">
              <span>Tu PIN</span>
              <input value={pin} onChange={(e) => setPin(e.target.value.replaceAll(/\D/g, '').slice(0, 4))} type="password" inputMode="numeric" maxLength={4} placeholder="••••" />
            </label>
            <ThemeButton tone={activo ? 'danger' : 'primary'} disabled={pin.length !== 4 || solicitar.isPending} onClick={() => solicitar.mutate()}>
              {activo ? <ShieldOff size={18} /> : <ShieldCheck size={18} />} {solicitar.isPending ? 'Enviando código…' : `Enviar código para ${activo ? 'desactivar' : 'activar'}`}
            </ThemeButton>
            <ThemeButton tone="ghost" href="/dashboard/seguridad">Volver</ThemeButton>
          </>
        ) : (
          <>
            <p className="tp-modal-label">Te enviamos un código a <strong>{correo}</strong>. Vence en 10 minutos.</p>
            <label className="tp-form-field">
              <span>Código de 6 dígitos</span>
              <input autoFocus value={codigo} onChange={(e) => setCodigo(e.target.value.replaceAll(/\D/g, '').slice(0, 6))} inputMode="numeric" autoComplete="one-time-code" placeholder="••••••" />
            </label>
            <ThemeButton tone={activo ? 'danger' : 'primary'} disabled={codigo.length !== 6 || confirmar.isPending} onClick={() => confirmar.mutate()}>
              {confirmar.isPending ? 'Verificando…' : activo ? 'Desactivar verificación' : 'Activar verificación'}
            </ThemeButton>
            <div className="tp-button-row">
              <ThemeButton tone="ghost" onClick={() => setPaso('inicio')}>Atrás</ThemeButton>
              <ThemeButton tone="ghost" disabled={solicitar.isPending} onClick={() => solicitar.mutate()}>{solicitar.isPending ? 'Enviando…' : 'Reenviar código'}</ThemeButton>
            </div>
          </>
        )}
      </div>
    </UserModal>
  );
}
