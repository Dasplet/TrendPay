'use client';

import { Copy, Gift, Users } from 'lucide-react';
import toast from 'react-hot-toast';
import { useAuthStore } from '@/store/authStore';

export default function ReferidosPage() {
  const user = useAuthStore((s) => s.user);
  const code = user?.codigoReferido || `TP-${(user?.cedula || '1023456789').slice(-4)}`;

  async function copy() {
    await navigator.clipboard.writeText(code);
    toast.success('Código copiado');
  }

  return (
    <div className="tp-user-page">
      <header className="tp-page-header"><h1>Mis referidos</h1></header>
      <section className="tp-ref-card">
        <div><Gift size={36} /></div>
        <h2>Invita y gana</h2>
        <p>Comparte tu código. Tú y tu referido reciben bono cuando realicen su primera operación demo.</p>
        <button onClick={copy}><span>{code}</span><Copy size={18} /></button>
      </section>
      <section className="tp-stat-row">
        <article className="tp-stat-card"><span>Referidos activos</span><strong>0</strong><small>Usuarios verificados</small></article>
        <article className="tp-stat-card"><span>Bonos ganados</span><strong className="tp-success">$0</strong><small>Disponible en billetera</small></article>
      </section>
      <div className="tp-empty"><Users size={40} /><p>Aún no tienes referidos registrados</p></div>
    </div>
  );
}
