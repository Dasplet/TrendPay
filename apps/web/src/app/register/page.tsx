'use client';
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { useAuthStore } from '@/store/authStore';
import Link from 'next/link';
import {
  User, CreditCard, Mail, Phone, MapPin, Lock,
  ArrowRight, ArrowLeft, X, CheckCircle, AlertCircle,
  RefreshCw, Gift, Shield
} from 'lucide-react';
import { api } from '@/lib/api';
import toast from 'react-hot-toast';

const CIUDADES = ['Medellín','Bogotá','Cali','Barranquilla','Cartagena','Bucaramanga','Pereira','Manizales','Santa Marta','Cúcuta'];
const INPUT: React.CSSProperties = { width:'100%', background:'rgba(30,12,65,.7)', border:'1.5px solid rgba(133,46,199,.25)', borderRadius:12, padding:'13px 16px', fontSize:14, color:'#fff', outline:'none', boxSizing:'border-box', fontFamily:'inherit', transition:'border-color .2s' };

type RegisterForm = { nombre: string; cedula: string; correo: string; celular: string; ciudad: string; codigo_referido: string };

function Step1Identidad({ form, setField }: { form: RegisterForm; setField: (field: string, value: string) => void }) {
  return (
    <>
      <div style={{ fontSize:10, fontWeight:700, color:'#852EC7', textTransform:'uppercase', letterSpacing:'2px', marginBottom:8 }}>Paso 1 de 4</div>
      <div style={{ fontSize:24, fontWeight:800, color:'#fff', marginBottom:6 }}>¿Cómo te llamas?</div>
      <div style={{ fontSize:13, color:'rgba(255,255,255,.5)', marginBottom:24 }}>Tu nombre e identificación para verificar tu identidad.</div>
      <div style={{ marginBottom:16 }}>
        <label htmlFor="reg-nombre" style={{ display:'flex', alignItems:'center', gap:6, fontSize:11, fontWeight:600, color:'rgba(174,147,170,.8)', textTransform:'uppercase', letterSpacing:'.8px', marginBottom:8 }}><User size={11}/> Nombre completo *</label>
        <input id="reg-nombre" value={form.nombre} onChange={e=>setField('nombre',e.target.value)} placeholder="Ej. María Fernanda Ruiz" style={INPUT} onFocus={e=>e.currentTarget.style.borderColor='#852EC7'} onBlur={e=>e.currentTarget.style.borderColor='rgba(133,46,199,.25)'}/>
      </div>
      <div style={{ marginBottom:16 }}>
        <label htmlFor="reg-cedula" style={{ display:'flex', alignItems:'center', gap:6, fontSize:11, fontWeight:600, color:'rgba(174,147,170,.8)', textTransform:'uppercase', letterSpacing:'.8px', marginBottom:8 }}><CreditCard size={11}/> Número de cédula *</label>
        <input id="reg-cedula" type="tel" inputMode="numeric" value={form.cedula} onChange={e=>setField('cedula',e.target.value.replaceAll(/\D/g,''))} placeholder="Ej. 1098765432" maxLength={12} style={{ ...INPUT, fontFamily:'monospace', letterSpacing:'2px' }} onFocus={e=>e.currentTarget.style.borderColor='#852EC7'} onBlur={e=>e.currentTarget.style.borderColor='rgba(133,46,199,.25)'}/>
      </div>
    </>
  );
}

function EmailStatusIcon({ checking, ok, hasAt }: { checking: boolean; ok: boolean; hasAt: boolean }) {
  if (checking) return <RefreshCw size={14} color="#AE93AA" style={{ animation:'spin 1s linear infinite' }}/>;
  if (ok) return <CheckCircle size={14} color="#6CC998"/>;
  if (hasAt) return <AlertCircle size={14} color="#C0392B"/>;
  return null;
}

