'use client';
import { useEffect, useState } from 'react';

export function SplashScreen({ onDone }: Readonly<{ onDone: () => void }>) {
  const [progress, setProgress] = useState(0);
  const [phase, setPhase]       = useState(0);
  const phases = ['Iniciando TrendPay...','Verificando sesión...','Cargando tu billetera...','¡Listo!'];

  useEffect(() => {
    const steps = [{ to:30, delay:200 },{ to:60, delay:500 },{ to:85, delay:900 },{ to:100, delay:1300 }];
    steps.forEach(({ to, delay }, i) => {
      setTimeout(() => {
        setProgress(to); setPhase(i);
        if (i === steps.length - 1) setTimeout(onDone, 400);
      }, delay);
    });
  }, []);

  return (
    <div style={{ position:'fixed', inset:0, zIndex:9999, background:'linear-gradient(160deg,#0a0a0d 0%,#1a1620 55%,#131316 100%)', display:'flex', flexDirection:'column', alignItems:'center', justifyContent:'center' }}>
      <div style={{ marginBottom:48, textAlign:'center' }}>
        <img src="/tp_icon.png" alt="TrendPay" width={88} height={88} style={{ borderRadius:24, display:'block', margin:'0 auto' }} />
        <div style={{ fontSize:13, color:'rgba(255,255,255,.4)', marginTop:14, letterSpacing:'2px', textTransform:'uppercase' }}>Billetera Virtual</div>
      </div>
      <div style={{ width:240, marginBottom:16 }}>
        <div style={{ height:3, background:'rgba(255,255,255,.1)', borderRadius:2, overflow:'hidden' }}>
          <div style={{ height:'100%', borderRadius:2, background:'linear-gradient(90deg,#852EC7,#6CC998)', width:`${progress}%`, transition:'width .4s cubic-bezier(.4,0,.2,1)' }}/>
        </div>
      </div>
      <div style={{ fontSize:13, color:'rgba(255,255,255,.45)', height:20 }}>{phases[phase]}</div>
      <div style={{ display:'flex', gap:6, marginTop:32 }}>
        {[0,1,2].map(i => <div key={i} style={{ width:6, height:6, borderRadius:'50%', background:'#852EC7', animation:`pulse 1.2s ease-in-out ${i*0.2}s infinite` }}/>)}
      </div>
      <style>{`@keyframes pulse{0%,80%,100%{opacity:.2;transform:scale(.8)}40%{opacity:1;transform:scale(1.2)}}`}</style>
    </div>
  );
}
