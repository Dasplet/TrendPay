'use client';

import { useState } from 'react';
import toast from 'react-hot-toast';
import { useRouter } from 'next/navigation';
import { Building2, ChevronRight } from 'lucide-react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useAuthStore } from '@/store/authStore';
import { banksApi, bankAccountsApi } from '@/lib/api';
import { ThemeButton, UserModal } from '@/components/user/UserTheme';

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

  const { data: bancos } = useQuery({
    queryKey: ['banks-list'],
    queryFn: () => banksApi.list(),
    select: (res) => res.data.bancos || [],
  });

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
        <p className="tp-modal-label">Selecciona el banco:</p>
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
