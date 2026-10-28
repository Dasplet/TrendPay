import type { Metadata } from 'next';

// El enlace es personal: no se indexa y no se envía como referencia a otros sitios.
export const metadata: Metadata = {
  title: 'Vinculación · TrendPay',
  robots: { index: false, follow: false },
  referrer: 'no-referrer',
};

export default function VinculacionLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return children;
}
