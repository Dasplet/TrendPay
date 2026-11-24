'use client';

import { useState } from 'react';
import Link from 'next/link';
import toast from 'react-hot-toast';
import { Building2, Check, Plus, Trash2 } from 'lucide-react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { bankAccountsApi } from '@/lib/api';
import { EmptyState } from '@/components/user/UserTheme';
import { Panel, PanelHeader } from '@/components/admin/ui';

export default function BancosPage() {
  const queryClient = useQueryClient();
  const [confirmandoId, setConfirmandoId] = useState<string | null>(null);

  const { data: cuentas, isLoading } = useQuery({
    queryKey: ['bank-accounts'],
    queryFn: () => bankAccountsApi.list(),
    select: (res) => res.data.cuentas as any[],
  });

  const eliminarMutation = useMutation({
    mutationFn: (id: string) => bankAccountsApi.remove(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['bank-accounts'] });
      toast.success('Banco eliminado');
      setConfirmandoId(null);
    },
    onError: (err: any) => toast.error(err.response?.data?.mensaje || 'No se pudo eliminar el banco'),
  });

  function onEliminarClick(id: string) {
    if (confirmandoId === id) {
      eliminarMutation.mutate(id);
    } else {
      setConfirmandoId(id);
    }
  }

  let content: React.ReactNode;
  if (isLoading) {
    content = <p>Cargando bancos...</p>;
  } else if (!cuentas?.length) {
    content = <EmptyState title="Aún no has vinculado ningún banco" icon={<Building2 size={40} />} />;
  } else {
    content = cuentas.map((c) => (
      <article key={c.id} className="tp-profile-option">
        <span className="tp-bank-logo">{c.bancoNombre.slice(0, 2).toUpperCase()}</span>
        <div>
          <strong>{c.alias || c.bancoNombre}</strong>
          <small>{c.bancoNombre} · {c.tipoCuenta} · {c.numeroCuentaMasked}</small>
        </div>
        {confirmandoId === c.id ? (
          <button
            className="tp-icon-button"
            aria-label="Confirmar eliminación"
            disabled={eliminarMutation.isPending}
            onClick={() => onEliminarClick(c.id)}
            style={{ color: '#C0392B' }}
          >
            <Check size={15} />
          </button>
        ) : (
          <button className="tp-icon-button" aria-label="Eliminar banco" onClick={() => onEliminarClick(c.id)}>
            <Trash2 size={15} />
          </button>
        )}
      </article>
    ));
  }

  return (
    <div className="tp-user-page">
      <Panel style={{ maxWidth: 820 }}>
        <PanelHeader
          title="Cuentas para tus retiros"
          actions={<Link href="/dashboard/bancos/nuevo" className="tp-button tp-button-primary" style={{ minHeight: 34, fontSize: 12 }}><Plus size={14} /> Vincular banco</Link>}
        />
        <section className="tp-profile-list">
          {content}
        </section>
      </Panel>
    </div>
  );
}
