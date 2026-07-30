'use client';

import { useState } from 'react';
import toast from 'react-hot-toast';
import { useRouter } from 'next/navigation';
import { KeyRound } from 'lucide-react';
import { useMutation } from '@tanstack/react-query';
import { authApi } from '@/lib/api';
import { ThemeButton, UserModal } from '@/components/user/UserTheme';

const PIN_REGEX = /^\d{4}$/;

export default function CambiarPinPage() {
  const router = useRouter();
  const [pinActual, setPinActual] = useState('');
  const [pinNuevo, setPinNuevo] = useState('');
  const [pinConfirmar, setPinConfirmar] = useState('');

  const cambiarMutation = useMutation({
    mutationFn: () => authApi.changePin({ pin_actual: pinActual, pin_nuevo: pinNuevo, pin_confirmar: pinConfirmar }),
    onSuccess: () => {
      toast.success('PIN actualizado correctamente');
      router.push('/dashboard/seguridad');
    },
    onError: (err: any) => toast.error(err.response?.data?.mensaje || 'No se pudo cambiar el PIN'),
  });

  function cambiar() {
    if (!PIN_REGEX.test(pinActual)) return toast.error('Ingresa tu PIN actual (4 dígitos)');
    if (!PIN_REGEX.test(pinNuevo)) return toast.error('El PIN nuevo debe tener 4 dígitos');
    if (pinNuevo !== pinConfirmar) return toast.error('El PIN nuevo y la confirmación no coinciden');
    if (pinNuevo === pinActual) return toast.error('El PIN nuevo debe ser diferente al actual');
    cambiarMutation.mutate();
  }

  return (
    <UserModal title="Cambiar PIN" subtitle="Usa 4 dígitos que no compartas con nadie">
      <div className="tp-modal-content">
        <label className="tp-form-field">
          <span>PIN actual</span>
          <input
            value={pinActual}
            onChange={(e) => setPinActual(e.target.value.replace(/\D/g, '').slice(0, 4))}
            type="password"
            inputMode="numeric"
            maxLength={4}
            placeholder="••••"
          />
        </label>
        <label className="tp-form-field">
          <span>PIN nuevo</span>
          <input
            value={pinNuevo}
            onChange={(e) => setPinNuevo(e.target.value.replace(/\D/g, '').slice(0, 4))}
            type="password"
            inputMode="numeric"
            maxLength={4}
            placeholder="••••"
          />
        </label>
        <label className="tp-form-field">
          <span>Confirmar PIN nuevo</span>
          <input
            value={pinConfirmar}
            onChange={(e) => setPinConfirmar(e.target.value.replace(/\D/g, '').slice(0, 4))}
            type="password"
            inputMode="numeric"
            maxLength={4}
            placeholder="••••"
          />
        </label>
        <ThemeButton disabled={cambiarMutation.isPending} onClick={cambiar}>
          <KeyRound size={18} /> {cambiarMutation.isPending ? 'Cambiando...' : 'Cambiar PIN'}
        </ThemeButton>
      </div>
    </UserModal>
  );
}
