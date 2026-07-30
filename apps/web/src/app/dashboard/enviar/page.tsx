'use client';

import { useState } from 'react';
import toast from 'react-hot-toast';
import { Send } from 'lucide-react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useRouter } from 'next/navigation';
import { walletApi } from '@/lib/api';
import { useAuthStore } from '@/store/authStore';
import { AmountPicker, ThemeButton, UserModal } from '@/components/user/UserTheme';

export default function EnviarPage() {
  const router = useRouter();
  const queryClient = useQueryClient();
  const user = useAuthStore((s) => s.user);
  const refreshUser = useAuthStore((s) => s.refreshUser);
  const [destino, setDestino] = useState('');
  const [amount, setAmount] = useState(0);
  const [note, setNote] = useState('');

  const commission = Math.ceil(amount * 0.03);
  const total = amount + commission;

  const sendMutation = useMutation({
    mutationFn: () => walletApi.send({ destino, monto: amount, nota: note || undefined }),
    onSuccess: async () => {
      await refreshUser();
      queryClient.invalidateQueries({ queryKey: ['wallet-history-home'] });
      queryClient.invalidateQueries({ queryKey: ['wallet-history-full'] });
      toast.success('Envío realizado');
      router.push('/dashboard/historial');
    },
    onError: (err: any) => {
      toast.error(err.response?.data?.mensaje || 'No se pudo enviar el dinero');
    },
  });

  function sendMoney() {
    if (!destino) return toast.error('Ingresa celular, correo o cédula del destinatario');
    if (!amount) return toast.error('Selecciona un monto');
    if (total > Number(user?.saldo || 0)) return toast.error('Saldo insuficiente');
    sendMutation.mutate();
  }

  return (
    <UserModal title="Enviar a otro usuario" subtitle="Sale de tu billetera · llega a la del destinatario">
      <div className="tp-modal-content">
        <label className="tp-form-field"><span>Celular, correo o cédula</span><input value={destino} onChange={(e) => setDestino(e.target.value)} placeholder="Ej. 3001234567" /></label>
        <AmountPicker value={amount} setValue={setAmount} />
        <label className="tp-form-field"><span>Nota (opcional)</span><input value={note} onChange={(e) => setNote(e.target.value)} placeholder="Ej. Mitad del almuerzo" /></label>
        <div className="tp-warning">% · Tarifa de transacción: 3% adicional ({commission.toLocaleString('es-CO')} COP). Total a debitar: {total.toLocaleString('es-CO')} COP.</div>
        <ThemeButton disabled={sendMutation.isPending} onClick={sendMoney}><Send size={18} /> {sendMutation.isPending ? 'Enviando...' : 'Enviar'}</ThemeButton>
      </div>
    </UserModal>
  );
}
