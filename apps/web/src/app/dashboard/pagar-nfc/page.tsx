'use client';

import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import toast from 'react-hot-toast';
import { Nfc, X } from 'lucide-react';
import { leerTextoDeEtiqueta, mensajeErrorNfc, nfcDisponible, rutaDePagoQr } from '@/lib/nfc';
import { ThemeButton, UserModal } from '@/components/user/UserTheme';

export default function PagarNfcPage() {
  const router = useRouter();
  const [soportado, setSoportado] = useState(false);
  const [leyendo, setLeyendo] = useState(false);
  const abortRef = useRef<AbortController | null>(null);

  useEffect(() => {
    setSoportado(nfcDisponible());
    return () => abortRef.current?.abort();
  }, []);

  async function leer() {
    const ctrl = new AbortController();
    abortRef.current = ctrl;
    setLeyendo(true);
    try {
      const texto = await leerTextoDeEtiqueta(ctrl.signal);
      const ruta = rutaDePagoQr(texto, window.location.origin);
      if (!ruta) {
        toast.error('Esta etiqueta no es un cobro de TrendPay.');
        return;
      }
      router.push(ruta);
    } catch (err) {
      if (!ctrl.signal.aborted) toast.error(mensajeErrorNfc(err));
    } finally {
      ctrl.abort();
      setLeyendo(false);
      abortRef.current = null;
    }
  }

  return (
    <UserModal title="Pagar con NFC" subtitle="Acerca tu celular a la etiqueta del comercio">
      <div className="tp-modal-content">
        {!soportado && (
          <p className="tp-warning">
            Leer etiquetas desde la app requiere Chrome para Android con NFC activado. En otros celulares basta con acercarlo a la etiqueta: el sistema abre el cobro solo.
          </p>
        )}
        {soportado && leyendo && (
          <>
            <p className="tp-warning">Acerca la parte trasera de tu celular a la etiqueta NFC…</p>
            <ThemeButton tone="secondary" onClick={() => abortRef.current?.abort()}>
              <X size={18} /> Cancelar
            </ThemeButton>
          </>
        )}
        {soportado && !leyendo && (
          <ThemeButton onClick={leer}>
            <Nfc size={18} /> Leer etiqueta NFC
          </ThemeButton>
        )}
        <p className="tp-warning">Antes de pagar siempre verás el nombre de quien cobra y el monto.</p>
      </div>
    </UserModal>
  );
}
