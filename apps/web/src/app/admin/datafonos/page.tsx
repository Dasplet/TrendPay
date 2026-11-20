'use client';
import { useState } from 'react';
import toast from 'react-hot-toast';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Plus, RefreshCw, Smartphone } from 'lucide-react';
import { adminApi, datafonosApi } from '@/lib/api';
import { ResumenVentas } from '@/components/datafonos/ResumenVentas';
import { Panel, PanelHeader, Table, Tr, Td, Btn, Modal, Input, Select, fmt, fmtDate } from '@/components/admin/ui';

interface Terminal {
  id: string; serial: string; alias: string; modelo: string; activo: boolean;
  titularId: string; titular: string; sedeId: string | null; sede: string | null; cobros: number;
}
interface CobroAdmin {
  id: string; estado: string; estadoTerminal: string | null; detalle: string | null; monto: number; comisionPct: number;
  terminal: string; empresa: string; cajero: string; ticketNumber: string | null; creado: string;
}
interface Empresa { userId: string; nombre: string; subcuentas: { id: string; nombre: string }[] }

const COLOR_ESTADO: Record<string, string> = { aprobado: '#6CC998', pendiente: '#d4a017', expirado: '#d4a017', revision: '#d4a017', rechazado: '#C0392B', cancelado: '#C0392B', error: '#C0392B' };
const NUEVO = { serial: '', alias: '', titularId: '', sedeId: '' };

function Etiqueta({ texto, color }: Readonly<{ texto: string; color: string }>) {
  return <span style={{ background: `${color}26`, color, padding: '3px 10px', borderRadius: 20, fontSize: 11, fontWeight: 600, whiteSpace: 'nowrap' }}>{texto}</span>;
}

