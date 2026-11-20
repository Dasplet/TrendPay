'use client';
import { useEffect, useRef, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { api, API_URL } from '@/lib/api';

// Mantiene abierta una conexión con el servidor (Server-Sent Events) que avisa cada vez que cambia algo que esta persona puede
// ver. Al recibir un aviso, todas las pantallas abiertas vuelven a pedir sus datos: se actualizan solas, sin recargar y
// sin cerrar sesión. Si la conexión se cae se reconecta sola (y, mientras tanto, las consultas de respaldo siguen corriendo).
// Se usa fetch y no EventSource porque la sesión viaja en una cabecera Authorization, que EventSource no permite.

const ESPERA_MIN_MS = 1000;
const ESPERA_MAX_MS = 30_000;
const MIN_ENTRE_ACTUALIZACIONES_MS = 1500; // aunque lleguen muchos avisos, la pantalla no se refresca más seguido que esto

export type EstadoTiempoReal = 'conectando' | 'en-vivo' | 'reconectando';

export function useTiempoReal(activo: boolean): EstadoTiempoReal {
  const queryClient = useQueryClient();
  const [estado, setEstado] = useState<EstadoTiempoReal>('conectando');
  const cliente = useRef(queryClient);
  cliente.current = queryClient;

  useEffect(() => {
    if (!activo) return;
    let vivo = true;
    let controlador: AbortController | null = null;
    let ultimaActualizacion = 0;
    let pendiente: ReturnType<typeof setTimeout> | null = null;

    // Vuelve a pedir lo que muestran las pantallas: de inmediato, o en cuanto pase el mínimo entre actualizaciones
    const actualizar = () => {
      const espera = ultimaActualizacion + MIN_ENTRE_ACTUALIZACIONES_MS - Date.now();
      if (espera <= 0) {
        ultimaActualizacion = Date.now();
        cliente.current.invalidateQueries();
      } else if (!pendiente) {
        pendiente = setTimeout(() => { pendiente = null; actualizar(); }, espera);
      }
    };

    const dormir = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

    async function conectar() {
      let espera = ESPERA_MIN_MS;
      while (vivo) {
        try {
          controlador = new AbortController();
          const token = localStorage.getItem('accessToken');
          if (!token) { await dormir(2000); continue; }
          const resp = await fetch(`${API_URL}/api/eventos`, {
            headers: { Authorization: `Bearer ${token}`, Accept: 'text/event-stream' },
            cache: 'no-store',
            signal: controlador.signal,
          });
          if (resp.status === 401) {
            // La sesión venció: una consulta cualquiera la renueva (o manda a iniciar sesión) y se vuelve a conectar
            await api.get('/auth/me').catch(() => {});
            continue;
          }
          if (!resp.ok || !resp.body) throw new Error(`HTTP ${resp.status}`);

          setEstado('en-vivo');
          espera = ESPERA_MIN_MS;
          actualizar(); // al (re)conectar se ponen al día los cambios que pudieron pasar mientras no había conexión

          const lector = resp.body.getReader();
          const decodificador = new TextDecoder();
          let buffer = '';
          while (vivo) {
            const { value, done } = await lector.read();
            if (done) break;
            buffer += decodificador.decode(value, { stream: true });
            let corte: number;
            while ((corte = buffer.indexOf('\n\n')) !== -1) {
              const bloque = buffer.slice(0, corte);
              buffer = buffer.slice(corte + 2);
              if (bloque.includes('event: cambio')) actualizar();
            }
          }
        } catch (err: any) {
          if (!vivo || err?.name === 'AbortError') return;
        }
        if (!vivo) return;
        setEstado('reconectando');
        await dormir(espera);
        espera = Math.min(espera * 2, ESPERA_MAX_MS);
      }
    }

    // Al volver a la pestaña o recuperar internet se actualiza de inmediato
    const alVolver = () => { if (document.visibilityState === 'visible') actualizar(); };
    document.addEventListener('visibilitychange', alVolver);
    window.addEventListener('online', actualizar);

    conectar();
    return () => {
      vivo = false;
      controlador?.abort();
      if (pendiente) clearTimeout(pendiente);
      document.removeEventListener('visibilitychange', alVolver);
      window.removeEventListener('online', actualizar);
    };
  }, [activo]);

  return estado;
}

// Indicador "En vivo" para la barra superior: verde cuando hay conexión, ámbar si se está reconectando
export const ETIQUETA_ESTADO: Record<EstadoTiempoReal, { texto: string; color: string }> = {
  'en-vivo': { texto: 'En vivo', color: '#6CC998' },
  conectando: { texto: 'Conectando…', color: '#d4a017' },
  reconectando: { texto: 'Reconectando…', color: '#d4a017' },
};
