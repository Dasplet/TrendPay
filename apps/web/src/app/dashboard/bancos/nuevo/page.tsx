'use client';

import { useState } from 'react';
import toast from 'react-hot-toast';
import { useRouter } from 'next/navigation';
import { Building2 } from 'lucide-react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useAuthStore } from '@/store/authStore';
import { bankAccountsApi } from '@/lib/api';
import { BankAccountFields, ThemeButton, UserModal, useBanksList } from '@/components/user/UserTheme';

export default function NuevoBancoPage() {
  const router = useRouter();
  const queryClient = useQueryClient();
  const user = useAuthStore((s) => s.user);

  const [bancoId, setBancoId] = useState('');
  const [tipoCuenta, setTipoCuenta] = useState('ahorros');
  const [numeroCuenta, setNumeroCuenta] = useState('');
  const [nombreTitular, setNombreTitular] = useState(user?.nombre || '');
  const [cedulaTitular, setCedulaTitular] = useState(user?.cedula || '');
  const [alias, setAlias] = useState('');

  const { data: bancos } = useBanksList();

  const banco = (bancos || []).find((b: any) => b.id === bancoId);

  const vincularMutation = useMutation({
    mutationFn: () => bankAccountsApi.create({
      bancoId,
      bancoNombre: banco?.nombre,
      tipoCuenta,
      numeroCuenta,
      cedulaTitular,
      nombreTitular,
      alias: alias || undefined,
    }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['bank-accounts'] });
      toast.success('Banco vinculado');
      router.push('/dashboard/bancos');
    },
    onError: (err: any) => toast.error(err.response?.data?.mensaje || 'No se pudo vincular el banco'),
  });

  function vincular() {
    if (!bancoId) return toast.error('Selecciona un banco');
    if (!numeroCuenta || numeroCuenta.length < 4) return toast.error('Ingresa el número de cuenta');
    if (!nombreTitular.trim()) return toast.error('Ingresa el nombre del titular');
    if (!cedulaTitular.trim()) return toast.error('Ingresa la cédula del titular');
    vincularMutation.mutate();
  }

  return (
    <UserModal title="Vincular nuevo banco" subtitle="Guarda una cuenta para usarla al retirar" size="lg">
      <div className="tp-modal-content">
        <BankAccountFields
          bancos={bancos || []}
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
        <label className="tp-form-field">
          <span>Alias (opcional)</span>
          <input value={alias} onChange={(e) => setAlias(e.target.value)} placeholder="Ej. Mi cuenta principal" />
        </label>

        <ThemeButton disabled={!bancoId || vincularMutation.isPending} onClick={vincular}>
          <Building2 size={18} /> {vincularMutation.isPending ? 'Vinculando...' : 'Vincular banco'}
        </ThemeButton>
      </div>
    </UserModal>
  );
}
