'use client';
import { useEffect, useState } from 'react';

// Los datos se actualizan en vivo, pero el CÓDIGO de la aplicación solo cambia al recargar la página. Cuando se publica una
// versión nueva, una pantalla que lleva horas abierta (el panel de monitoreo 24/7) seguiría con la versión vieja. Esto lo
// detecta y la actualiza sola: avisa y recarga en unos segundos, sin interrumpir si alguien está escribiendo en un formulario.

const VERSION_ABIERTA = process.env.NEXT_PUBLIC_BUILD_ID ?? 'desconocida';
const REVISAR_CADA_MS = 60_000;
const ESPERA_ANTES_DE_RECARGAR_S = 10;

function alguienEscribiendo() {
  const el = document.activeElement as HTMLElement | null;
  return !!el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.tagName === 'SELECT' || el.isContentEditable);
}

export function NuevaVersion() {
  const [hayNueva, setHayNueva] = useState(false);
  const [segundos, setSegundos] = useState(ESPERA_ANTES_DE_RECARGAR_S);

  useEffect(() => {
    if (VERSION_ABIERTA === 'desconocida') return;
    let vivo = true;
    async function revisar() {
      try {
        const r = await fetch('/version', { cache: 'no-store' });
        if (!r.ok) return;
        const { version } = await r.json();
        if (vivo && typeof version === 'string' && version !== 'desconocida' && version !== VERSION_ABIERTA) setHayNueva(true);
      } catch { /* sin conexión: se revisa en la próxima vuelta */ }
    }
    const t = setInterval(revisar, REVISAR_CADA_MS);
    const alVolver = () => { if (document.visibilityState === 'visible') revisar(); };
    document.addEventListener('visibilitychange', alVolver);
    revisar();
    return () => { vivo = false; clearInterval(t); document.removeEventListener('visibilitychange', alVolver); };
  }, []);

  // Cuenta regresiva: si alguien está escribiendo se espera a que termine antes de recargar
  useEffect(() => {
    if (!hayNueva) return;
    const t = setInterval(() => {
      setSegundos((s) => {
        if (alguienEscribiendo()) return ESPERA_ANTES_DE_RECARGAR_S;
        if (s <= 1) { window.location.reload(); return 0; }
        return s - 1;
      });
    }, 1000);
    return () => clearInterval(t);
  }, [hayNueva]);

  if (!hayNueva) return null;
  return (
    <div role="status" style={{ position: 'fixed', left: '50%', bottom: 20, transform: 'translateX(-50%)', zIndex: 9999, display: 'flex', alignItems: 'center', gap: 12, padding: '10px 16px', borderRadius: 14, background: '#1e1a45', color: '#fff', border: '1px solid rgba(133,46,199,.6)', boxShadow: '0 8px 30px rgba(0,0,0,.4)', fontSize: 13, maxWidth: 'calc(100vw - 32px)' }}>
      <span>Hay una versión nueva de TrendPay. Se actualiza sola en {segundos} s.</span>
      <button type="button" onClick={() => window.location.reload()} style={{ background: '#852EC7', color: '#fff', border: 'none', borderRadius: 8, padding: '6px 12px', fontWeight: 700, cursor: 'pointer' }}>Actualizar ahora</button>
    </div>
  );
}
