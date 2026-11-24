'use client';

import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Bell, BellRing, CheckCheck, Trash2, X } from 'lucide-react';
import { notificationsApi } from '@/lib/api';
import { useAuthStore } from '@/store/authStore';

// Campana de notificaciones de la barra superior: lista, marca como leídas y elimina.
export function NotificacionesUsuario() {
  const user = useAuthStore((s) => s.user);
  const queryClient = useQueryClient();
  const [abierto, setAbierto] = useState(false);

  const { data } = useQuery({
    queryKey: ['user-notifications'],
    queryFn: () => notificationsApi.list(),
    select: (res) => res.data,
    enabled: !!user,
    retry: false,
  });

  const notificaciones: any[] = data?.notificaciones || [];
  const sinLeer = Number(data?.unread ?? data?.noLeidas ?? notificaciones.filter((n) => !n.leida).length);
  const refrescar = () => queryClient.invalidateQueries({ queryKey: ['user-notifications'] });

  const leerTodas = useMutation({ mutationFn: () => notificationsApi.readAll(), onSuccess: refrescar });
  const eliminar = useMutation({ mutationFn: (id: string) => notificationsApi.delete(id), onSuccess: refrescar });
  const limpiar = useMutation({ mutationFn: () => notificationsApi.clear(), onSuccess: refrescar });

  return (
    <div className="tp-notification-wrap">
      <button
        aria-label="Notificaciones"
        className="tp-icon-button tp-bell-button"
        onClick={() => {
          setAbierto((v) => !v);
          if (!abierto && sinLeer > 0) leerTodas.mutate();
        }}
      >
        {sinLeer > 0 ? <BellRing size={17} /> : <Bell size={17} />}
        {sinLeer > 0 && <span>{sinLeer > 9 ? '9+' : sinLeer}</span>}
      </button>

      {abierto && (
        <section className="tp-notifications-panel">
          <header>
            <div>
              <strong>Notificaciones</strong>
              <small>{notificaciones.length} en total</small>
            </div>
            <button aria-label="Cerrar notificaciones" onClick={() => setAbierto(false)}><X size={15} /></button>
          </header>

          {notificaciones.length === 0 ? (
            <div className="tp-notifications-empty">
              <Bell size={26} />
              <p>No tienes notificaciones</p>
            </div>
          ) : (
            <div className="tp-notifications-list">
              {notificaciones.map((n) => (
                <article key={n.id} className={`tp-notification-item ${n.leida ? '' : 'unread'}`}>
                  <div className="tp-notification-icon"><BellRing size={15} /></div>
                  <div>
                    <strong>{n.titulo || 'Notificación'}</strong>
                    <p>{n.mensaje || 'Actualización de TrendPay'}</p>
                    <small>{new Date(n.createdAt || n.created_at).toLocaleString('es-CO')}</small>
                  </div>
                  <button aria-label="Eliminar notificación" onClick={() => eliminar.mutate(n.id)}><Trash2 size={14} /></button>
                </article>
              ))}
            </div>
          )}

          {notificaciones.length > 0 && (
            <footer>
              <button onClick={() => leerTodas.mutate()}><CheckCheck size={14} /> Marcar leídas</button>
              <button onClick={() => limpiar.mutate()}><Trash2 size={14} /> Eliminar todas</button>
            </footer>
          )}
        </section>
      )}
    </div>
  );
}
