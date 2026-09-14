'use client';

import { useState } from 'react';
import toast from 'react-hot-toast';
import { useMutation } from '@tanstack/react-query';
import { Kushki } from '@kushki/js';
import { ArrowRight } from 'lucide-react';
import { useAuthStore } from '@/store/authStore';
import { kushkiApi } from '@/lib/api';
import { AmountPicker, InfoDestination, ThemeButton, UserModal } from '@/components/user/UserTheme';

const KUSHKI_PUBLIC_MERCHANT_ID = process.env.NEXT_PUBLIC_KUSHKI_PUBLIC_MERCHANT_ID || '';
const KUSHKI_IN_TEST_ENVIRONMENT = process.env.NEXT_PUBLIC_KUSHKI_IN_TEST_ENVIRONMENT !== 'false';

// La tarjeta se tokeniza aquí, en el navegador, con Kushki.js — el número
// nunca llega a nuestro servidor, solo el token de un solo uso que devuelve.
function tokenizarTarjeta(card: { name: string; number: string; expiryMonth: string; expiryYear: string; cvc: string }, monto: number) {
  return new Promise<string>((resolve, reject) => {
    if (!KUSHKI_PUBLIC_MERCHANT_ID) {
      reject(new Error('Pagos con tarjeta no configurados'));
      return;
    }
    const kushki = new Kushki({ merchantId: KUSHKI_PUBLIC_MERCHANT_ID, inTestEnvironment: KUSHKI_IN_TEST_ENVIRONMENT });
    kushki.requestToken({ card, amount: monto, currency: 'COP' }, (response) => {
      if ('token' in response) resolve(response.token);
      else reject(new Error(response.message || 'No se pudo validar la tarjeta'));
    });
  });
}

export default function ConsignarPage() {
  const user = useAuthStore((s) => s.user);
  const refreshUser = useAuthStore((s) => s.refreshUser);
  const [amount, setAmount] = useState(0);
  const [card, setCard] = useState({ name: '', number: '', expiryMonth: '', expiryYear: '', cvc: '' });

  function setField(field: keyof typeof card, value: string) {
    setCard((c) => ({ ...c, [field]: value }));
  }

  const consignarMutation = useMutation({
    mutationFn: async () => {
      const token = await tokenizarTarjeta(card, amount);
      return kushkiApi.consignarTarjeta(token, amount);
    },
    onSuccess: async () => {
      await refreshUser();
      toast.success('¡Consignación exitosa! Tu saldo ya fue actualizado');
      window.location.href = '/dashboard';
    },
    onError: (err: any) => toast.error(err.response?.data?.mensaje || err.message || 'No se pudo procesar el pago'),
  });

  const formCompleto = amount > 0 && card.name && card.number.length >= 15 && card.expiryMonth && card.expiryYear && card.cvc.length >= 3;

  return (
    <UserModal title="Consignar a mi billetera" subtitle="Paga con tu tarjeta de crédito o débito">
      <div className="tp-modal-content">
        <InfoDestination saldo={user?.saldo} />
        <AmountPicker value={amount} setValue={setAmount} />

        <label className="tp-form-field">
          <span>Nombre en la tarjeta</span>
          <input value={card.name} onChange={(e) => setField('name', e.target.value)} placeholder="Como aparece en la tarjeta" />
        </label>
        <label className="tp-form-field">
          <span>Número de tarjeta</span>
          <input
            value={card.number}
            onChange={(e) => setField('number', e.target.value.replaceAll(/\D/g, ''))}
            placeholder="0000 0000 0000 0000"
            inputMode="numeric"
            maxLength={19}
          />
        </label>
        <div style={{ display: 'flex', gap: 12 }}>
          <label className="tp-form-field" style={{ flex: 1 }}>
            <span>Mes</span>
            <input value={card.expiryMonth} onChange={(e) => setField('expiryMonth', e.target.value.replaceAll(/\D/g, ''))} placeholder="MM" inputMode="numeric" maxLength={2} />
          </label>
          <label className="tp-form-field" style={{ flex: 1 }}>
            <span>Año</span>
            <input value={card.expiryYear} onChange={(e) => setField('expiryYear', e.target.value.replaceAll(/\D/g, ''))} placeholder="AA" inputMode="numeric" maxLength={2} />
          </label>
          <label className="tp-form-field" style={{ flex: 1 }}>
            <span>CVC</span>
            <input value={card.cvc} onChange={(e) => setField('cvc', e.target.value.replaceAll(/\D/g, ''))} placeholder="123" inputMode="numeric" maxLength={4} />
          </label>
        </div>

        <ThemeButton disabled={!formCompleto || consignarMutation.isPending} onClick={() => consignarMutation.mutate()}>
          {consignarMutation.isPending ? 'Procesando...' : <><ArrowRight size={18} /> Consignar</>}
        </ThemeButton>
      </div>
    </UserModal>
  );
}
