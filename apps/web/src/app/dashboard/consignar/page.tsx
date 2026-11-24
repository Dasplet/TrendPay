'use client';

import { useEffect, useState } from 'react';
import toast from 'react-hot-toast';
import { useMutation, useQuery } from '@tanstack/react-query';
import { Kushki } from '@kushki/js';
import { ArrowLeft, ArrowRight, Building2, CreditCard, QrCode } from 'lucide-react';
import { useAuthStore } from '@/store/authStore';
import { kushkiApi } from '@/lib/api';
import { calcularComision, textoPct, useComision } from '@/lib/comision';
import { AmountPicker, fmtCOP, InfoDestination, OperationCard, ThemeButton, UserModal } from '@/components/user/UserTheme';

// Con qué llave y en qué ambiente cobra Kushki lo decide el SERVIDOR (GET /kushki/metodos), así el navegador y el servidor
// nunca quedan en ambientes distintos. Las variables NEXT_PUBLIC_* solo se usan si el servidor no responde.
const KUSHKI_PUBLIC_MERCHANT_ID_ENV = process.env.NEXT_PUBLIC_KUSHKI_PUBLIC_MERCHANT_ID || '';
const KUSHKI_IN_TEST_ENVIRONMENT_ENV = process.env.NEXT_PUBLIC_KUSHKI_IN_TEST_ENVIRONMENT !== 'false';

interface MetodosKushki { breb: boolean; publicMerchantId?: string; pruebas?: boolean }
let configKushki: { publicMerchantId: string; pruebas: boolean } = { publicMerchantId: KUSHKI_PUBLIC_MERCHANT_ID_ENV, pruebas: KUSHKI_IN_TEST_ENVIRONMENT_ENV };
function fijarConfigKushki(m?: MetodosKushki) {
  if (m?.publicMerchantId) configKushki = { publicMerchantId: m.publicMerchantId, pruebas: m.pruebas ?? true };
}

type Paso = 'monto' | 'metodo' | 'tarjeta' | 'pse' | 'breb';
type Metodo = 'tarjeta' | 'pse' | 'breb';

