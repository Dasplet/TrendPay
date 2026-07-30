'use client';

import { useEffect, useState } from 'react';
import toast from 'react-hot-toast';
import { useMutation } from '@tanstack/react-query';
import { ArrowRight } from 'lucide-react';
import { useAuthStore } from '@/store/authStore';
import { rapydApi } from '@/lib/api';
import { AmountPicker, InfoDestination, ThemeButton, UserModal } from '@/components/user/UserTheme';

export default function ConsignarPage() {
  const user = useAuthStore((s) => s.user);
  const [amount, setAmount] = useState(0);

  useEffect(() => {
    if (new URLSearchParams(window.location.search).get('error') === '1') {
      toast.error('El pago no se completó · intenta de nuevo');
    }
  }, []);

  const consignarMutation = useMutation({
    mutationFn: () => rapydApi.consignar(amount),
    onSuccess: ({ data }) => {
      window.location.href = data.redirectUrl;
    },
    onError: (err: any) => toast.error(err.response?.data?.mensaje || 'No se pudo iniciar la consignación'),
  });

  return (
    <UserModal title="Consignar a mi billetera" subtitle="Paga con tarjeta, PSE o el método que prefieras">
      <div className="tp-modal-content">
        <InfoDestination saldo={user?.saldo} />
        <AmountPicker value={amount} setValue={setAmount} />
        <ThemeButton disabled={!amount || consignarMutation.isPending} onClick={() => consignarMutation.mutate()}>
          {consignarMutation.isPending ? 'Redirigiendo...' : <><ArrowRight size={18} /> Continuar</>}
        </ThemeButton>
      </div>
    </UserModal>
  );
}
