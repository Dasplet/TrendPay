'use client';

import { useState } from 'react';
import toast from 'react-hot-toast';
import { Copy, KeyRound, Plus, RefreshCw, Smartphone, Trash2 } from 'lucide-react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useAuthStore } from '@/store/authStore';
import { llavesBrebApi, walletApi } from '@/lib/api';
import { InfoDestination, RealQr, ThemeButton, UserModal } from '@/components/user/UserTheme';

interface GeneratedQr {
  token: string;
  monto: number | null;
  concepto: string | null;
  expiresAt: string;
}

interface LlaveBreb { id: string; tipo: TipoLlave; valor: string; alias: string | null; estado: string }
type TipoLlave = 'celular' | 'correo' | 'documento' | 'alfanumerica';

const TIPOS_LLAVE: { clave: TipoLlave; label: string; ejemplo: string }[] = [
  { clave: 'celular', label: 'Celular', ejemplo: '3001234567' },
  { clave: 'correo', label: 'Correo', ejemplo: 'cobros@minegocio.co' },
  { clave: 'documento', label: 'Cédula o NIT', ejemplo: '1023456789' },
  { clave: 'alfanumerica', label: 'Alfanumérica', ejemplo: '@minegocio' },
];
const etiquetaTipo = (t: string) => TIPOS_LLAVE.find((x) => x.clave === t)?.label ?? t;

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
  const queryClient = useQueryClient();
  const [amount, setAmount] = useState('');
  const [concept, setConcept] = useState('');
  const [qr, setQr] = useState<GeneratedQr | null>(null);
  const [nuevaTipo, setNuevaTipo] = useState<TipoLlave>('celular');
  const [nuevaValor, setNuevaValor] = useState('');
  const [nuevaAlias, setNuevaAlias] = useState('');

  const { data: personalToken, isLoading: cargandoPersonal } = useQuery({
    queryKey: ['qr-personal'],
    queryFn: () => walletApi.qrPersonal(),
    select: (res) => res.data.qr.token as string,
    staleTime: Infinity,
    refetchInterval: false,
  });

  const llavesQ = useQuery({
    queryKey: ['llaves-breb'],
    queryFn: () => llavesBrebApi.listar(),
    select: (r) => r.data as { llaves: LlaveBreb[]; maximo: number; puedeEditar: boolean },
  });
  const llaves = llavesQ.data?.llaves ?? [];
  const puedeEditar = !!llavesQ.data?.puedeEditar;
  const llenas = llaves.length >= (llavesQ.data?.maximo ?? 5);
  const ejemplo = TIPOS_LLAVE.find((t) => t.clave === nuevaTipo)?.ejemplo;

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

  const guardarLlave = useMutation({
    mutationFn: () => llavesBrebApi.crear({ tipo: nuevaTipo, valor: nuevaValor, alias: nuevaAlias || undefined }),
    onSuccess: async () => {
      setNuevaValor('');
      setNuevaAlias('');
      await queryClient.invalidateQueries({ queryKey: ['llaves-breb'] });
      toast.success('Llave guardada');
    },
    onError: (err: any) => toast.error(err.response?.data?.mensaje || 'No se pudo guardar la llave'),
  });

  const quitarLlave = useMutation({
    mutationFn: (id: string) => llavesBrebApi.quitar(id),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['llaves-breb'] });
      toast.success('Llave quitada');
    },
    onError: (err: any) => toast.error(err.response?.data?.mensaje || 'No se pudo quitar la llave'),
  });

  const personalUrl = shareUrlFor(personalToken);
  const qrUrl = shareUrlFor(qr?.token);

  return (
    <UserModal title="Cobrar" subtitle="El dinero llega a tu billetera virtual" size="lg">
      <div className="tp-modal-content">
        <p className="tp-modal-label">QR de TrendPay · tu QR personal, siempre el mismo y sin vencimiento</p>
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
            <InfoDestination saldo={user?.saldo ?? undefined} description="Saldo actual de tu billetera" />
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

        <hr className="tp-divider" />

        <p className="tp-modal-label"><KeyRound size={15} style={{ verticalAlign: '-2px', marginRight: 6 }} />Mis llaves Bre-B · próximamente podrás cobrar con ellas</p>
        <p style={{ fontSize: 13, opacity: 0.7 }}>
          Guarda aquí las llaves Bre-B de tu negocio (celular, correo, documento o alfanumérica). Todavía no se usan para cobrar:
          las dejamos listas para cuando se active el cobro con llaves.
        </p>

        {llavesQ.isLoading ? <p>Cargando tus llaves...</p> : llaves.length === 0 ? (
          <p style={{ fontSize: 13, opacity: 0.7 }}>Aún no has guardado ninguna llave.</p>
        ) : (
          <div style={{ display: 'grid', gap: 8 }}>
            {llaves.map((l) => (
              <div key={l.id} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '10px 12px', borderRadius: 12, background: 'rgba(255,255,255,.05)' }}>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <strong style={{ display: 'block', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{l.valor}</strong>
                  <small style={{ opacity: 0.65 }}>{etiquetaTipo(l.tipo)}{l.alias ? ` · ${l.alias}` : ''} · Guardada</small>
                </div>
                {puedeEditar && (
                  <button type="button" aria-label={`Quitar la llave ${l.valor}`} disabled={quitarLlave.isPending}
                    onClick={() => { if (window.confirm(`¿Quitar la llave ${l.valor}?`)) quitarLlave.mutate(l.id); }}
                    style={{ background: 'transparent', border: 0, color: 'inherit', cursor: 'pointer', opacity: 0.7 }}>
                    <Trash2 size={18} />
                  </button>
                )}
              </div>
            ))}
          </div>
        )}

        {puedeEditar ? (llenas ? (
          <p style={{ fontSize: 13, opacity: 0.7 }}>Llegaste al máximo de {llavesQ.data?.maximo} llaves. Quita una para agregar otra.</p>
        ) : (
          <>
            <label className="tp-form-field">
              <span>Tipo de llave</span>
              <select value={nuevaTipo} onChange={(e) => { setNuevaTipo(e.target.value as TipoLlave); setNuevaValor(''); }}>
                {TIPOS_LLAVE.map((t) => <option key={t.clave} value={t.clave}>{t.label}</option>)}
              </select>
            </label>
            <label className="tp-form-field">
              <span>Llave</span>
              <input value={nuevaValor} onChange={(e) => setNuevaValor(e.target.value)} placeholder={`Ej. ${ejemplo}`} />
            </label>
            <label className="tp-form-field">
              <span>Nombre para reconocerla (opcional)</span>
              <input value={nuevaAlias} onChange={(e) => setNuevaAlias(e.target.value)} maxLength={40} placeholder="Ej. Caja principal" />
            </label>
            <ThemeButton tone="secondary" disabled={nuevaValor.trim().length < 3 || guardarLlave.isPending} onClick={() => guardarLlave.mutate()}>
              <Plus size={18} /> {guardarLlave.isPending ? 'Guardando...' : 'Guardar llave'}
            </ThemeButton>
          </>
        )) : (
          <p style={{ fontSize: 13, opacity: 0.7 }}>Solo la cuenta principal de la empresa administra las llaves.</p>
        )}
      </div>
    </UserModal>
  );
}