function OtpVerifier({ otpSent, sendOtp, sendingOtp, otp, setOtp, verifyOtp, verifyingOtp, otpDebug }: {
  otpSent: boolean; sendOtp: () => void; sendingOtp: boolean;
  otp: string; setOtp: (v: string) => void; verifyOtp: () => void; verifyingOtp: boolean; otpDebug: string;
}) {
  if (!otpSent) {
    return (
      <button onClick={sendOtp} disabled={sendingOtp} style={{ width:'100%', padding:'11px', borderRadius:10, border:'none', background:'rgba(133,46,199,.3)', color:'#c088f0', fontSize:13, fontWeight:700, cursor:'pointer', display:'flex', alignItems:'center', justifyContent:'center', gap:8 }}>
        {sendingOtp ? <><RefreshCw size={14} style={{ animation:'spin 1s linear infinite' }}/> Enviando...</> : <><Mail size={14}/> Enviar código de verificación</>}
      </button>
    );
  }
  return (
    <div>
      <div style={{ fontSize:12, color:'rgba(255,255,255,.5)', marginBottom:10 }}>
        Código enviado a tu correo.
        {otpDebug && <span style={{ color:'#d4a017', fontWeight:700, marginLeft:8 }}>[Sandbox: {otpDebug}]</span>}
      </div>
      <div style={{ display:'flex', gap:8 }}>
        <input type="tel" inputMode="numeric" maxLength={6} value={otp} onChange={e=>setOtp(e.target.value.replaceAll(/\D/g,''))} placeholder="000000"
          style={{ ...INPUT, fontFamily:'monospace', letterSpacing:'6px', textAlign:'center', flex:1, fontSize:20 }}/>
        <button onClick={verifyOtp} disabled={otp.length<6||verifyingOtp}
          style={{ padding:'0 16px', borderRadius:10, border:'none', background:'#852EC7', color:'#fff', fontSize:13, fontWeight:700, cursor:'pointer', display:'flex', alignItems:'center', gap:6, opacity:otp.length<6?.5:1 }}>
          {verifyingOtp ? <RefreshCw size={14} style={{ animation:'spin 1s linear infinite' }}/> : <CheckCircle size={14}/>} OK
        </button>
      </div>
      <button onClick={sendOtp} style={{ marginTop:8, background:'none', border:'none', color:'rgba(255,255,255,.4)', fontSize:11, cursor:'pointer' }}>Reenviar código</button>
    </div>
  );
}

function Step2Contacto({
  form, setField, checkEmail, checkingEmail, emailOk, otpVerified,
  otpSent, sendOtp, sendingOtp, otp, setOtp, verifyOtp, verifyingOtp, otpDebug,
}: {
  form: RegisterForm; setField: (field: string, value: string) => void; checkEmail: () => void; checkingEmail: boolean;
  emailOk: boolean; otpVerified: boolean; otpSent: boolean; sendOtp: () => void; sendingOtp: boolean;
  otp: string; setOtp: (v: string) => void; verifyOtp: () => void; verifyingOtp: boolean; otpDebug: string;
}) {
  return (
    <>
      <div style={{ fontSize:10, fontWeight:700, color:'#852EC7', textTransform:'uppercase', letterSpacing:'2px', marginBottom:8 }}>Paso 2 de 4</div>
      <div style={{ fontSize:24, fontWeight:800, color:'#fff', marginBottom:6 }}>Verifica tu contacto</div>
      <div style={{ fontSize:13, color:'rgba(255,255,255,.5)', marginBottom:24 }}>Te enviaremos un código para confirmar tu identidad.</div>

      {/* Email */}
      <div style={{ marginBottom:14 }}>
        <label htmlFor="reg-correo" style={{ display:'flex', alignItems:'center', gap:6, fontSize:11, fontWeight:600, color:'rgba(174,147,170,.8)', textTransform:'uppercase', letterSpacing:'.8px', marginBottom:8 }}><Mail size={11}/> Correo electrónico *</label>
        <div style={{ position:'relative' }}>
          <input id="reg-correo" type="email" value={form.correo} onChange={e=>setField('correo',e.target.value)} onBlur={checkEmail} placeholder="correo@ejemplo.com" style={{ ...INPUT, paddingRight:44 }} onFocus={e=>e.currentTarget.style.borderColor='#852EC7'}/>
          <div style={{ position:'absolute', right:14, top:'50%', transform:'translateY(-50%)' }}>
            <EmailStatusIcon checking={checkingEmail} ok={emailOk} hasAt={form.correo.includes('@')} />
          </div>
        </div>
        {emailOk && !otpVerified && <div style={{ fontSize:11, color:'#6CC998', marginTop:4, display:'flex', alignItems:'center', gap:4 }}><CheckCircle size={11}/> Correo válido</div>}
      </div>

      {/* Celular */}
      <div style={{ marginBottom:14 }}>
        <label htmlFor="reg-celular" style={{ display:'flex', alignItems:'center', gap:6, fontSize:11, fontWeight:600, color:'rgba(174,147,170,.8)', textTransform:'uppercase', letterSpacing:'.8px', marginBottom:8 }}><Phone size={11}/> Celular *</label>
        <input id="reg-celular" type="tel" value={form.celular} onChange={e=>setField('celular',e.target.value)} placeholder="300 000 0000" style={INPUT} onFocus={e=>e.currentTarget.style.borderColor='#852EC7'} onBlur={e=>e.currentTarget.style.borderColor='rgba(133,46,199,.25)'}/>
      </div>

      {/* Ciudad */}
      <div style={{ marginBottom:20 }}>
        <label htmlFor="reg-ciudad" style={{ display:'flex', alignItems:'center', gap:6, fontSize:11, fontWeight:600, color:'rgba(174,147,170,.8)', textTransform:'uppercase', letterSpacing:'.8px', marginBottom:8 }}><MapPin size={11}/> Ciudad</label>
        <select id="reg-ciudad" value={form.ciudad} onChange={e=>setField('ciudad',e.target.value)} style={{ ...INPUT, appearance:'none', cursor:'pointer' }}>
          <option value="">— Selecciona tu ciudad —</option>
          {CIUDADES.map(c=><option key={c} value={c}>{c}</option>)}
        </select>
      </div>

      {/* OTP */}
      {emailOk && !otpVerified && (
        <div style={{ background:'rgba(133,46,199,.1)', border:'1px solid rgba(133,46,199,.2)', borderRadius:14, padding:'16px 18px', marginBottom:16 }}>
          <div style={{ display:'flex', alignItems:'center', gap:8, fontSize:13, fontWeight:600, color:'#fff', marginBottom:12 }}>
            <Shield size={15} color="#852EC7"/> Verificación de identidad
          </div>
          <OtpVerifier otpSent={otpSent} sendOtp={sendOtp} sendingOtp={sendingOtp} otp={otp} setOtp={setOtp} verifyOtp={verifyOtp} verifyingOtp={verifyingOtp} otpDebug={otpDebug} />
        </div>
      )}

      {otpVerified && (
        <div style={{ background:'rgba(108,201,152,.1)', border:'1px solid rgba(108,201,152,.25)', borderRadius:12, padding:'12px 16px', marginBottom:16, display:'flex', alignItems:'center', gap:10 }}>
          <CheckCircle size={18} color="#6CC998"/>
          <div style={{ fontSize:13, color:'#6CC998', fontWeight:600 }}>Identidad verificada correctamente</div>
        </div>
      )}
    </>
  );
}

