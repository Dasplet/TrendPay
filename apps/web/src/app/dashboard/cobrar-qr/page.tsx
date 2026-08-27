'use client';

import { useState } from 'react';
import toast from 'react-hot-toast';
import { Copy, RefreshCw, Smartphone } from 'lucide-react';
import { useMutation, useQuery } from '@tanstack/react-query';
import { useAuthStore } from '@/store/authStore';
import { walletApi } from '@/lib/api';
import { InfoDestination, RealQr, ThemeButton, UserModal } from '@/components/user/UserTheme';

interface GeneratedQr {
  token: string;
  monto: number | null;
  concepto: string | null;
  expiresAt: string;
}

function shareUrlFor(token?: string) {
  if (!token || typeof window === 'undefined') return '';
  return `${window.location.origin}/dashboard/pagar-qr/${token}`;
}

function copyLink(url: string) {
  navigator.clipboard.writeText(url);
  toast.success('Enlace copiado');
}

export default function CobrarQrPage() {
  const user = useAuthStore((s) => s.user);
  const [amount, setAmount] = useState('');
  const [concept, setConcept] = useState('');
  const [qr, setQr] = useState<GeneratedQr | null>(null);

  const { data: personalToken, isLoading: cargandoPersonal } = useQuery({
    queryKey: ['qr-personal'],
    queryFn: () => walletApi.qrPersonal(),
    select: (res) => res.data.qr.token as string,
    staleTime: Infinity,
  });

  const generarMutation = useMutation({
    mutationFn: () => walletApi.qrGenerar({
      monto: amount ? Number(amount) : undefined,
      concepto: concept || undefined,
    }),
    onSuccess: ({ data }) => {
      setQr(data.qr);
      toast.success('QR generado · válido por 30 minutos');
    },
    onError: (err: any) => toast.error(err.response?.data?.mensaje || 'No se pudo generar el QR'),
  });

  const personalUrl = shareUrlFor(personalToken);
  const qrUrl = shareUrlFor(qr?.token);

  return (
    <UserModal title="Cobrar con mi QR" subtitle="El pago llega a tu billetera virtual" size="lg">
      <div className="tp-modal-content">
        <p className="tp-modal-label">Tu QR personal · siempre el mismo, sin vencimiento</p>
        {cargandoPersonal ? (
          <p>Generando tu QR...</p>
        ) : (
          <>
            <RealQr value={personalUrl} />
            <p style={{ textAlign: 'center', fontSize: 13, opacity: 0.7 }}>
              {user?.nombre} · CC {user?.cedula}
            </p>
            <label className="tp-form-field">
              <span>Enlace de tu QR personal</span>
              <input readOnly value={personalUrl} onFocus={(e) => e.target.select()} />
            </label>
            <ThemeButton onClick={() => copyLink(personalUrl)}><Copy size={18} /> Copiar enlace</ThemeButton>
          </>
        )}

        <hr className="tp-divider" />

        <p className="tp-modal-label">O genera un cobro por un monto exacto</p>
        {!qr ? (
          <>
            <label className="tp-form-field">
              <span>Monto a cobrar (opcional)</span>
              <input value={amount} onChange={(e) => setAmount(e.target.value.replaceAll(/\D/g, ''))} placeholder="Vacío = monto libre" inputMode="numeric" />
            </label>
            <label className="tp-form-field">
              <span>Concepto</span>
              <input value={concept} onChange={(e) => setConcept(e.target.value)} placeholder="Ej. Pago del almuerzo" />
            </label>
            <InfoDestination saldo={user?.saldo} description="Saldo actual de tu billetera" />
            <ThemeButton tone="secondary" disabled={generarMutation.isPending} onClick={() => generarMutation.mutate()}>
              <Smartphone size={18} /> {generarMutation.isPending ? 'Generando...' : 'Generar QR para cobrar'}
            </ThemeButton>
          </>
        ) : (
          <>
            <RealQr value={qrUrl} />
            <InfoDestination label="QR generado" description={`Válido hasta las ${new Date(qr.expiresAt).toLocaleTimeString('es-CO')}`} />
            <label className="tp-form-field">
              <span>Enlace para compartir</span>
              <input readOnly value={qrUrl} onFocus={(e) => e.target.select()} />
            </label>
            <ThemeButton onClick={() => copyLink(qrUrl)}><Copy size={18} /> Copiar enlace</ThemeButton>
            <ThemeButton tone="secondary" onClick={() => setQr(null)}><RefreshCw size={18} /> Generar otro QR</ThemeButton>
          </>
        )}
      </div>
    </UserModal>
  );
}
