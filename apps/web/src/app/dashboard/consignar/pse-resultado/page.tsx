'use client';

import { Suspense, useEffect, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { CheckCircle2, Clock, XCircle } from 'lucide-react';
import { useAuthStore } from '@/store/authStore';
import { kushkiApi } from '@/lib/api';
import { ThemeButton, UserModal } from '@/components/user/UserTheme';

type Estado = 'verificando' | 'completado' | 'pendiente' | 'rechazado' | 'error';

// Kushki redirige aquí con ?token=... después de que el usuario autoriza (o
// cancela) el débito en su banco. El estado real solo se sabe consultando a
// nuestro backend — nunca se acredita saldo con base en la sola presencia
// del token en la URL.
function PseResultadoContent() {
  const params = useSearchParams();
  const token = params.get('token');
  const refreshUser = useAuthStore((s) => s.refreshUser);
  const [estado, setEstado] = useState<Estado>('verificando');
  const [mensaje, setMensaje] = useState('');

  useEffect(() => {
    if (!token) { setEstado('error'); setMensaje('No se recibió información de la transacción'); return; }

    let cancelado = false;
    async function verificar() {
      try {
        const { data } = await kushkiApi.confirmarPSE(token!);
        if (cancelado) return;
        if (data.estado === 'completado') {
          setEstado('completado');
          await refreshUser();
        } else if (data.estado === 'rechazado') {
          setEstado('rechazado');
        } else {
          setEstado('pendiente');
        }
      } catch (err: any) {
        if (!cancelado) {
          setEstado('error');
          setMensaje(err.response?.data?.mensaje || 'No se pudo verificar el pago');
        }
      }
    }
    verificar();
    return () => { cancelado = true; };
  }, [token, refreshUser]);

  return (
    <UserModal title="Consignación por PSE">
      <div className="tp-modal-content" style={{ textAlign: 'center', paddingTop: 12 }}>
        {estado === 'verificando' && <p>Verificando el estado de tu pago...</p>}

        {estado === 'completado' && (
          <>
            <CheckCircle2 size={56} color="#6CC998" style={{ margin: '0 auto' }} />
            <p>¡Consignación exitosa! Tu saldo ya fue actualizado.</p>
            <ThemeButton href="/dashboard">Ir a mi billetera</ThemeButton>
          </>
        )}

        {estado === 'pendiente' && (
          <>
            <Clock size={56} color="#e0a72c" style={{ margin: '0 auto' }} />
            <p>Tu banco todavía está validando la transacción. Esto puede tardar unos minutos — no necesitas hacer nada más, tu saldo se actualizará solo cuando se confirme.</p>
            <ThemeButton href="/dashboard">Volver a mi billetera</ThemeButton>
          </>
        )}

        {(estado === 'rechazado' || estado === 'error') && (
          <>
            <XCircle size={56} color="#e5484d" style={{ margin: '0 auto' }} />
            <p>{estado === 'rechazado' ? 'Tu banco no autorizó la transacción.' : mensaje}</p>
            <ThemeButton href="/dashboard/consignar">Intentar de nuevo</ThemeButton>
          </>
        )}
      </div>
    </UserModal>
  );
}

export default function PseResultadoPage() {
  return (
    <Suspense fallback={null}>
      <PseResultadoContent />
    </Suspense>
  );
}
