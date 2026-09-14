'use client';

import { useState } from 'react';
import toast from 'react-hot-toast';
import { useMutation, useQuery } from '@tanstack/react-query';
import { Kushki } from '@kushki/js';
import { ArrowLeft, ArrowRight, Building2, CreditCard } from 'lucide-react';
import { useAuthStore } from '@/store/authStore';
import { kushkiApi } from '@/lib/api';
import { AmountPicker, fmtCOP, InfoDestination, OperationCard, ThemeButton, UserModal } from '@/components/user/UserTheme';

const KUSHKI_PUBLIC_MERCHANT_ID = process.env.NEXT_PUBLIC_KUSHKI_PUBLIC_MERCHANT_ID || '';
const KUSHKI_IN_TEST_ENVIRONMENT = process.env.NEXT_PUBLIC_KUSHKI_IN_TEST_ENVIRONMENT !== 'false';

type Paso = 'monto' | 'metodo' | 'tarjeta' | 'pse';
type Metodo = 'tarjeta' | 'pse';

function kushkiClient() {
  if (!KUSHKI_PUBLIC_MERCHANT_ID) return null;
  return new Kushki({ merchantId: KUSHKI_PUBLIC_MERCHANT_ID, inTestEnvironment: KUSHKI_IN_TEST_ENVIRONMENT });
}

// La tarjeta se tokeniza aquí, en el navegador, con Kushki.js — el número
// nunca llega a nuestro servidor, solo el token de un solo uso que devuelve.
function tokenizarTarjeta(card: { name: string; number: string; expiryMonth: string; expiryYear: string; cvc: string }, monto: number) {
  return new Promise<string>((resolve, reject) => {
    const kushki = kushkiClient();
    if (!kushki) { reject(new Error('Pagos con tarjeta no configurados')); return; }
    kushki.requestToken({ card, amount: monto, currency: 'COP' }, (response) => {
      if ('token' in response) resolve(response.token);
      else reject(new Error(response.message || 'No se pudo validar la tarjeta'));
    });
  });
}

// El token de transferencia solo abre la operación en Kushki — no cobra
// nada. Nuestro backend lo usa después (POST /consignar/pse/iniciar) para
// obtener la redirectUrl que lleva al usuario a autorizar el débito en su
// banco.
function tokenizarPSE(datos: { bankId: string; documentType: string; documentNumber: string; email: string }, monto: number) {
  return new Promise<string>((resolve, reject) => {
    const kushki = kushkiClient();
    if (!kushki) { reject(new Error('Pagos con PSE no configurados')); return; }
    kushki.requestTransferToken(
      {
        bankId: datos.bankId,
        callbackUrl: `${window.location.origin}/dashboard/consignar/pse-resultado`,
        userType: '0',
        documentType: datos.documentType as any,
        documentNumber: datos.documentNumber,
        email: datos.email,
        currency: 'COP',
        amount: { subtotalIva: 0, subtotalIva0: monto, iva: 0 },
      },
      (response) => {
        if ('token' in response) resolve(response.token);
        else reject(new Error(response.message || 'No se pudo iniciar la transacción PSE'));
      }
    );
  });
}

function useBancosPSE() {
  return useQuery({
    queryKey: ['kushki-bank-list'],
    queryFn: () =>
      new Promise<Array<{ code: string; name: string }>>((resolve, reject) => {
        const kushki = kushkiClient();
        if (!kushki) { resolve([]); return; }
        kushki.requestBankList((response) => {
          if (Array.isArray(response)) resolve(response.filter((b) => b.code !== '0'));
          else reject(new Error('No se pudo cargar la lista de bancos'));
        });
      }),
  });
}

