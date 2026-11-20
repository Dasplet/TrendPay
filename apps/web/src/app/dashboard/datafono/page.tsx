'use client';

import { useState } from 'react';
import { useAuthStore } from '@/store/authStore';
import toast from 'react-hot-toast';
import { CreditCard, RefreshCw } from 'lucide-react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { datafonosApi } from '@/lib/api';
import { InfoDestination, ThemeButton, UserModal, fmtCOP } from '@/components/user/UserTheme';
import { ResumenVentas } from '@/components/datafonos/ResumenVentas';

interface Terminal { id: string; alias: string; modelo: string; ocupado: boolean }
interface Cobro {
  id: string; estado: string; estadoTerminal: string | null; detalle: string | null;
  monto: number; neto?: number; terminal: string; creado: string;
}

// Lo que va pasando en el datáfono mientras el cobro sigue pendiente
const PASO_TERMINAL: Record<string, string> = {
  TERMINAL_ACKNOWLEDGED: 'El datáfono recibió el cobro. Pídele al cliente que acerque o inserte la tarjeta.',
  CARD_PRESENTED: 'Tarjeta leída. Si el datáfono pide la clave, el cliente debe digitarla.',
  APPROVAL_REQUESTED: 'Esperando la respuesta del banco…',
};

const ESTADO_FINAL: Record<string, { titulo: string; color: string; ayuda: (c: Cobro) => string }> = {
  aprobado:  { titulo: 'Cobro aprobado',     color: '#2e9e6b', ayuda: () => 'El dinero ya está en la billetera de la empresa.' },
  rechazado: { titulo: 'Cobro rechazado',    color: '#c0392b', ayuda: (c) => c.detalle || 'El banco no aprobó el pago.' },
  cancelado: { titulo: 'Cobro cancelado',    color: '#c0392b', ayuda: (c) => c.detalle || 'El cobro se canceló.' },
  error:     { titulo: 'No se pudo cobrar',  color: '#c0392b', ayuda: (c) => c.detalle || 'El datáfono no recibió el cobro. Revisa que esté encendido y con internet.' },
  expirado:  { titulo: 'Sin respuesta',      color: '#d4a017', ayuda: () => 'El datáfono no respondió a tiempo. Si el cliente alcanzó a pagar, el cobro se acreditará solo cuando Kushki lo confirme.' },
  reembolsando: { titulo: 'Reembolsando',  color: '#d4a017', ayuda: () => 'Se pidió la anulación a Kushki. La billetera se descuenta cuando la confirme.' },
  reembolsado:  { titulo: 'Reembolsado',    color: '#c0392b', ayuda: () => 'El cobro fue reembolsado y se descontó de la billetera.' },
  revision:  { titulo: 'En revisión',        color: '#d4a017', ayuda: () => 'El monto aprobado no coincide con el cobrado. Un administrador lo revisará antes de acreditar.' },
};

