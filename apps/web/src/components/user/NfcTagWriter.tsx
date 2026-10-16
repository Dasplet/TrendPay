'use client';

import { useEffect, useRef, useState } from 'react';
import toast from 'react-hot-toast';
import { Nfc, X } from 'lucide-react';
import { grabarUrlEnEtiqueta, mensajeErrorNfc, nfcDisponible } from '@/lib/nfc';
import { ThemeButton } from '@/components/user/UserTheme';

export function NfcTagWriter({ url, label }: Readonly<{ url: string; label: string }>) {
  const [soportado, setSoportado] = useState(false);
  const [escribiendo, setEscribiendo] = useState(false);
  const abortRef = useRef<AbortController | null>(null);

  useEffect(() => {
    setSoportado(nfcDisponible());
    return () => abortRef.current?.abort();
  }, []);

  async function grabar() {
    const ctrl = new AbortController();
    abortRef.current = ctrl;
    setEscribiendo(true);
    try {
      await grabarUrlEnEtiqueta(url, ctrl.signal);
      toast.success('Etiqueta grabada · ya pueden pagarte acercando su celular');
    } catch (err) {
      if (!ctrl.signal.aborted) toast.error(mensajeErrorNfc(err));
    } finally {
      setEscribiendo(false);
      abortRef.current = null;
    }
  }

  if (!soportado) {
    return <p className="tp-warning">Para cobrar por NFC abre TrendPay en Chrome para Android con el NFC activado.</p>;
  }

  if (escribiendo) {
    return (
      <>
        <p className="tp-warning">Acerca una etiqueta NFC a la parte trasera de tu celular y mantenla quieta unos segundos…</p>
        <ThemeButton tone="secondary" onClick={() => abortRef.current?.abort()}>
          <X size={18} /> Cancelar
        </ThemeButton>
      </>
    );
  }

  return (
    <ThemeButton tone="secondary" onClick={grabar}>
      <Nfc size={18} /> {label}
    </ThemeButton>
  );
}