function kushkiClient() {
  if (!configKushki.publicMerchantId) return null;
  return new Kushki({ merchantId: configKushki.publicMerchantId, inTestEnvironment: configKushki.pruebas });
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

function useBancosPSE(listo: boolean) {
  return useQuery({
    enabled: listo,
    queryKey: ['kushki-bank-list', configKushki.publicMerchantId, configKushki.pruebas],
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

  // Qué métodos hay y en qué ambiente se cobra. Bre-B solo funciona si Kushki lo tiene activo en el Branch de la cuenta.
  const metodosQ = useQuery({
    queryKey: ['kushki-metodos'],
    queryFn: async () => { const r = await kushkiApi.metodos(); fijarConfigKushki(r.data); return r.data as MetodosKushki; },
    staleTime: 60_000,
  });
  const bancos = useBancosPSE(metodosQ.isSuccess || metodosQ.isError);
  const brebActivo = !!metodosQ.data?.breb;
  const modoPruebas = metodosQ.data?.pruebas === true;
  const [breb, setBreb] = useState<{ qr: string; token: string; venceEn: number } | null>(null);
  const [ahora, setAhora] = useState(() => Date.now());
  const segundosRestantes = breb ? Math.max(0, Math.ceil((breb.venceEn - ahora) / 1000)) : 0;
  const qrVencido = !!breb && segundosRestantes === 0;

  // Mientras el QR esté vigente se pregunta cada 4 s si el banco ya aprobó el pago; la conciliación del
  // servidor lo acredita igual aunque el usuario cierre esta pantalla.
  useEffect(() => {
    if (paso !== 'breb' || !breb || qrVencido) return;
    const reloj = setInterval(() => setAhora(Date.now()), 1000);
    const consulta = setInterval(async () => {
      try {
        const { data } = await kushkiApi.confirmarPSE(breb.token);
        if (data.estado === 'completado') {
          clearInterval(consulta);
          await refreshUser();
          toast.success('¡Pago recibido! Tu saldo ya fue actualizado');
          window.location.href = '/dashboard';
        } else if (data.estado === 'rechazado') {
          clearInterval(consulta);
          toast.error('El pago no fue autorizado. Genera un nuevo QR para intentarlo de nuevo');
          setBreb(null);
        }
      } catch { /* se reintenta en el siguiente ciclo */ }
    }, 4000);
    return () => { clearInterval(reloj); clearInterval(consulta); };
  }, [paso, breb, qrVencido, refreshUser]);

  function setCardField(field: keyof typeof card, value: string) {
    setCard((c) => ({ ...c, [field]: value }));
  }

  function setPseField(field: keyof typeof pse, value: string) {
    setPse((p) => ({ ...p, [field]: value }));
  }

  // El usuario paga la comisión encima del monto elegido — igual que
  // "Enviar" — así que Kushki cobra monto+comisión, pero la billetera solo
  // se acredita con el monto elegido.
  const comisionPct = useComision();
  const comisionValor = calcularComision(amount, comisionPct);
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

  const brebMutation = useMutation({
    mutationFn: async () => (await kushkiApi.iniciarBreB(amount)).data as { qr: string; token: string; expiraEnSegundos: number },
    onSuccess: (data) => {
      setAhora(Date.now());
      setBreb({ qr: data.qr, token: data.token, venceEn: Date.now() + data.expiraEnSegundos * 1000 });
    },
    onError: (err: any) => toast.error(err.response?.data?.mensaje || err.message || 'No se pudo generar el código QR'),
  });

  const cancelarBrebMutation = useMutation({
    mutationFn: async () => (await kushkiApi.cancelarBreB(breb!.token)).data as { estado: string },
    onSuccess: async (data) => {
      if (data.estado === 'completado') {
        // El banco alcanzó a aprobarlo antes de cancelar: ya se acreditó
        await refreshUser();
        toast.success('El pago ya había sido aprobado; tu saldo fue actualizado');
        window.location.href = '/dashboard';
        return;
      }
      setBreb(null);
      toast.success('Código QR cancelado');
    },
    onError: (err: any) => toast.error(err.response?.data?.mensaje || 'No se pudo cancelar el código QR'),
  });

  const formCompletoTarjeta = amount > 0 && card.name && card.number.length >= 15 && card.expiryMonth && card.expiryYear && card.cvc.length >= 3;
  const formCompletoPse = amount > 0 && pse.bankId && pse.documentNumber.length >= 5 && pse.email && pse.nombreCompleto.length >= 3;

  const resumenComision = amount > 0 && (
    <p className="tp-modal-label" style={{ textAlign: 'center' }}>
      Comisión ({textoPct(comisionPct)}): {fmtCOP(comisionValor)} · Total a cobrar: <strong>{fmtCOP(totalACobrar)}</strong>
    </p>
  );

  return (
    <UserModal title="Consignar a mi billetera" subtitle="Paga con tarjeta, PSE o Bre-B">
      <div className="tp-modal-content">
        {modoPruebas && (
          <p role="alert" className="tp-modal-label" style={{ textAlign: 'center', padding: 10, borderRadius: 10, background: 'rgba(212,160,23,.15)', border: '1px solid rgba(212,160,23,.5)' }}>
            Modo de pruebas: los pagos de esta pantalla no mueven dinero real.
          </p>
        )}
        <InfoDestination saldo={user?.saldo ?? undefined} />

        {paso === 'monto' && (
          <>
            <AmountPicker value={amount} setValue={setAmount} />
            {resumenComision}
            <ThemeButton disabled={amount <= 0} onClick={() => setPaso('metodo')}>
              <ArrowRight size={18} /> Continuar
            </ThemeButton>
            <ThemeButton tone="ghost" href="/dashboard/consignaciones">Ver mis consignaciones</ThemeButton>
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
            <OperationCard
              icon={<QrCode size={20} />}
              title="Bre-B (QR)"
              description={brebActivo ? 'Escanea el QR con la app de tu banco o billetera' : 'Aún no está activo para tu cuenta: escríbenos para activarlo'}
              accent="blue"
              selected={metodo === 'breb'}
              disabled={!brebActivo}
              onClick={() => brebActivo && setMetodo('breb')}
            />
            <div className="tp-button-row">
              <ThemeButton tone="ghost" onClick={() => setPaso('monto')}>
                <ArrowLeft size={18} /> Atrás
              </ThemeButton>
              <ThemeButton disabled={!metodo} onClick={() => setPaso(metodo === 'pse' ? 'pse' : metodo === 'breb' ? 'breb' : 'tarjeta')}>
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
            <div className="tp-button-row">
              <ThemeButton tone="ghost" onClick={() => setPaso('metodo')}>
                <ArrowLeft size={18} /> Atrás
              </ThemeButton>
              <ThemeButton disabled={!formCompletoTarjeta || consignarMutation.isPending} onClick={() => consignarMutation.mutate()}>
                {consignarMutation.isPending ? 'Procesando...' : <><ArrowRight size={18} /> Consignar</>}
              </ThemeButton>
            </div>
          </>
        )}

        {paso === 'breb' && (
          <>
            {(!breb || qrVencido) ? (
              <>
                <p className="tp-modal-label" style={{ textAlign: 'center' }}>
                  {qrVencido
                    ? 'El código QR venció. Genera uno nuevo para pagar.'
                    : 'Generaremos un código QR para que lo escanees con la app de tu banco y autorices el pago.'}
                </p>
                {resumenComision}
                <div className="tp-button-row">
                  <ThemeButton tone="ghost" onClick={() => { setBreb(null); setPaso('metodo'); }}>
                    <ArrowLeft size={18} /> Atrás
                  </ThemeButton>
                  <ThemeButton disabled={amount <= 0 || brebMutation.isPending} onClick={() => brebMutation.mutate()}>
                    {brebMutation.isPending ? 'Generando QR...' : <><QrCode size={18} /> {qrVencido ? 'Generar nuevo QR' : 'Generar QR'}</>}
                  </ThemeButton>
                </div>
              </>
            ) : (
              <>
                <div style={{ display: 'grid', placeItems: 'center', gap: 10 }}>
                  {/* data URI entregado por Kushki (validado en el servidor) */}
                  <img src={breb.qr} alt="Código QR de Bre-B" width={240} height={240} style={{ background: '#fff', padding: 8, borderRadius: 12 }} />
                  <p className="tp-modal-label" style={{ textAlign: 'center' }}>
                    Abre la app de tu banco, elige pagar con QR y escanéalo. Vence en {Math.floor(segundosRestantes / 60)}:{String(segundosRestantes % 60).padStart(2, '0')}.
                  </p>
                  <p className="tp-modal-label" style={{ textAlign: 'center' }}>Esperando la confirmación de tu banco…</p>
                </div>
                {resumenComision}
                <div className="tp-button-row">
                  <ThemeButton tone="ghost" disabled={cancelarBrebMutation.isPending} onClick={() => cancelarBrebMutation.mutate()}>
                    {cancelarBrebMutation.isPending ? 'Cancelando...' : 'Cancelar este QR'}
                  </ThemeButton>
                  <ThemeButton tone="ghost" href="/dashboard/consignaciones">Ver mis consignaciones</ThemeButton>
                </div>
              </>
            )}
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
            <div className="tp-button-row">
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