export default function DatafonoPage() {
  const queryClient = useQueryClient();
  // Solo la cuenta principal (no una sede) puede reembolsar
  const puedeReembolsar = useAuthStore((s) => !s.user?.cuentaPadre);
  const [terminalId, setTerminalId] = useState('');
  const [monto, setMonto] = useState('');
  const [cobroId, setCobroId] = useState<string | null>(null);

  const { data: info, isLoading } = useQuery({
    queryKey: ['datafonos-terminales-pantalla'],
    queryFn: () => datafonosApi.terminales().then((r) => r.data as { disponible: boolean; terminales: Terminal[] }),
    refetchInterval: cobroId ? false : 15_000,
  });

  // Mientras el cobro está pendiente se consulta cada 2 s (el servidor también le pregunta a Kushki si el aviso se demora)
  const { data: cobro } = useQuery({
    queryKey: ['datafono-cobro', cobroId],
    queryFn: () => datafonosApi.cobro(cobroId!).then((r) => r.data.cobro as Cobro),
    enabled: !!cobroId,
    refetchInterval: (q) => (q.state.data?.estado === 'pendiente' || !q.state.data ? 2000 : false),
  });

  const { data: recientes } = useQuery({
    queryKey: ['datafonos-cobros', cobro?.estado],
    queryFn: () => datafonosApi.cobros().then((r) => r.data.cobros as Cobro[]),
  });

  const cobrar = useMutation({
    mutationFn: () => datafonosApi.cobrar(terminalId, Number(monto)),
    onSuccess: ({ data }) => { setCobroId(data.cobro.id); queryClient.invalidateQueries({ queryKey: ['datafonos-cobros'] }); },
    onError: (err: any) => {
      toast.error(err.response?.data?.mensaje || 'No se pudo enviar el cobro');
      queryClient.invalidateQueries({ queryKey: ['datafonos-terminales-pantalla'] });
    },
  });

  const reembolsar = useMutation({
    mutationFn: (id: string) => datafonosApi.reembolsar(id),
    onSuccess: ({ data }) => { toast.success(data.mensaje || 'Reembolso enviado'); queryClient.invalidateQueries({ queryKey: ['datafonos-cobros'] }); },
    onError: (err: any) => toast.error(err.response?.data?.mensaje || 'No se pudo reembolsar'),
  });

  function nuevoCobro() {
    setCobroId(null);
    setMonto('');
    queryClient.invalidateQueries({ queryKey: ['datafonos-terminales-pantalla'] });
    queryClient.invalidateQueries({ queryKey: ['datafonos-terminales'] });
  }

  const terminales = info?.terminales ?? [];
  const elegido = terminales.find((t) => t.id === terminalId);
  const valor = Number(monto);
  const puedeCobrar = !!elegido && !elegido.ocupado && valor >= 1000 && !cobrar.isPending && info?.disponible;

  const final = cobro && ESTADO_FINAL[cobro.estado];

  return (
    <UserModal title="Cobrar con datáfono" subtitle="El dinero llega a la billetera de la empresa cuando el banco aprueba" size="lg">
      <div className="tp-modal-content">
        {isLoading && <p>Cargando datáfonos…</p>}

        {!isLoading && !info?.disponible && (
          <InfoDestination label="Todavía no disponible" description="El cobro con datáfono aún no está habilitado en TrendPay. Avísale al administrador." />
        )}

        {!isLoading && info?.disponible && terminales.length === 0 && (
          <InfoDestination label="Sin datáfonos" description="Tu cuenta no tiene datáfonos asignados." />
        )}

        {/* Cobro en curso o terminado */}
        {cobroId && (
          <div style={{ textAlign: 'center', padding: '8px 0' }}>
            <p style={{ fontSize: 30, fontWeight: 700, margin: '4px 0' }}>{cobro ? fmtCOP(cobro.monto) : fmtCOP(valor)}</p>
            <p style={{ opacity: 0.7, margin: 0 }}>{cobro?.terminal ?? elegido?.alias}</p>

            {(!cobro || cobro.estado === 'pendiente') && (
              <>
                <p style={{ marginTop: 18, fontWeight: 600 }}>Cobrando…</p>
                <p style={{ opacity: 0.75 }}>{PASO_TERMINAL[cobro?.estadoTerminal ?? 'TERMINAL_ACKNOWLEDGED'] ?? 'Procesando el pago…'}</p>
              </>
            )}

            {cobro && final && (
              <>
                <p style={{ marginTop: 18, fontWeight: 700, fontSize: 20, color: final.color }}>{final.titulo}</p>
                <p style={{ opacity: 0.8 }}>{final.ayuda(cobro)}</p>
                <ThemeButton onClick={nuevoCobro}><RefreshCw size={18} /> Nuevo cobro</ThemeButton>
              </>
            )}
          </div>
        )}

        {/* Formulario */}
        {!cobroId && terminales.length > 0 && (
          <>
            <p className="tp-modal-label">Datáfono</p>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
              {terminales.map((t) => (
                <button
                  key={t.id}
                  type="button"
                  disabled={t.ocupado}
                  onClick={() => setTerminalId(t.id)}
                  style={{
                    padding: '10px 16px', borderRadius: 12, fontWeight: 600, cursor: t.ocupado ? 'not-allowed' : 'pointer', opacity: t.ocupado ? 0.5 : 1,
                    border: terminalId === t.id ? '2px solid #852EC7' : '1.5px solid rgba(128,128,128,.35)',
                    background: terminalId === t.id ? 'rgba(133,46,199,.1)' : 'transparent', color: 'inherit',
                  }}
                >
                  {t.alias}{t.ocupado ? ' · ocupado' : ''}
                </button>
              ))}
            </div>

            <label className="tp-form-field">
              <span>Monto a cobrar (COP)</span>
              <input value={monto} onChange={(e) => setMonto(e.target.value.replaceAll(/\D/g, '').slice(0, 9))} placeholder="Ej. 50000" inputMode="numeric" />
            </label>
            {valor > 0 && valor < 1000 && <p style={{ color: '#c0392b', fontSize: 13, margin: 0 }}>El monto mínimo es {fmtCOP(1000)}.</p>}

            {cobrar.isPending && <p style={{ fontSize: 13, opacity: 0.75, margin: 0 }}>Enviando la orden al datáfono. Puede tardar hasta un minuto y medio si el aparato está apagado o sin internet.</p>}
            <ThemeButton disabled={!puedeCobrar} onClick={() => cobrar.mutate()}>
              <CreditCard size={18} /> {cobrar.isPending ? 'Enviando al datáfono…' : `Cobrar${valor >= 1000 ? ` ${fmtCOP(valor)}` : ''}`}
            </ThemeButton>
          </>
        )}

        {/* Ventas por tienda y datáfono: solo la cuenta principal (una sede no las ve) */}
        {puedeReembolsar && (
          <>
            <hr className="tp-divider" />
            <p className="tp-modal-label">Ventas con datáfono</p>
            <ResumenVentas />
          </>
        )}

        {/* Últimos cobros */}
        {(recientes?.length ?? 0) > 0 && (
          <>
            <hr className="tp-divider" />
            <p className="tp-modal-label">Últimos cobros</p>
            {recientes!.slice(0, 8).map((c) => (
              <div key={c.id} style={{ display: 'flex', justifyContent: 'space-between', gap: 8, padding: '6px 0', fontSize: 14 }}>
                <span>{new Date(c.creado).toLocaleString('es-CO', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' })} · {c.terminal}</span>
                <span style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <strong style={{ color: ESTADO_FINAL[c.estado]?.color }}>{fmtCOP(c.monto)} · {c.estado}</strong>
                  {puedeReembolsar && c.estado === 'aprobado' && Date.now() - new Date(c.creado).getTime() > 90_000 && (
                    <button
                      type="button"
                      disabled={reembolsar.isPending}
                      onClick={() => { if (window.confirm(`¿Reembolsar ${fmtCOP(c.monto)} de este cobro? Se descontará de la billetera ${fmtCOP(c.neto ?? c.monto)} cuando Kushki confirme la anulación.`)) reembolsar.mutate(c.id); }}
                      style={{ padding: '3px 10px', borderRadius: 8, fontSize: 12, cursor: 'pointer', border: '1px solid rgba(192,57,43,.5)', background: 'transparent', color: '#c0392b' }}
                    >
                      Reembolsar
                    </button>
                  )}
                </span>
              </div>
            ))}
          </>
        )}
      </div>
    </UserModal>
  );
}