function PinDot({ filled }: { filled: boolean }) {
  return (
    <div style={{ width:56, height:56, borderRadius:16, border:`2px solid ${filled?'#852EC7':'rgba(133,46,199,.3)'}`, background:filled?'rgba(133,46,199,.3)':'rgba(30,12,65,.6)', display:'flex', alignItems:'center', justifyContent:'center', transition:'all .15s' }}>
      {filled ? <Lock size={20} color="#fff"/> : <span style={{ fontSize:28, color:'rgba(255,255,255,.2)' }}>·</span>}
    </div>
  );
}

function PinKey({ k, pin, setPin }: { k: string; pin: string; setPin: React.Dispatch<React.SetStateAction<string>> }) {
  const isDel = k === 'del';
  function press() {
    if (isDel) setPin(p => p.slice(0, -1));
    else if (pin.length < 4) setPin(p => p + k);
  }
  return (
    <button onClick={press}
      style={{ height:56, borderRadius:14, border:`1px solid ${isDel?'rgba(192,57,43,.2)':'rgba(133,46,199,.2)'}`, background:isDel?'rgba(192,57,43,.1)':'rgba(133,46,199,.1)', color:isDel?'#e87575':'#fff', fontSize:isDel?13:22, fontWeight:600, cursor:'pointer', display:'flex', alignItems:'center', justifyContent:'center' }}>
      {isDel ? <ArrowLeft size={18} color="#e87575"/> : k}
    </button>
  );
}

