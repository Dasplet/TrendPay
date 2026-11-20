'use client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { Toaster } from 'react-hot-toast';
import { useEffect, useState } from 'react';
import { NuevaVersion } from '@/components/NuevaVersion';

export function Providers({ children }: Readonly<{ children: React.ReactNode }>) {
  useEffect(() => {
    if ('serviceWorker' in navigator) {
      navigator.serviceWorker.register('/sw.js').catch(() => {});
    }
  }, []);

  const [queryClient] = useState(() => new QueryClient({
    defaultOptions: {
      queries: {
        // Tiempo real: el servidor avisa cada cambio (lib/tiempoReal.ts) y todas las pantallas se actualizan al instante.
        // Estas opciones son el respaldo si el aviso se pierde: cada consulta se renueva sola cada minuto, también con la
        // pestaña en segundo plano (el panel se deja abierto 24/7), al volver a la pestaña y al recuperar internet.
        staleTime: 5 * 1000,
        refetchInterval: 60 * 1000,
        refetchIntervalInBackground: true,
        refetchOnWindowFocus: true,
        refetchOnReconnect: true,
        gcTime:    5 * 60 * 1000,   // 5min
        retry: (count, err: any) => {
          if (err?.response?.status === 401) return false;
          return count < 2;
        },
      },
    },
  }));

  return (
    <QueryClientProvider client={queryClient}>
      {children}
      <NuevaVersion />
      <Toaster
        position="bottom-center"
        toastOptions={{
          style: {
            background: '#1e1a45',
            color: '#fff',
            border: '1px solid rgba(133,46,199,.3)',
            borderRadius: '12px',
          },
          success: { iconTheme: { primary: '#6CC998', secondary: '#fff' } },
          error:   { iconTheme: { primary: '#C0392B', secondary: '#fff' } },
        }}
      />
    </QueryClientProvider>
  );
}
