'use client';
import { useState } from 'react';
import toast from 'react-hot-toast';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { AlertTriangle } from 'lucide-react';
import { adminApi } from '@/lib/api';
import { Panel, PanelHeader, Btn, fmt } from '@/components/admin/ui';

interface Estado {
  habilitada: boolean;
  frase: string;
  filas: { nombre: string; cantidad: number }[];
  walletsConSaldo: number;
  saldoTotal: number;
}

// Borra el historial financiero y deja todas las billeteras en $0. Irreversible: pide una frase y solo funciona si el
// servidor tiene PERMITIR_LIMPIEZA=1.
export function LimpiezaDatos() {
  const queryClient = useQueryClient();
  const [frase, setFrase] = useState('');
  const { data } = useQuery({ queryKey: ['admin-limpieza'], queryFn: () => adminApi.limpiezaEstado().then((r) => r.data as Estado) });

  const limpiar = useMutation({
    mutationFn: () => adminApi.limpiarDatos(frase),
    onSuccess: ({ data: r }) => {
      toast.success(r.mensaje);
      setFrase('');
      queryClient.invalidateQueries(); // todo el panel se vuelve a leer
    },
    onError: (err: any) => toast.error(err.response?.data?.mensaje || 'No se pudo limpiar'),
  });

  const total = data?.filas.reduce((n, f) => n + f.cantidad, 0) ?? 0;
  const lista = (data?.filas ?? []).filter((f) => f.cantidad > 0);

  return (
    <Panel style={{ gridColumn: '1 / -1', borderColor: 'rgba(192,57,43,.45)' }}>
      <PanelHeader title="Limpiar datos de prueba" icon={<AlertTriangle size={16} />} />
      <div style={{ padding: 20, display: 'grid', gap: 14, fontSize: 13 }}>
        <p style={{ margin: 0, lineHeight: 1.6, color: 'rgba(var(--adm-fg-rgb),.75)' }}>
          Borra <strong>todo el historial</strong> (movimientos, retiros, consignaciones, cobros de datáfono, avisos, notificaciones y auditoría) y deja <strong>todas las billeteras en $0</strong>.
          Se conservan las cuentas, los bancos, el Branch de Kushki, los datáfonos, las comisiones y los QR personales. <strong style={{ color: '#C0392B' }}>No se puede deshacer.</strong>
        </p>

        {data && (
          <div style={{ background: 'rgba(var(--adm-card-rgb),.5)', borderRadius: 10, padding: '12px 14px' }}>
            {total === 0 && data.saldoTotal === 0
              ? 'No hay nada que limpiar: no hay historial y todas las billeteras están en $0.'
              : (
                <>
                  <div style={{ fontWeight: 700, marginBottom: 6 }}>Se borraría ahora:</div>
                  {lista.map((f) => <div key={f.nombre}>{f.cantidad} · {f.nombre}</div>)}
                  <div style={{ marginTop: 8, color: '#d4a017' }}>
                    {data.walletsConSaldo} billetera{data.walletsConSaldo === 1 ? '' : 's'} con saldo quedarían en $0: {fmt(data.saldoTotal)} desaparecen.
                  </div>
                </>
              )}
          </div>
        )}

        {data && !data.habilitada && (
          <div style={{ color: '#d4a017', lineHeight: 1.6 }}>
            <strong>Desactivada en el servidor.</strong> Para usarla, agrega en Railway (servicio del API → Variables) la variable <code>PERMITIR_LIMPIEZA</code> con el valor <code>1</code>, espera el redespliegue y vuelve aquí. Cuando termines, quítala.
          </div>
        )}

        {data?.habilitada && (
          <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'center' }}>
            <input
              value={frase}
              onChange={(e) => setFrase(e.target.value)}
              placeholder={`Escribe ${data.frase} para confirmar`}
              aria-label="Frase de confirmación"
              style={{ flex: '1 1 260px', background: 'rgba(var(--adm-card-rgb),.7)', border: '1.5px solid rgba(192,57,43,.5)', borderRadius: 10, padding: '10px 12px', fontSize: 13, color: 'var(--adm-text)', outline: 'none' }}
            />
            <Btn variant="danger" disabled={frase !== data.frase || limpiar.isPending} onClick={() => limpiar.mutate()}>
              {limpiar.isPending ? 'Limpiando…' : 'Borrar todo y poner saldos en $0'}
            </Btn>
          </div>
        )}
      </div>
    </Panel>
  );
}
