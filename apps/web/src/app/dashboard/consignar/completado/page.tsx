'use client';

import { useEffect, useRef, useState } from 'react';
import { CheckCircle2, Clock, RefreshCw, XCircle } from 'lucide-react';
import { useAuthStore } from '@/store/authStore';
import { rapydApi } from '@/lib/api';
import { ThemeButton, UserModal, fmtCOP } from '@/components/user/UserTheme';

type Estado = 'verificando' | 'completado' | 'pendiente' | 'rechazado' | 'sin_referencia';

const MAX_INTENTOS = 5;

export default function ConsignarCompletadoPage() {
  const user = useAuthStore((s) => s.user);
  const refreshUser = useAuthStore((s) => s.refreshUser);
  const [estado, setEstado] = useState<Estado>('verificando');
  const intentos = useRef(0);

  async function verificar() {
    const ref = new URLSearchParams(window.location.search).get('ref');
    if (!ref) {
      setEstado('sin_referencia');
      return;
    }

    try {
      const { data } = await rapydApi.verificar(ref);
      if (data.estado === 'completado') {
        await refreshUser();
        setEstado('completado');
        return;
      }
      if (data.estado === 'rechazado') {
        setEstado('rechazado');
        return;
      }
      // Sigue pendiente: puede que Rapyd todavía no confirme el pago. Reintenta unas veces.
      intentos.current += 1;
      if (intentos.current < MAX_INTENTOS) {
        setTimeout(verificar, 2000);
      } else {
        setEstado('pendiente');
      }
    } catch {
      setEstado('pendiente');
    }
  }

  useEffect(() => {
    verificar();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function reintentar() {
    intentos.current = 0;
    setEstado('verificando');
    verificar();
  }

  const contenido: Record<Estado, { icon: JSX.Element; titulo: string; texto: string }> = {
    verificando: { icon: <Clock size={22} />, titulo: 'Confirmando tu pago...', texto: 'Estamos consultando a Rapyd el estado de tu consignación.' },
    completado:  { icon: <CheckCircle2 size={22} />, titulo: '¡Consignación exitosa!', texto: 'Tu saldo ya fue actualizado.' },
    pendiente:   { icon: <Clock size={22} />, titulo: 'Aún no se confirma', texto: 'Puede tardar unos segundos más. Intenta actualizar.' },
    rechazado:   { icon: <XCircle size={22} />, titulo: 'El pago no se completó', texto: 'Intenta consignar de nuevo desde el inicio.' },
    sin_referencia: { icon: <XCircle size={22} />, titulo: 'No pudimos identificar el pago', texto: 'Vuelve a intentar la consignación.' },
  };

  const { icon, titulo, texto } = contenido[estado];

  return (
    <UserModal title="Consignar a mi billetera" subtitle="Confirmación de pago con Rapyd">
      <div className="tp-modal-content">
        <div className="tp-info-dest">
          <div className="tp-info-icon">{icon}</div>
          <div>
            <strong>{titulo}</strong>
            <p>{texto}</p>
          </div>
        </div>
        <div className="tp-info-dest">
          <div>
            <strong>Saldo actual</strong>
            <p>{fmtCOP(user?.saldo)}</p>
          </div>
        </div>
        {estado !== 'verificando' && estado !== 'completado' && (
          <ThemeButton onClick={reintentar}><RefreshCw size={18} /> Actualizar</ThemeButton>
        )}
        <ThemeButton tone="secondary" href="/dashboard">Volver al inicio</ThemeButton>
      </div>
    </UserModal>
  );
}