function Step3Pin({ pin, setPin }: { pin: string; setPin: React.Dispatch<React.SetStateAction<string>> }) {
  return (
    <>
      <div style={{ fontSize:10, fontWeight:700, color:'#852EC7', textTransform:'uppercase', letterSpacing:'2px', marginBottom:8 }}>Paso 3 de 4</div>
      <div style={{ fontSize:24, fontWeight:800, color:'#fff', marginBottom:6 }}>Crea tu PIN secreto</div>
      <div style={{ fontSize:13, color:'rgba(255,255,255,.5)', marginBottom:20 }}>4 dígitos para aprobar tus transacciones. Nunca lo compartas.</div>
      <div style={{ display:'flex', justifyContent:'center', gap:14, marginBottom:16 }}>
        {[0,1,2,3].map(i => <PinDot key={i} filled={i < pin.length} />)}
      </div>
      <div style={{ textAlign:'center', fontSize:12, color:'#AE93AA', marginBottom:18 }}>{pin.length} de 4 dígitos</div>
      <div style={{ display:'grid', gridTemplateColumns:'repeat(3,1fr)', gap:10, maxWidth:260, margin:'0 auto' }}>
        {['1','2','3','4','5','6','7','8','9','','0','del'].map((k,i) => (
          k==='' ? <div key={i}/> : <PinKey key={i} k={k} pin={pin} setPin={setPin} />
        ))}
      </div>
    </>
  );
}

const SUMMARY_ROWS: { icon: React.ReactNode; label: string; field: keyof RegisterForm; fallback?: string; mask?: string }[] = [
  { icon: <User size={13}/>, label:'Nombre', field:'nombre' },
  { icon: <CreditCard size={13}/>, label:'Cédula', field:'cedula' },
  { icon: <Mail size={13}/>, label:'Correo', field:'correo' },
  { icon: <Phone size={13}/>, label:'Celular', field:'celular', fallback:'—' },
  { icon: <MapPin size={13}/>, label:'Ciudad', field:'ciudad', fallback:'—' },
];