export default function DatafonosAdminPage() {
  const queryClient = useQueryClient();
  const [modal, setModal] = useState(false);
  const [form, setForm] = useState(NUEVO);
  const [comision, setComision] = useState<string | null>(null);

  const terminalesQ = useQuery({
    queryKey: ['admin-datafonos'],
    queryFn: () => datafonosApi.admin.terminales().then((r) => r.data as { configurado: boolean; terminales: Terminal[] }),
  });
  const cobrosQ = useQuery({
    queryKey: ['admin-datafonos-cobros'],
    queryFn: () => datafonosApi.admin.cobros().then((r) => r.data.cobros as CobroAdmin[]),
    refetchInterval: 15_000,
  });
  const configQ = useQuery({
    queryKey: ['admin-datafonos-config'],
    queryFn: () => datafonosApi.admin.config().then((r) => r.data.comisionPct as number),
  });
  const empresasQ = useQuery({
    queryKey: ['admin-datafonos-empresas'],
    queryFn: () => adminApi.kushkiComercios({ limit: 200 }).then((r) => r.data.cuentas as Empresa[]),
  });

  const refrescar = () => {
    queryClient.invalidateQueries({ queryKey: ['admin-datafonos'] });
    queryClient.invalidateQueries({ queryKey: ['admin-datafonos-cobros'] });
  };

  const crear = useMutation({
    mutationFn: () => datafonosApi.admin.crearTerminal({ serial: form.serial.trim(), alias: form.alias.trim(), titularId: form.titularId, sedeId: form.sedeId || null }),
    onSuccess: () => { toast.success('Datáfono registrado'); setModal(false); setForm(NUEVO); refrescar(); },
    onError: (err: any) => toast.error(err.response?.data?.mensaje || 'No se pudo registrar el datáfono'),
  });
  const editar = useMutation({
    mutationFn: (v: { id: string; data: { activo?: boolean; sedeId?: string | null } }) => datafonosApi.admin.editarTerminal(v.id, v.data),
    onSuccess: () => refrescar(),
    onError: (err: any) => toast.error(err.response?.data?.mensaje || 'No se pudo actualizar'),
  });
  const guardarComision = useMutation({
    mutationFn: (pct: number) => datafonosApi.admin.guardarConfig(pct),
    onSuccess: ({ data }) => { toast.success(`Comisión de datáfono: ${data.comisionPct}%`); setComision(null); queryClient.invalidateQueries({ queryKey: ['admin-datafonos-config'] }); },
    onError: (err: any) => toast.error(err.response?.data?.mensaje || 'No se pudo guardar la comisión'),
  });

  const terminales = terminalesQ.data?.terminales ?? [];
  const empresa = empresasQ.data?.find((e) => e.userId === form.titularId);
  const serialOk = /^[A-Za-z0-9_-]{4,64}$/.test(form.serial.trim());
  const puedeCrear = serialOk && form.alias.trim().length >= 2 && !!form.titularId && !crear.isPending;
  const pctEditado = comision ?? String(configQ.data ?? 0);

  return (
    <div style={{ display: 'grid', gap: 20 }}>
      {terminalesQ.data && !terminalesQ.data.configurado && (
        <Panel style={{ padding: '14px 20px', borderColor: 'rgba(212,160,23,.45)' }}>
          <strong style={{ color: '#d4a017' }}>Falta configurar Kushki One en el servidor.</strong>{' '}
          Mientras no estén las variables <code>KUSHKI_ONE_BUSINESS_CODE</code> y <code>KUSHKI_ONE_WEBHOOK_TOKEN</code> (y la URL pública del API), nadie puede cobrar con datáfono.
        </Panel>
      )}

      <Panel>
        <PanelHeader title="Comisión de TrendPay por cobro con datáfono" icon={<Smartphone size={16} />} />
        <div style={{ padding: 20, display: 'flex', alignItems: 'flex-end', gap: 12, flexWrap: 'wrap' }}>
          <div style={{ width: 160 }}>
            <Input label="Comisión (%)" type="number" min={0} max={20} step={0.1} value={pctEditado} onChange={(e) => setComision(e.target.value)} />
          </div>
          <div style={{ marginBottom: 14 }}>
            <Btn variant="primary" disabled={comision === null || guardarComision.isPending || Number.isNaN(Number(comision)) || comision.trim() === ''} onClick={() => guardarComision.mutate(Number(comision))}>Guardar</Btn>
          </div>
          <p style={{ margin: '0 0 16px', fontSize: 12, opacity: 0.7, maxWidth: 420 }}>
            Se descuenta del cobro antes de acreditar a la empresa. 0 = sin comisión. Aplica a los cobros nuevos; los ya hechos no cambian.
          </p>
        </div>
      </Panel>

      <Panel>
        <PanelHeader
          title={`Datáfonos (${terminales.length})`}
          icon={<Smartphone size={16} />}
          actions={<Btn variant="primary" onClick={() => setModal(true)}><Plus size={14} /> Registrar datáfono</Btn>}
        />
        <Table headers={['Nombre', 'Serial', 'Empresa', 'Sede', 'Cobros', 'Estado', '']} empty="Aún no hay datáfonos registrados">
          {terminales.map((t) => (
            <Tr key={t.id}>
              <Td><strong>{t.alias}</strong><div style={{ fontSize: 11, opacity: 0.6 }}>{t.modelo}</div></Td>
              <Td style={{ fontFamily: 'monospace', fontSize: 12 }}>{t.serial}</Td>
              <Td>{t.titular}</Td>
              <Td>
                {/* Cambiar la tienda a la que pertenece el datáfono */}
                <select
                  aria-label={`Tienda de ${t.alias}`}
                  value={t.sedeId ?? ''}
                  disabled={editar.isPending}
                  onChange={(e) => editar.mutate({ id: t.id, data: { sedeId: e.target.value || null } })}
                  style={{ background: 'rgba(var(--adm-card-rgb),.7)', border: '1.5px solid rgba(133,46,199,.25)', borderRadius: 8, padding: '6px 8px', fontSize: 12, color: 'var(--adm-text)', maxWidth: 200 }}
                >
                  <option value="">Toda la empresa</option>
                  {(empresasQ.data?.find((e) => e.userId === t.titularId)?.subcuentas ?? []).map((s) => <option key={s.id} value={s.id}>{s.nombre}</option>)}
                </select>
              </Td>
              <Td>{t.cobros}</Td>
              <Td><Etiqueta texto={t.activo ? 'Activo' : 'Desactivado'} color={t.activo ? '#6CC998' : '#888'} /></Td>
              <Td>
                <Btn variant={t.activo ? 'danger' : 'default'} disabled={editar.isPending} onClick={() => editar.mutate({ id: t.id, data: { activo: !t.activo } })}>
                  {t.activo ? 'Desactivar' : 'Activar'}
                </Btn>
              </Td>
            </Tr>
          ))}
        </Table>
      </Panel>

      <Panel>
        <PanelHeader title="Ventas por tienda y datáfono" icon={<Smartphone size={16} />} />
        <div style={{ padding: 20 }}><ResumenVentas admin /></div>
      </Panel>

      <Panel>
        <PanelHeader title="Últimos cobros" actions={<Btn onClick={refrescar}><RefreshCw size={14} /> Actualizar</Btn>} />
        <Table headers={['Fecha', 'Empresa', 'Datáfono', 'Cajero', 'Monto', 'Estado', 'Detalle']} empty="Todavía no hay cobros con datáfono">
          {(cobrosQ.data ?? []).map((c) => (
            <Tr key={c.id}>
              <Td>{fmtDate(c.creado)}</Td>
              <Td>{c.empresa}</Td>
              <Td>{c.terminal}</Td>
              <Td>{c.cajero}</Td>
              <Td>{fmt(c.monto)}{c.comisionPct > 0 && <div style={{ fontSize: 11, opacity: 0.6 }}>comisión {c.comisionPct}%</div>}</Td>
              <Td><Etiqueta texto={c.estado} color={COLOR_ESTADO[c.estado] ?? '#888'} /></Td>
              <Td style={{ fontSize: 12, opacity: 0.8 }}>{c.detalle ?? (c.ticketNumber ? `Ticket ${c.ticketNumber}` : c.estadoTerminal ?? '')}</Td>
            </Tr>
          ))}
        </Table>
      </Panel>

      <Modal open={modal} onClose={() => setModal(false)} title="Registrar datáfono">
        <Input label="Número de serie del terminal" placeholder="Ej. TJ54241P20911" value={form.serial} onChange={(e) => setForm({ ...form, serial: e.target.value })} />
        {form.serial.trim() !== '' && !serialOk && <p style={{ color: '#C0392B', fontSize: 12, marginTop: -8 }}>Solo letras, números, guion y guion bajo (4 a 64 caracteres).</p>}
        <p style={{ fontSize: 12, opacity: 0.7, marginTop: -6 }}>Es el serial del aparato (va impreso atrás, como “SN”), no el código de terminal ni el Merchant ID.</p>
        <Input label="Nombre (cómo lo verá el cajero)" placeholder="Ej. Caja 1" value={form.alias} onChange={(e) => setForm({ ...form, alias: e.target.value })} />
        <Select label="Empresa dueña de la billetera" value={form.titularId} onChange={(e) => setForm({ ...form, titularId: e.target.value, sedeId: '' })}>
          <option value="">Elige una empresa…</option>
          {(empresasQ.data ?? []).map((e) => <option key={e.userId} value={e.userId}>{e.nombre}</option>)}
        </Select>
        <Select label="Sede que lo usa (opcional)" value={form.sedeId} onChange={(e) => setForm({ ...form, sedeId: e.target.value })} disabled={!empresa}>
          <option value="">Toda la empresa</option>
          {(empresa?.subcuentas ?? []).map((s) => <option key={s.id} value={s.id}>{s.nombre}</option>)}
        </Select>
        <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
          <Btn variant="ghost" onClick={() => setModal(false)}>Cancelar</Btn>
          <Btn variant="primary" disabled={!puedeCrear} onClick={() => crear.mutate()}>{crear.isPending ? 'Guardando…' : 'Registrar'}</Btn>
        </div>
      </Modal>
    </div>
  );
}
