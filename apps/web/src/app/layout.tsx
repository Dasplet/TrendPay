import type { Metadata } from 'next';
import './globals.css';
import { Providers } from '@/components/Providers';

export const metadata: Metadata = {
  title: 'TrendPay — Billetera Virtual',
  description: 'Tu billetera virtual segura y rápida',
  manifest: '/manifest.json',
  themeColor: '#252547',
  viewport: 'width=device-width, initial-scale=1, maximum-scale=1, viewport-fit=cover',
  appleWebApp: {
    capable: true,
    statusBarStyle: 'black-translucent',
    title: 'TrendPay',
  },
};

const THEME_INIT_SCRIPT = `
(function() {
  try {
    var t = localStorage.getItem('tp-theme');
    if (t === 'light' || t === 'dark') document.documentElement.setAttribute('data-theme', t);
  } catch (e) {}
})();
`;

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="es">
      <head>
        <script dangerouslySetInnerHTML={{ __html: THEME_INIT_SCRIPT }} />
      </head>
      <body>
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
