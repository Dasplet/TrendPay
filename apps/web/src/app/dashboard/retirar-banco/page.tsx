'use client';

import { useState } from 'react';
import toast from 'react-hot-toast';
import { useRouter } from 'next/navigation';
import { Building2, ChevronRight } from 'lucide-react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useAuthStore } from '@/store/authStore';
import { banksApi, withdrawalsApi } from '@/lib/api';
import { AmountPicker, ThemeButton, UserModal, fmtCOP } from '@/components/user/UserTheme';

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

  const { data: bancos } = useQuery({
    queryKey: ['banks-list'],
    queryFn: () => banksApi.list(),
    select: (res) => res.data.bancos || [],
  });

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

  return (
    <UserModal title="Retirar a banco" subtitle="El dinero sale de tu billetera · procesamiento manual en 1 día hábil" size="lg">
      <div className="tp-modal-content">
        <div className="tp-balance-alert"><Building2 size={25} /><div><strong>Saldo disponible: {fmtCOP(user?.saldo)}</strong><small>Sin comisión</small></div></div>

        <p className="tp-modal-label">Selecciona el banco destino:</p>
        <div className="tp-bank-list">
          {(bancos || []).map((b: any) => (
            <button key={b.id} onClick={() => setBancoId(b.id)} className={bancoId === b.id ? 'selected' : ''}>
              <span className="tp-bank-logo">{b.nombre.slice(0, 2).toUpperCase()}</span>
              <div><strong>{b.nombre} {b.nuevo && <em>Nuevo</em>}</strong></div>
              <ChevronRight size={19} />
            </button>
          ))}
        </div>

        <label className="tp-form-field">
          <span>Tipo de cuenta</span>
          <select value={tipoCuenta} onChange={(e) => setTipoCuenta(e.target.value)}>
            <option value="ahorros">Ahorros</option>
            <option value="corriente">Corriente</option>
          </select>
        </label>
        <label className="tp-form-field">
          <span>Número de cuenta</span>
          <input value={numeroCuenta} onChange={(e) => setNumeroCuenta(e.target.value.replace(/\D/g, ''))} placeholder="Ej. 04512345678" inputMode="numeric" />
        </label>
        <label className="tp-form-field">
          <span>Nombre del titular</span>
          <input value={nombreTitular} onChange={(e) => setNombreTitular(e.target.value)} placeholder="Nombre completo" />
        </label>
        <label className="tp-form-field">
          <span>Cédula del titular</span>
          <input value={cedulaTitular} onChange={(e) => setCedulaTitular(e.target.value.replace(/\D/g, ''))} placeholder="Ej. 1023456789" inputMode="numeric" />
        </label>

        <AmountPicker value={amount} setValue={setAmount} options={[50000, 100000, 200000, 500000]} />
        <ThemeButton disabled={!bancoId || withdrawMutation.isPending} onClick={withdraw}>
          <Building2 size={18} /> {withdrawMutation.isPending ? 'Enviando...' : banco ? `Retirar a ${banco.nombre}` : 'Selecciona un banco'}
        </ThemeButton>
      </div>
    </UserModal>
  );
}