export default function ConsignarPage() {
  const user = useAuthStore((s) => s.user);
  const refreshUser = useAuthStore((s) => s.refreshUser);
  const [paso, setPaso] = useState<Paso>('monto');
  const [metodo, setMetodo] = useState<Metodo | null>(null);
  const [amount, setAmount] = useState(0);
  const [card, setCard] = useState({ name: '', number: '', expiryMonth: '', expiryYear: '', cvc: '' });
  const [pse, setPse] = useState({ bankId: '', documentType: 'CC', documentNumber: '', email: user?.correo || '', nombreCompleto: user?.nombre || '', telefono: '' });

  const bancos = useBancosPSE();

  function setCardField(field: keyof typeof card, value: string) {
    setCard((c) => ({ ...c, [field]: value }));
  }

  function setPseField(field: keyof typeof pse, value: string) {
    setPse((p) => ({ ...p, [field]: value }));
  }

  // El usuario paga la comisión encima del monto elegido — igual que
  // "Enviar" — así que Kushki cobra monto+comisión, pero la billetera solo
  // se acredita con el monto elegido.
  const comisionValor = Math.ceil(amount * 0.03);
  const totalACobrar = amount + comisionValor;

  const consignarMutation = useMutation({
    mutationFn: async () => {
      // Kushki exige que el monto cobrado coincida con el monto con el que
      // se tokenizó la tarjeta — hay que tokenizar por el total (monto +
      // comisión), no por el monto neto que recibe la billetera.
      const token = await tokenizarTarjeta(card, totalACobrar);
      return kushkiApi.consignarTarjeta(token, amount);
    },
    onSuccess: async () => {
      await refreshUser();
      toast.success('¡Consignación exitosa! Tu saldo ya fue actualizado');
      window.location.href = '/dashboard';
    },
    onError: (err: any) => toast.error(err.response?.data?.mensaje || err.message || 'No se pudo procesar el pago'),
  });

  const pseMutation = useMutation({
    mutationFn: async () => {
      // Mismo motivo que la tarjeta: el token de transferencia se registra
      // en Kushki por el total (monto + comisión), que es lo que después
      // se debita realmente del banco.
      const token = await tokenizarPSE(pse, totalACobrar);
      const { data } = await kushkiApi.iniciarPSE({
        token,
        monto: amount,
        documentType: pse.documentType,
        documentNumber: pse.documentNumber,
        email: pse.email,
        nombreCompleto: pse.nombreCompleto,
        telefono: pse.telefono || undefined,
      });
      return data;
    },
    onSuccess: (data) => {
      window.location.href = data.redirectUrl;
    },
    onError: (err: any) => toast.error(err.response?.data?.mensaje || err.message || 'No se pudo iniciar el pago con PSE'),
  });

  const formCompletoTarjeta = amount > 0 && card.name && card.number.length >= 15 && card.expiryMonth && card.expiryYear && card.cvc.length >= 3;
  const formCompletoPse = amount > 0 && pse.bankId && pse.documentNumber.length >= 5 && pse.email && pse.nombreCompleto.length >= 3;

  const resumenComision = amount > 0 && (
    <p className="tp-modal-label" style={{ textAlign: 'center' }}>
      Comisión (3%): {fmtCOP(comisionValor)} · Total a cobrar: <strong>{fmtCOP(totalACobrar)}</strong>
    </p>
  );

  return (
    <UserModal title="Consignar a mi billetera" subtitle="Paga con tarjeta o PSE">
      <div className="tp-modal-content">
        <InfoDestination saldo={user?.saldo} />

        {paso === 'monto' && (
          <>
            <AmountPicker value={amount} setValue={setAmount} />
            {resumenComision}
            <ThemeButton disabled={amount <= 0} onClick={() => setPaso('metodo')}>
              <ArrowRight size={18} /> Continuar
            </ThemeButton>
          </>
        )}

        {paso === 'metodo' && (
          <>
            <p className="tp-modal-label">¿Cómo quieres pagar?</p>
            <OperationCard
              icon={<CreditCard size={20} />}
              title="Tarjeta"
              description="Crédito o débito, aprobación inmediata"
              accent="purple"
              selected={metodo === 'tarjeta'}
              onClick={() => setMetodo('tarjeta')}
            />
            <OperationCard
              icon={<Building2 size={20} />}
              title="PSE"
              description="Débito desde tu banco"
              accent="blue"
              selected={metodo === 'pse'}
              onClick={() => setMetodo('pse')}
            />
            <div style={{ display: 'flex', gap: 12 }}>
              <ThemeButton tone="ghost" onClick={() => setPaso('monto')}>
                <ArrowLeft size={18} /> Atrás
              </ThemeButton>
              <ThemeButton disabled={!metodo} onClick={() => setPaso(metodo === 'pse' ? 'pse' : 'tarjeta')}>
                <ArrowRight size={18} /> Continuar
              </ThemeButton>
            </div>
          </>
        )}

        {paso === 'tarjeta' && (
          <>
            <label className="tp-form-field">
              <span>Nombre en la tarjeta</span>
              <input value={card.name} onChange={(e) => setCardField('name', e.target.value)} placeholder="Como aparece en la tarjeta" />
            </label>
            <label className="tp-form-field">
              <span>Número de tarjeta</span>
              <input
                value={card.number}
                onChange={(e) => setCardField('number', e.target.value.replaceAll(/\D/g, ''))}
                placeholder="0000 0000 0000 0000"
                inputMode="numeric"
                maxLength={19}
              />
            </label>
            <div style={{ display: 'flex', gap: 12 }}>
              <label className="tp-form-field" style={{ flex: 1 }}>
                <span>Mes</span>
                <input value={card.expiryMonth} onChange={(e) => setCardField('expiryMonth', e.target.value.replaceAll(/\D/g, ''))} placeholder="MM" inputMode="numeric" maxLength={2} />
              </label>
              <label className="tp-form-field" style={{ flex: 1 }}>
                <span>Año</span>
                <input value={card.expiryYear} onChange={(e) => setCardField('expiryYear', e.target.value.replaceAll(/\D/g, ''))} placeholder="AA" inputMode="numeric" maxLength={2} />
              </label>
              <label className="tp-form-field" style={{ flex: 1 }}>
                <span>CVC</span>
                <input value={card.cvc} onChange={(e) => setCardField('cvc', e.target.value.replaceAll(/\D/g, ''))} placeholder="123" inputMode="numeric" maxLength={4} />
              </label>
            </div>
            {resumenComision}
            <div style={{ display: 'flex', gap: 12 }}>
              <ThemeButton tone="ghost" onClick={() => setPaso('metodo')}>
                <ArrowLeft size={18} /> Atrás
              </ThemeButton>
              <ThemeButton disabled={!formCompletoTarjeta || consignarMutation.isPending} onClick={() => consignarMutation.mutate()}>
                {consignarMutation.isPending ? 'Procesando...' : <><ArrowRight size={18} /> Consignar</>}
              </ThemeButton>
            </div>
          </>
        )}

        {paso === 'pse' && (
          <>
            <label className="tp-form-field">
              <span>Banco</span>
              <select value={pse.bankId} onChange={(e) => setPseField('bankId', e.target.value)}>
                <option value="">{bancos.isLoading ? 'Cargando bancos...' : 'Selecciona tu banco'}</option>
                {(bancos.data || []).map((b) => (
                  <option key={b.code} value={b.code}>{b.name}</option>
                ))}
              </select>
            </label>
            <div style={{ display: 'flex', gap: 12 }}>
              <label className="tp-form-field" style={{ flex: 1 }}>
                <span>Tipo de documento</span>
                <select value={pse.documentType} onChange={(e) => setPseField('documentType', e.target.value)}>
                  <option value="CC">Cédula de ciudadanía</option>
                  <option value="CE">Cédula de extranjería</option>
                  <option value="NIT">NIT</option>
                  <option value="TI">Tarjeta de identidad</option>
                  <option value="PP">Pasaporte</option>
                </select>
              </label>
              <label className="tp-form-field" style={{ flex: 1 }}>
                <span>Número de documento</span>
                <input value={pse.documentNumber} onChange={(e) => setPseField('documentNumber', e.target.value.replaceAll(/\D/g, ''))} placeholder="Ej. 1023456789" inputMode="numeric" />
              </label>
            </div>
            <label className="tp-form-field">
              <span>Nombre completo</span>
              <input value={pse.nombreCompleto} onChange={(e) => setPseField('nombreCompleto', e.target.value)} placeholder="Nombre completo" />
            </label>
            <label className="tp-form-field">
              <span>Correo electrónico</span>
              <input value={pse.email} onChange={(e) => setPseField('email', e.target.value)} placeholder="tucorreo@email.com" type="email" />
            </label>
            {resumenComision}
            <div style={{ display: 'flex', gap: 12 }}>
              <ThemeButton tone="ghost" onClick={() => setPaso('metodo')}>
                <ArrowLeft size={18} /> Atrás
              </ThemeButton>
              <ThemeButton disabled={!formCompletoPse || pseMutation.isPending} onClick={() => pseMutation.mutate()}>
                {pseMutation.isPending ? 'Conectando con tu banco...' : <><ArrowRight size={18} /> Continuar al banco</>}
              </ThemeButton>
            </div>
          </>
        )}
      </div>
    </UserModal>
  );
}
