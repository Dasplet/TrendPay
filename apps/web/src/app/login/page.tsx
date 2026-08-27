'use client';
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { useAuthStore } from '@/store/authStore';
import { AlertCircle } from 'lucide-react';
import { ThemeToggle } from '@/components/ThemeToggle';

export default function LoginPage() {
  const router   = useRouter();
  const login    = useAuthStore(s => s.login);
  const verifyLogin2fa = useAuthStore(s => s.verifyLogin2fa);
  const isLoading = useAuthStore(s => s.isLoading);

  const [cedula, setCedula] = useState('');
  const [pin, setPin]       = useState('');
  const [error, setError]   = useState('');
  const [step, setStep]     = useState<'credenciales' | '2fa'>('credenciales');
  const [twofaMsg, setTwofaMsg] = useState('');
  const [otp, setOtp]       = useState('');

  function handlePinKey(k: string) {
    if (k === 'x') { setPin(p => p.slice(0, -1)); return; }
    if (pin.length < 4) setPin(p => p + k);
  }

  function goToDashboard() {
    const user = useAuthStore.getState().user;
    if (user?.rol === 'admin') router.push('/admin');
    else router.push('/dashboard');
  }

  async function handleLogin() {
    if (!cedula || cedula.length < 6) { setError('Ingresa tu número de cédula'); return; }
    if (pin.length !== 4) { setError('Ingresa tu PIN de 4 dígitos'); return; }
    setError('');
    try {
      const result = await login(cedula, pin);
      if (result.requiere2fa) {
        setTwofaMsg(result.mensaje || 'Te enviamos un código de verificación');
        setStep('2fa');
        return;
      }
      goToDashboard();
    } catch (err: any) {
      setError(err.message);
      setPin('');
    }
  }

  async function handleVerify2fa() {
    if (otp.length < 4) { setError('Ingresa el código que te enviamos'); return; }
    setError('');
    try {
      await verifyLogin2fa(cedula, otp);
      goToDashboard();
    } catch (err: any) {
      setError(err.message);
      setOtp('');
    }
  }

  return (
    <main className="min-h-screen tp-login-bg flex items-center justify-center p-5" style={{ position: 'relative' }}>
      <div style={{ position: 'absolute', top: 20, right: 20 }}>
        <ThemeToggle className="tp-theme-toggle" />
      </div>
      <div className="w-full max-w-sm">

        {/* Logo */}
        <div className="text-center mb-8">
          <img src="/tp_icon.png" alt="TrendPay" width={64} height={64} style={{ borderRadius: 18, margin: '0 auto 10px' }} />
          <div className="text-sm text-[var(--tp-muted)]">Billetera virtual segura</div>
        </div>

        {/* Card */}
        <div className="tp-login-card rounded-3xl p-8">

          {step === 'credenciales' ? (
            <>
              {/* Cédula */}
              <div className="mb-5">
                <label htmlFor="login-cedula" className="block text-xs font-semibold text-[var(--tp-muted)] uppercase tracking-wider mb-2">
                  Número de cédula
                </label>
                <input
                  id="login-cedula"
                  type="tel"
                  inputMode="numeric"
                  placeholder="Ej. 1023456789"
                  value={cedula}
                  onChange={e => setCedula(e.target.value.replaceAll(/\D/g, ''))}
                  className="w-full bg-[rgba(var(--tp-card-rgb),.7)] border border-[rgba(133,46,199,.3)] rounded-xl px-4 py-3 text-[var(--tp-text)] text-base font-mono tracking-widest focus:border-brand-accent outline-none"
                />
              </div>

              {/* PIN dots */}
              <fieldset className="mb-8" style={{ border: 0, padding: 0 }}>
                <legend className="block text-xs font-semibold text-[var(--tp-muted)] uppercase tracking-wider mb-3" style={{ padding: 0 }}>
                  PIN de 4 dígitos
                </legend>
                <div className="flex justify-center gap-4 mb-4">
                  {[0,1,2,3].map(i => (
                    <div key={i} className={`w-12 h-12 rounded-xl border-2 flex items-center justify-center text-2xl transition-all ${
                      i < pin.length
                        ? 'bg-[rgba(133,46,199,.35)] border-brand-accent text-white'
                        : 'bg-[rgba(var(--tp-card-rgb),.6)] border-[rgba(133,46,199,.35)] text-[rgba(var(--tp-fg-rgb),.3)]'
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
                          : 'bg-[rgba(133,46,199,.1)] border border-[rgba(133,46,199,.2)] text-[var(--tp-text)] hover:bg-[rgba(133,46,199,.25)]'
                      }`}
                    >
                      {k === 'x' ? '⌫' : k}
                    </button>
                  ))}
                </div>
              </fieldset>

              {/* Error */}
              {error && (
                <div className="text-[#C0392B] text-xs text-center mb-3 flex items-center justify-center gap-1">
                  <AlertCircle size={14} /> {error}
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
            </>
          ) : (
            <>
              {/* Paso 2FA */}
              <div className="mb-5 text-center">
                <div className="text-[var(--tp-text)] font-semibold mb-1">Verificación en dos pasos</div>
                <div className="text-sm text-[var(--tp-muted)]">{twofaMsg}</div>
              </div>

              <div className="mb-5">
                <label htmlFor="login-otp" className="block text-xs font-semibold text-[var(--tp-muted)] uppercase tracking-wider mb-2">
                  Código de verificación
                </label>
                <input
                  id="login-otp"
                  type="tel"
                  inputMode="numeric"
                  autoFocus
                  maxLength={6}
                  placeholder="000000"
                  value={otp}
                  onChange={e => setOtp(e.target.value.replaceAll(/\D/g, ''))}
                  className="w-full bg-[rgba(var(--tp-card-rgb),.7)] border border-[rgba(133,46,199,.3)] rounded-xl px-4 py-3 text-[var(--tp-text)] text-2xl font-mono tracking-[0.4em] text-center focus:border-brand-accent outline-none"
                />
              </div>

              {/* Error */}
              {error && (
                <div className="text-[#C0392B] text-xs text-center mb-3 flex items-center justify-center gap-1">
                  <AlertCircle size={14} /> {error}
                </div>
              )}

              <button
                onClick={handleVerify2fa}
                disabled={isLoading || otp.length < 4}
                className="w-full py-4 rounded-xl font-bold text-white text-base transition-all disabled:opacity-40 disabled:cursor-not-allowed"
                style={{ background: 'linear-gradient(135deg, #852EC7, #5a1a8a)' }}
              >
                {isLoading ? 'Verificando...' : 'Confirmar código'}
              </button>

              <div className="text-center mt-4">
                <button
                  onClick={() => { setStep('credenciales'); setOtp(''); setError(''); }}
                  className="text-sm text-[var(--tp-muted)] hover:text-[var(--tp-text)] transition-colors"
                >
                  Volver a intentar
                </button>
              </div>
            </>
          )}
        </div>
      </div>
    </main>
  );
}
