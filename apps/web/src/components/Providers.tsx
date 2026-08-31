'use client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { Toaster } from 'react-hot-toast';
import { useEffect, useState } from 'react';

export function Providers({ children }: Readonly<{ children: React.ReactNode }>) {
  useEffect(() => {
    if ('serviceWorker' in navigator) {
      navigator.serviceWorker.register('/sw.js').catch(() => {});
    }
  }, []);

  const [queryClient] = useState(() => new QueryClient({
    defaultOptions: {
      queries: {
        staleTime: 30 * 1000,       // 30s
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
