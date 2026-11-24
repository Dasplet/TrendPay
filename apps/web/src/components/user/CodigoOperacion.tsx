'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { ShieldCheck } from 'lucide-react';
import { authApi } from '@/lib/api';
import { registrarPedirCodigo } from '@/lib/codigo2fa';
import { ThemeButton } from '@/components/user/UserTheme';

// Ventana que pide el código de verificación (2FA) del correo cuando el usuario tiene la verificación encendida y hace una
// operación sensible: enviar dinero, retirar, cambiar el PIN o manejar sus cuentas de banco. Vive en el layout del usuario.
export function CodigoOperacion() {
  const [abierto, setAbierto] = useState(false);
  const [aviso, setAviso] = useState('');
  const [info, setInfo] = useState('');
  const [codigo, setCodigo] = useState('');
  const [enviando, setEnviando] = useState(false);
  const resolver = useRef<((c: string | null) => void) | null>(null);

  const solicitar = useCallback(async () => {
    setEnviando(true);
    try {
      const { data } = await authApi.twofaSolicitar({ proposito: 'operacion' });
      setInfo(data.mensaje);
    } catch (err: any) {
      setInfo(err.response?.data?.mensaje || 'No se pudo enviar el código');
    } finally {
      setEnviando(false);
    }
  }, []);

  useEffect(() => registrarPedirCodigo((avisoPrevio) => new Promise<string | null>((resolve) => {
    resolver.current?.(null);
    resolver.current = resolve;
    setCodigo('');
    setAviso(avisoPrevio ?? '');
    setAbierto(true);
    if (!avisoPrevio) { setInfo(''); void solicitar(); }
  })), [solicitar]);

  function cerrar(valor: string | null) {
    setAbierto(false);
    resolver.current?.(valor);
    resolver.current = null;
  }

  if (!abierto) return null;
  return (
    <div className="tp-modal-stage" style={{ zIndex: 1000 }} role="dialog" aria-modal="true" aria-label="Verificación en dos pasos">
      <div className="tp-modal-blur" aria-hidden="true" />
      <section className="tp-phone-modal tp-phone-sm">
        <div className="tp-phone-notch" />
        <header className="tp-modal-header">
          <h1><ShieldCheck size={22} style={{ verticalAlign: '-4px', marginRight: 8 }} />Confirma con tu código</h1>
          <p>Para tu seguridad, esta operación necesita el código que te enviamos al correo.</p>
        </header>
        <div className="tp-modal-content">
          {info && <p className="tp-modal-label" style={{ textAlign: 'center' }}>{info}</p>}
          {aviso && <p className="tp-modal-label" style={{ textAlign: 'center', color: '#ff8a8a' }}>{aviso}</p>}
          <label className="tp-form-field">
            <span>Código de 6 dígitos</span>
            <input
              autoFocus
              value={codigo}
              onChange={(e) => setCodigo(e.target.value.replaceAll(/\D/g, '').slice(0, 6))}
              inputMode="numeric"
              autoComplete="one-time-code"
              placeholder="••••••"
              onKeyDown={(e) => { if (e.key === 'Enter' && codigo.length === 6) cerrar(codigo); }}
            />
          </label>
          <ThemeButton disabled={codigo.length !== 6} onClick={() => cerrar(codigo)}>Confirmar</ThemeButton>
          <div className="tp-button-row">
            <ThemeButton tone="ghost" onClick={() => cerrar(null)}>Cancelar</ThemeButton>
            <ThemeButton tone="ghost" disabled={enviando} onClick={() => { setAviso(''); void solicitar(); }}>{enviando ? 'Enviando…' : 'Reenviar código'}</ThemeButton>
          </div>
        </div>
      </section>
    </div>
  );
}
