'use client';

import { useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import toast from 'react-hot-toast';
import { CheckCircle2, Wallet } from 'lucide-react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useAuthStore } from '@/store/authStore';
import { walletApi } from '@/lib/api';
import { AmountPicker, ThemeButton, UserModal, fmtCOP } from '@/components/user/UserTheme';

export default function PagarQrPage() {
  const params = useParams<{ token: string }>();
  const token = params.token;
  const router = useRouter();
  const queryClient = useQueryClient();
  const refreshUser = useAuthStore((s) => s.refreshUser);
  const [amount, setAmount] = useState(0);

  const { data, isLoading } = useQuery({
    queryKey: ['qr-preview', token],
    queryFn: () => walletApi.qrPreview(token),
    select: (res) => res.data.qr,
    retry: false,
  });

  const payMutation = useMutation({
    mutationFn: () => walletApi.qrPagar(token, data?.monto ? undefined : { monto: amount }),
    onSuccess: async () => {
      await refreshUser();
      queryClient.invalidateQueries({ queryKey: ['wallet-history-home'] });
      queryClient.invalidateQueries({ queryKey: ['wallet-history-full'] });
      toast.success('Pago realizado');
      router.push('/dashboard/historial');
    },
    onError: (err: any) => toast.error(err.response?.data?.mensaje || 'No se pudo pagar el QR'),
  });

  if (isLoading) {
    return (
      <UserModal title="Pagar QR" subtitle="Cargando información del cobro...">
        <div className="tp-modal-content" />
      </UserModal>
    );
  }

  if (!data) {
    return (
      <UserModal title="Pagar QR" subtitle="Este QR no existe o el enlace es inválido">
        <div className="tp-modal-content">
          <ThemeButton href="/dashboard">Volver al inicio</ThemeButton>
        </div>
      </UserModal>
    );
  }

  if (data.esPropio) {
    return (
      <UserModal title="Pagar QR" subtitle="Este es tu propio QR de cobro">
        <div className="tp-modal-content">
          <p className="tp-warning">Comparte este enlace con la persona que te va a pagar · no lo pagues tú mismo.</p>
          <ThemeButton href="/dashboard">Volver al inicio</ThemeButton>
        </div>
      </UserModal>
    );
  }

  if (data.usado) {
    return (
      <UserModal title="Pagar QR" subtitle="Este QR ya fue pagado">
        <div className="tp-modal-content">
          <ThemeButton href="/dashboard">Volver al inicio</ThemeButton>
        </div>
      </UserModal>
    );
  }

  if (data.expirado) {
    return (
      <UserModal title="Pagar QR" subtitle="Este QR ya expiró">
        <div className="tp-modal-content">
          <ThemeButton href="/dashboard">Volver al inicio</ThemeButton>
        </div>
      </UserModal>
    );
  }

  return (
    <UserModal title={`Pagar a ${data.propietario?.nombre || 'usuario TrendPay'}`} subtitle={data.concepto || 'Cobro con QR TrendPay'}>
      <div className="tp-modal-content">
        <div className="tp-info-dest">
          <div className="tp-info-icon"><Wallet size={22} /></div>
          <div>
            <strong>{data.propietario?.nombre}</strong>
            <p>{data.monto ? `Te pide ${fmtCOP(data.monto)}` : 'Monto libre · elige cuánto pagar'}</p>
          </div>
        </div>
        {!data.monto && <AmountPicker value={amount} setValue={setAmount} />}
        <ThemeButton
          disabled={payMutation.isPending || (!data.monto && !amount)}
          onClick={() => payMutation.mutate()}
        >
          <CheckCircle2 size={18} /> {payMutation.isPending ? 'Pagando...' : `Pagar ${fmtCOP(data.monto || amount)}`}
        </ThemeButton>
      </div>
    </UserModal>
  );
}
