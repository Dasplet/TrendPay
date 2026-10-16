'use client';

import toast from 'react-hot-toast';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { RefreshCw } from 'lucide-react';
import { useAuthStore } from '@/store/authStore';
import { kushkiApi } from '@/lib/api';
import { EmptyState, StatusPill, ThemeButton, UserModal, fmtCOP } from '@/components/user/UserTheme';

interface Consignacion {
  id: string;
  metodo: 'tarjeta' | 'pse';
  estado: 'pendiente' | 'completado' | 'rechazado';
  monto: number;
  createdAt: string;
  token?: string;
}

const ESTADOS = {
  pendiente: { label: 'Pendiente', tone: 'purple' },
  completado: { label: 'Acreditada', tone: 'success' },
  rechazado: { label: 'Rechazada', tone: 'danger' },
} as const;

export default function ConsignacionesPage() {
  const queryClient = useQueryClient();
  const refreshUser = useAuthStore((s) => s.refreshUser);

  const { data, isLoading } = useQuery({
    queryKey: ['kushki-consignaciones'],
    queryFn: () => kushkiApi.consignaciones(),
    select: (res) => res.data.consignaciones as Consignacion[],
  });

  // Verifica un PSE pendiente sin depender de haber vuelto del banco.
  const verificar = useMutation({
    mutationFn: (token: string) => kushkiApi.confirmarPSE(token),
    onSuccess: async ({ data: res }) => {
      if (res.estado === 'completado') {
        await refreshUser();
        toast.success('¡Pago acreditado a tu billetera!');
      } else if (res.estado === 'rechazado') {
        toast.error('Tu banco no autorizó esta transacción.');
      } else {
        toast('Tu banco todavía está validando el pago.');
      }
      queryClient.invalidateQueries({ queryKey: ['kushki-consignaciones'] });
    },
    onError: (err: any) => toast.error(err.response?.data?.mensaje || 'No se pudo verificar el pago'),
  });

  const consignaciones = data || [];

  return (
    <UserModal title="Mis consignaciones" subtitle="Pagos con tarjeta y PSE" size="lg">
      <div className="tp-modal-content">
        {isLoading && <p>Cargando...</p>}
        {!isLoading && consignaciones.length === 0 && <EmptyState title="Aún no tienes consignaciones" />}

        {consignaciones.map((c) => {
          const estado = ESTADOS[c.estado];
          return (
            <div key={c.id} className="tp-info-dest" style={{ justifyContent: 'space-between' }}>
              <div>
                <strong>{fmtCOP(c.monto)} · {c.metodo === 'pse' ? 'PSE' : 'Tarjeta'}</strong>
                <p>{new Date(c.createdAt).toLocaleString('es-CO')}</p>
              </div>
              <div style={{ display: 'grid', gap: 8, justifyItems: 'end' }}>
                <StatusPill tone={estado.tone}>{estado.label}</StatusPill>
                {c.token && (
                  <button
                    type="button"
                    className="tp-link-button"
                    disabled={verificar.isPending}
                    onClick={() => verificar.mutate(c.token!)}
                  >
                    <RefreshCw size={13} /> Verificar ahora
                  </button>
                )}
              </div>
            </div>
          );
        })}

        <ThemeButton tone="ghost" href="/dashboard/consignar">Nueva consignación</ThemeButton>
      </div>
    </UserModal>
  );
}