function Step4Resumen({ form, setField }: { form: RegisterForm; setField: (field: string, value: string) => void }) {
  return (
    <>
      <div style={{ fontSize:10, fontWeight:700, color:'#852EC7', textTransform:'uppercase', letterSpacing:'2px', marginBottom:8 }}>Paso 4 de 4</div>
      <div style={{ fontSize:24, fontWeight:800, color:'#fff', marginBottom:6 }}>Casi listo</div>
      <div style={{ fontSize:13, color:'rgba(255,255,255,.5)', marginBottom:20 }}>Revisa tus datos antes de crear tu cuenta.</div>
      <div style={{ background:'rgba(30,12,65,.6)', border:'1px solid rgba(133,46,199,.2)', borderRadius:16, padding:'16px 18px', marginBottom:16 }}>
        {SUMMARY_ROWS.map(row => (
          <div key={row.label} style={{ display:'flex', alignItems:'center', gap:10, padding:'8px 0', borderBottom:'1px solid rgba(255,255,255,.05)' }}>
            <span style={{ color:'#852EC7', width:18 }}>{row.icon}</span>
            <span style={{ color:'#AE93AA', fontSize:12, minWidth:60 }}>{row.label}</span>
            <span style={{ color:'#fff', fontWeight:600, fontSize:13, flex:1, textAlign:'right', overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>{form[row.field] || row.fallback}</span>
          </div>
        ))}
        <div style={{ display:'flex', alignItems:'center', gap:10, padding:'8px 0', borderBottom:'1px solid rgba(255,255,255,.05)' }}>
          <span style={{ color:'#852EC7', width:18 }}><Lock size={13}/></span>
          <span style={{ color:'#AE93AA', fontSize:12, minWidth:60 }}>PIN</span>
          <span style={{ color:'#fff', fontWeight:600, fontSize:13, flex:1, textAlign:'right' }}>••••</span>
        </div>
      </div>
      <div style={{ background:'rgba(133,46,199,.08)', border:'1px solid rgba(133,46,199,.18)', borderRadius:14, padding:'14px 18px', marginBottom:16 }}>
        <label htmlFor="reg-codigo-referido" style={{ display:'flex', alignItems:'center', gap:6, fontSize:11, fontWeight:600, color:'rgba(174,147,170,.8)', textTransform:'uppercase', letterSpacing:'.8px', marginBottom:8 }}><Gift size={11}/> Código de referido (opcional)</label>
        <input id="reg-codigo-referido" value={form.codigo_referido} onChange={e=>setField('codigo_referido',e.target.value.toUpperCase())} placeholder="REF-XXXXXX" style={{ ...INPUT, fontFamily:'monospace', letterSpacing:'2px', textTransform:'uppercase' }} onFocus={e=>e.currentTarget.style.borderColor='#852EC7'} onBlur={e=>e.currentTarget.style.borderColor='rgba(133,46,199,.25)'}/>
        <div style={{ fontSize:11, color:'rgba(174,147,170,.5)', marginTop:8, display:'flex', alignItems:'center', gap:5 }}><Gift size={11} color="#6CC998"/> Tú y quien te refirió ganan $1.000 en tu primera transacción</div>
      </div>
    </>
  );
}

function ctaContent(isLoading: boolean, step: number) {
  if (isLoading) return <><RefreshCw size={16} style={{ animation:'spin 1s linear infinite' }}/> Creando cuenta...</>;
  if (step < 4) return <><ArrowRight size={16}/> Continuar</>;
  return <><CheckCircle size={16}/> Crear mi cuenta</>;
}

function RegisterCta({ step, isLoading, disabled, onClick }: { step: number; isLoading: boolean; disabled: boolean; onClick: () => void }) {
  return (
    <button onClick={onClick} disabled={disabled}
      style={{ width:'100%', padding:'15px', borderRadius:14, border:'none', background:disabled?'rgba(133,46,199,.3)':'linear-gradient(135deg,#852EC7,#5a1a8a)', color:'#fff', fontSize:15, fontWeight:700, cursor:disabled?'not-allowed':'pointer', display:'flex', alignItems:'center', justifyContent:'center', gap:8, opacity:disabled?.5:1 }}>
      {ctaContent(isLoading, step)}
    </button>
  );
}

export default function RegisterPage() {
  const router    = useRouter();
  const register  = useAuthStore(s => s.register);
  const isLoading = useAuthStore(s => s.isLoading);

  const [step, setStep]             = useState(1);
  const [pin,  setPin]              = useState('');
  const [error, setError]           = useState('');
  const [emailOk, setEmailOk]       = useState(false);
  const [otpSent, setOtpSent]       = useState(false);
  const [otp, setOtp]               = useState('');
  const [otpVerified, setOtpVerified] = useState(false);
  const [checkingEmail, setCheckingEmail] = useState(false);
  const [sendingOtp, setSendingOtp]   = useState(false);
  const [verifyingOtp, setVerifyingOtp] = useState(false);
  const [otpDebug, setOtpDebug]     = useState('');

  const [form, setForm] = useState<RegisterForm>({ nombre:'', cedula:'', correo:'', celular:'', ciudad:'', codigo_referido:'' });

  function setField(field: string, value: string) {
    setForm(f => ({ ...f, [field]: value }));
    setError('');
    if (field === 'correo') { setEmailOk(false); setOtpSent(false); setOtpVerified(false); setOtpDebug(''); }
  }

  async function checkEmail() {
    if (!form.correo.includes('@')) return;
    setCheckingEmail(true);
    try {
      const { data } = await api.post('/auth/validate-email', { correo: form.correo });
      setEmailOk(!!data.ok);
      if (!data.ok) setError(data.mensaje);
    } catch { setEmailOk(false); }
    finally { setCheckingEmail(false); }
  }

  async function sendOtp() {
    setSendingOtp(true);
    try {
      const { data } = await api.post('/auth/send-otp', { correo: form.correo });
      if (data.ok) { setOtpSent(true); toast.success(data.mensaje); if (data.otp_debug) setOtpDebug(data.otp_debug); }
      else setError(data.mensaje);
    } catch(e:any) { setError(e.response?.data?.mensaje || 'Error enviando código'); }
    finally { setSendingOtp(false); }
  }

  async function verifyOtp() {
    setVerifyingOtp(true);
    try {
      const { data } = await api.post('/auth/verify-otp', { correo: form.correo, otp });
      if (data.ok) { setOtpVerified(true); toast.success('Identidad verificada'); }
      else setError(data.mensaje);
    } catch(e:any) { setError(e.response?.data?.mensaje || 'Código incorrecto'); }
    finally { setVerifyingOtp(false); }
  }

  function nextStep() {
    setError('');
    if (step === 1) {
      if (form.nombre.length < 3) { setError('Ingresa tu nombre completo'); return; }
      if (!/^\d{6,}$/.test(form.cedula)) { setError('Cédula inválida — solo números, mín. 6 dígitos'); return; }
      setStep(2);
    } else if (step === 2) {
      if (!emailOk) { setError('Verifica que tu correo sea válido'); return; }
      if (!otpVerified) { setError('Debes verificar tu correo antes de continuar'); return; }
      if (!form.celular) { setError('Ingresa tu número de celular'); return; }
      setStep(3);
    } else if (step === 3) {
      if (pin.length < 4) { setError('Ingresa los 4 dígitos de tu PIN'); return; }
      setStep(4);
    }
  }

  async function handleRegister() {
    try {
      await register({ ...form, pin });
      router.replace('/dashboard');
    } catch(e:any) { setError(e.message); }
  }

  const STEPS = [{ n:1, label:'Identidad' },{ n:2, label:'Contacto' },{ n:3, label:'PIN' },{ n:4, label:'Confirmar' }];
  const ctaDisabled = isLoading || (step === 2 && !otpVerified);

  return (
    <main style={{ minHeight:'100vh', background:'linear-gradient(160deg,#1a0840 0%,#321168 60%,#252547 100%)', display:'flex', alignItems:'center', justifyContent:'center', padding:20 }}>
      <div style={{ width:'100%', maxWidth:440 }}>
        {/* Header */}
        <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between', marginBottom:24 }}>
          <button onClick={() => step > 1 ? setStep(step-1) : router.push('/login')} style={{ width:38, height:38, borderRadius:11, background:'rgba(255,255,255,.1)', border:'1px solid rgba(255,255,255,.15)', color:'#fff', cursor:'pointer', display:'flex', alignItems:'center', justifyContent:'center' }}><ArrowLeft size={16}/></button>
          <img src="/tp_icon.png" alt="TrendPay" width={36} height={36} style={{ borderRadius:10 }} />
          <Link href="/login" style={{ width:38, height:38, borderRadius:11, background:'rgba(255,255,255,.1)', border:'1px solid rgba(255,255,255,.15)', color:'rgba(255,255,255,.7)', display:'flex', alignItems:'center', justifyContent:'center' }}><X size={16}/></Link>
        </div>

        {/* Progress */}
        <div style={{ display:'flex', gap:6, marginBottom:28 }}>
          {STEPS.map(s => (
            <div key={s.n} style={{ flex:1, display:'flex', flexDirection:'column', alignItems:'center', gap:4 }}>
              <div style={{ height:3, width:'100%', borderRadius:2, background: s.n <= step ? '#852EC7' : 'rgba(255,255,255,.15)', transition:'background .3s' }}/>
              <div style={{ fontSize:9, color: s.n <= step ? '#c088f0' : 'rgba(255,255,255,.3)', fontWeight:600, textTransform:'uppercase', letterSpacing:'.5px' }}>{s.label}</div>
            </div>
          ))}
        </div>

        {/* Card */}
        <div style={{ background:'rgba(255,255,255,.08)', backdropFilter:'blur(20px)', border:'1px solid rgba(255,255,255,.15)', borderRadius:24, padding:'32px 28px' }}>

          {step === 1 && <Step1Identidad form={form} setField={setField} />}

          {step === 2 && (
            <Step2Contacto
              form={form} setField={setField} checkEmail={checkEmail} checkingEmail={checkingEmail}
              emailOk={emailOk} otpVerified={otpVerified} otpSent={otpSent} sendOtp={sendOtp} sendingOtp={sendingOtp}
              otp={otp} setOtp={setOtp} verifyOtp={verifyOtp} verifyingOtp={verifyingOtp} otpDebug={otpDebug}
            />
          )}

          {step === 3 && <Step3Pin pin={pin} setPin={setPin} />}

          {step === 4 && <Step4Resumen form={form} setField={setField} />}

          {/* Error */}
          {error && (
            <div style={{ display:'flex', alignItems:'center', gap:8, color:'#C0392B', fontSize:12, marginBottom:14, background:'rgba(192,57,43,.1)', borderRadius:10, padding:'8px 12px' }}>
              <AlertCircle size={13}/> {error}
            </div>
          )}

          <RegisterCta step={step} isLoading={isLoading} disabled={ctaDisabled} onClick={step < 4 ? nextStep : handleRegister} />
        </div>

        <div style={{ textAlign:'center', marginTop:20 }}>
          <Link href="/login" style={{ fontSize:13, color:'rgba(255,255,255,.5)', textDecoration:'none' }}>
            ¿Ya tienes cuenta? <span style={{ color:'rgba(255,255,255,.8)', fontWeight:600 }}>Iniciar sesión</span>
          </Link>
        </div>
      </div>
      <style>{`@keyframes spin{to{transform:rotate(360deg)}}`}</style>
    </main>
  );
}
