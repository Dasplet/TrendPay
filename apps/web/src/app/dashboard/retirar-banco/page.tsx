'use client';

import { useState } from 'react';
import toast from 'react-hot-toast';
import { useRouter } from 'next/navigation';
import { Building2 } from 'lucide-react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useAuthStore } from '@/store/authStore';
import { withdrawalsApi } from '@/lib/api';
import { AmountPicker, BankAccountFields, ThemeButton, UserModal, fmtCOP, useBanksList } from '@/components/user/UserTheme';

export default function RetirarBancoPage() {
  const router = useRouter();
  const queryClient = useQueryClient();
  const user = useAuthStore((s) => s.user);
  const refreshUser = useAuthStore((s) => s.refreshUser);

  const [bancoId, setBancoId] = useState('');
  const [tipoCuenta, setTipoCuenta] = useState('ahorros');
  const [numeroCuenta, setNumeroCuenta] = useState('');
  const [nombreTitular, setNombreTitular] = useState(user?.nombre || '');
  const [cedulaTitular, setCedulaTitular] = useState(user?.cedula || '');
  const [amount, setAmount] = useState(0);

  const { data: bancos } = useBanksList();

  const banco = (bancos || []).find((b: any) => b.id === bancoId);

  const withdrawMutation = useMutation({
    mutationFn: () => withdrawalsApi.create({
      bancoNombre: banco?.nombre,
      tipoCuenta,
      numeroCuenta,
      cedulaTitular,
      nombreTitular,
      monto: amount,
    }),
    onSuccess: async ({ data }) => {
      await refreshUser();
      queryClient.invalidateQueries({ queryKey: ['wallet-history-home'] });
      queryClient.invalidateQueries({ queryKey: ['wallet-history-full'] });
      toast.success(data.mensaje || 'Solicitud de retiro creada');
      router.push('/dashboard/historial');
    },
    onError: (err: any) => toast.error(err.response?.data?.mensaje || 'No se pudo crear el retiro'),
  });

  function withdraw() {
    if (!bancoId) return toast.error('Selecciona un banco');
    if (!numeroCuenta || numeroCuenta.length < 4) return toast.error('Ingresa el número de cuenta');
    if (!nombreTitular) return toast.error('Ingresa el nombre del titular');
    if (!cedulaTitular) return toast.error('Ingresa la cédula del titular');
    if (!amount) return toast.error('Selecciona un monto');
    if (amount > Number(user?.saldo || 0)) return toast.error('Saldo insuficiente');
    withdrawMutation.mutate();
  }

  let ctaLabel: string;
  if (withdrawMutation.isPending) ctaLabel = 'Enviando...';
  else if (banco) ctaLabel = `Retirar a ${banco.nombre}`;
  else ctaLabel = 'Selecciona un banco';

  return (
    <UserModal title="Retirar a banco" subtitle="El dinero sale de tu billetera · procesamiento manual en 1 día hábil" size="lg">
      <div className="tp-modal-content">
        <div className="tp-balance-alert"><Building2 size={25} /><div><strong>Saldo disponible: {fmtCOP(user?.saldo)}</strong><small>Sin comisión</small></div></div>

        <BankAccountFields
          bancos={bancos || []}
          label="Selecciona el banco destino:"
          bancoId={bancoId}
          setBancoId={setBancoId}
          tipoCuenta={tipoCuenta}
          setTipoCuenta={setTipoCuenta}
          numeroCuenta={numeroCuenta}
          setNumeroCuenta={setNumeroCuenta}
          nombreTitular={nombreTitular}
          setNombreTitular={setNombreTitular}
          cedulaTitular={cedulaTitular}
          setCedulaTitular={setCedulaTitular}
        />

        <AmountPicker value={amount} setValue={setAmount} options={[50000, 100000, 200000, 500000]} />
        <ThemeButton disabled={!bancoId || withdrawMutation.isPending} onClick={withdraw}>
          <Building2 size={18} /> {ctaLabel}
        </ThemeButton>
      </div>
    </UserModal>
  );
}
