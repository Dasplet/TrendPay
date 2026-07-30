import type { Metadata } from 'next';
import './globals.css';
import { Providers } from '@/components/Providers';

export const metadata: Metadata = {
  title: 'TrendPay — Billetera Virtual',
  description: 'Tu billetera virtual segura y rápida',
  manifest: '/manifest.json',
  themeColor: '#252547',
  viewport: 'width=device-width, initial-scale=1, maximum-scale=1',
  icons: { icon: '/icon.png', apple: '/apple-icon.png' },
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="es">
      <body>
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
