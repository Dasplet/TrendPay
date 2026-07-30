'use client';

import toast from 'react-hot-toast';
import { useRouter } from 'next/navigation';
import { LogOut, Monitor, Trash2 } from 'lucide-react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { authApi } from '@/lib/api';
import { useAuthStore } from '@/store/authStore';
import { EmptyState, ThemeButton } from '@/components/user/UserTheme';

function resumenDispositivo(userAgent?: string | null) {
  if (!userAgent) return 'Dispositivo desconocido';
  if (/Mobi|Android/i.test(userAgent)) return 'Dispositivo móvil';
  if (/Windows/i.test(userAgent)) return 'Windows';
  if (/Mac OS/i.test(userAgent)) return 'Mac';
  if (/Linux/i.test(userAgent)) return 'Linux';
  return 'Navegador de escritorio';
}

export default function SesionesPage() {
  const router = useRouter();
  const queryClient = useQueryClient();
  const logout = useAuthStore((s) => s.logout);

  const { data: sesiones, isLoading } = useQuery({
    queryKey: ['auth-sessions'],
    queryFn: () => authApi.sessions(),
    select: (res) => res.data.sesiones as any[],
  });

  const revokeMutation = useMutation({
    mutationFn: (id: string) => authApi.revokeSession(id),
    onSuccess: async (_data, id) => {
      const eraActual = sesiones?.find((s) => s.id === id)?.actual;
      if (eraActual) {
        toast.success('Cerraste esta sesión');
        await logout();
        router.push('/login');
        return;
      }
      queryClient.invalidateQueries({ queryKey: ['auth-sessions'] });
      queryClient.invalidateQueries({ queryKey: ['auth-sessions-count'] });
      toast.success('Sesión cerrada');
    },
    onError: (err: any) => toast.error(err.response?.data?.mensaje || 'No se pudo cerrar la sesión'),
  });

  const revokeOthersMutation = useMutation({
    mutationFn: () => authApi.revokeOtherSessions(),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['auth-sessions'] });
      queryClient.invalidateQueries({ queryKey: ['auth-sessions-count'] });
      toast.success('Se cerraron las demás sesiones');
    },
    onError: (err: any) => toast.error(err.response?.data?.mensaje || 'No se pudo completar la acción'),
  });

  return (
    <div className="tp-user-page">
      <header className="tp-page-header"><h1>Sesiones activas</h1></header>

      {!isLoading && (sesiones?.length || 0) > 1 && (
        <ThemeButton tone="secondary" disabled={revokeOthersMutation.isPending} onClick={() => revokeOthersMutation.mutate()}>
          <LogOut size={18} /> Cerrar todas las demás
        </ThemeButton>
      )}

      <section className="tp-profile-list" style={{ marginTop: 16 }}>
        {isLoading ? (
          <p>Cargando sesiones...</p>
        ) : !sesiones?.length ? (
          <EmptyState title="Sin sesiones activas" icon={<Monitor size={40} />} />
        ) : (
          sesiones.map((s) => (
            <article key={s.id} className="tp-profile-option">
              <span className="tp-op-icon tp-op-purple"><Monitor size={20} /></span>
              <div>
                <strong>{resumenDispositivo(s.userAgent)}{s.actual ? ' · Esta sesión' : ''}</strong>
                <small>{s.ip || 'IP desconocida'} · {new Date(s.createdAt).toLocaleString('es-CO')}</small>
              </div>
              <button className="tp-icon-button" aria-label="Cerrar sesión" disabled={revokeMutation.isPending} onClick={() => revokeMutation.mutate(s.id)}>
                <Trash2 size={18} />
              </button>
            </article>
          ))
        )}
      </section>
    </div>
  );
}
