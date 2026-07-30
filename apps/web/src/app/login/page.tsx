'use client';
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { useAuthStore } from '@/store/authStore';
import toast from 'react-hot-toast';
import Link from 'next/link';

export default function LoginPage() {
  const router   = useRouter();
  const login    = useAuthStore(s => s.login);
  const isLoading = useAuthStore(s => s.isLoading);

  const [cedula, setCedula] = useState('');
  const [pin, setPin]       = useState('');
  const [error, setError]   = useState('');

  function handlePinKey(k: string) {
    if (k === 'x') { setPin(p => p.slice(0, -1)); return; }
    if (pin.length < 4) setPin(p => p + k);
  }

  async function handleLogin() {
    if (!cedula || cedula.length < 6) { setError('Ingresa tu número de cédula'); return; }
    if (pin.length !== 4) { setError('Ingresa tu PIN de 4 dígitos'); return; }
    setError('');
    try {
      await login(cedula, pin);
      const user = useAuthStore.getState().user;
      if (user?.rol === 'admin') router.push('/admin');
      else router.push('/dashboard');
    } catch (err: any) {
      setError(err.message);
      setPin('');
    }
  }

  return (
    <main className="min-h-screen bg-brand-gradient flex items-center justify-center p-5">
      <div className="w-full max-w-sm">

        {/* Logo */}
        <div className="text-center mb-8">
          <div className="text-3xl font-black text-white tracking-tight mb-1">TrendLab.</div>
          <div className="text-sm text-brand-muted">Billetera virtual segura</div>
        </div>

        {/* Card */}
        <div className="bg-white/10 backdrop-blur-xl border border-white/20 rounded-3xl p-8">

          {/* Cédula */}
          <div className="mb-5">
            <label className="block text-xs font-semibold text-brand-muted uppercase tracking-wider mb-2">
              Número de cédula
            </label>
            <input
              type="tel"
              inputMode="numeric"
              placeholder="Ej. 1023456789"
              value={cedula}
              onChange={e => setCedula(e.target.value.replace(/\D/g, ''))}
              className="w-full bg-[rgba(30,12,65,.7)] border border-[rgba(133,46,199,.3)] rounded-xl px-4 py-3 text-white text-base font-mono tracking-widest focus:border-brand-accent outline-none"
            />
          </div>

          {/* PIN dots */}
          <div className="mb-4">
            <label className="block text-xs font-semibold text-brand-muted uppercase tracking-wider mb-3">
              PIN de 4 dígitos
            </label>
            <div className="flex justify-center gap-4 mb-4">
              {[0,1,2,3].map(i => (
                <div key={i} className={`w-12 h-12 rounded-xl border-2 flex items-center justify-center text-2xl transition-all ${
                  i < pin.length
                    ? 'bg-[rgba(133,46,199,.35)] border-brand-accent text-white'
                    : 'bg-[rgba(30,12,65,.6)] border-[rgba(133,46,199,.35)] text-white/30'
                }`}>
                  {i < pin.length ? '●' : '·'}
                </div>
              ))}
            </div>

            {/* Numpad */}
            <div className="grid grid-cols-3 gap-3">
              {['1','2','3','4','5','6','7','8','9','','0','x'].map((k, i) => (
                k === '' ? <div key={i} /> :
                <button
                  key={i}
                  onClick={() => handlePinKey(k)}
                  className={`h-14 rounded-xl font-semibold text-xl transition-all ${
                    k === 'x'
                      ? 'bg-[rgba(192,57,43,.12)] border border-[rgba(192,57,43,.2)] text-[#e87575] hover:bg-[rgba(192,57,43,.25)]'
                      : 'bg-[rgba(133,46,199,.1)] border border-[rgba(133,46,199,.2)] text-white hover:bg-[rgba(133,46,199,.25)]'
                  }`}
                >
                  {k === 'x' ? '⌫' : k}
                </button>
              ))}
            </div>
          </div>

          {/* Error */}
          {error && (
            <div className="text-[#C0392B] text-xs text-center mb-3 flex items-center justify-center gap-1">
              <span>⚠</span> {error}
            </div>
          )}

          {/* Login button */}
          <button
            onClick={handleLogin}
            disabled={isLoading || pin.length < 4 || cedula.length < 6}
            className="w-full py-4 rounded-xl font-bold text-white text-base transition-all disabled:opacity-40 disabled:cursor-not-allowed"
            style={{ background: 'linear-gradient(135deg, #852EC7, #5a1a8a)' }}
          >
            {isLoading ? 'Verificando...' : 'Ingresar'}
          </button>

          {/* Register link */}
          <div className="text-center mt-4">
            <Link href="/register" className="text-sm text-brand-muted hover:text-white transition-colors">
              ¿No tienes cuenta? <span className="text-brand-accent font-semibold">Crear cuenta</span>
            </Link>
          </div>
        </div>
      </div>
    </main>
  );
}
