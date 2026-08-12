import Link from 'next/link';
import { Compass } from 'lucide-react';

export default function NotFound() {
  return (
    <main className="min-h-screen bg-brand-gradient flex items-center justify-center p-5">
      <div className="w-full max-w-sm text-center">
        <div className="bg-white/10 backdrop-blur-xl border border-white/20 rounded-3xl p-8">
          <div className="w-16 h-16 rounded-2xl bg-[rgba(133,46,199,.2)] border border-[rgba(133,46,199,.3)] flex items-center justify-center mx-auto mb-5 text-brand-accent">
            <Compass size={30} />
          </div>
          <div className="text-5xl font-black text-white tracking-tight mb-2">404</div>
          <div className="text-base font-semibold text-white mb-1">Página no encontrada</div>
          <p className="text-sm text-brand-muted mb-6">
            La página que buscas no existe o fue movida.
          </p>
          <Link
            href="/"
            className="inline-block w-full py-3.5 rounded-xl font-bold text-white text-sm transition-all"
            style={{ background: 'linear-gradient(135deg, #852EC7, #5a1a8a)' }}
          >
            Volver al inicio
          </Link>
        </div>
      </div>
    </main>
  );
}
