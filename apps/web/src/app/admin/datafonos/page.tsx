'use client';
import { useState } from 'react';
import toast from 'react-hot-toast';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Copy, FileUp, KeyRound, Plus, RefreshCw, Smartphone } from 'lucide-react';
import { adminApi, datafonosApi } from '@/lib/api';
import { ResumenVentas } from '@/components/datafonos/ResumenVentas';
import { Panel, PanelHeader, Table, Tr, Td, Btn, Modal, Input, Select, fmt, fmtDate } from '@/components/admin/ui';

interface Terminal {
  id: string; serial: string; alias: string; modelo: string; activo: boolean;
  titularId: string; titular: string; sedeId: string | null; sede: string | null; cobros: number; virtual?: boolean;
}
interface CobroAdmin {
  id: string; estado: string; estadoTerminal: string | null; detalle: string | null; monto: number; comisionPct: number;
  terminal: string; empresa: string; cajero: string; tipo: string; origen: string; ticketNumber: string | null; creado: string;
}
interface Empresa { userId: string; nombre: string; subcuentas: { id: string; nombre: string }[] }
interface SedeLlave { id: string; nombre: string; configurado: boolean; termina: string; terminales: number; canal: 'datafono' | 'web' }
interface EmpresaCodigo { titularId: string; nombre: string; configurado: boolean; termina: string; firma: boolean; terminales: number; sedes: SedeLlave[]; comisionPropia?: number | null }

const COLOR_ESTADO: Record<string, string> = { aprobado: '#6CC998', pendiente: '#d4a017', expirado: '#d4a017', revision: '#d4a017', reembolsando: '#d4a017', reembolsado: '#C0392B', rechazado: '#C0392B', cancelado: '#C0392B', error: '#C0392B' };
const NUEVO = { serial: '', alias: '', titularId: '', sedeId: '' };

function Etiqueta({ texto, color }: Readonly<{ texto: string; color: string }>) {
  return <span style={{ background: `${color}26`, color, padding: '3px 10px', borderRadius: 20, fontSize: 11, fontWeight: 600, whiteSpace: 'nowrap' }}>{texto}</span>;
}

export default function DatafonosAdminPage() {
  const queryClient = useQueryClient();
  const [modal, setModal] = useState(false);
  const [form, setForm] = useState(NUEVO);
  const [comision, setComision] = useState<string | null>(null);
  // Conexión con Kushki por empresa: a quién se le asigna (vacío = elegir), la firma de webhooks y el Business-Code (opcional)
  const [buscar, setBuscar] = useState('');
  const [codigoModal, setCodigoModal] = useState<{ titularId: string } | null>(null);
  const [firma, setFirma] = useState('');
  const [codigo, setCodigo] = useState('');
  const [canal, setCanal] = useState<'datafono' | 'web'>('datafono');
  const [canalOriginal, setCanalOriginal] = useState<'datafono' | 'web'>('datafono'); // el que ya tenía la llave, para saber si lo cambiaron

  const terminalesQ = useQuery({
    queryKey: ['admin-datafonos'],
    queryFn: () => datafonosApi.admin.terminales().then((r) => r.data as { urlPublica: boolean; urlWebhook: string | null; empresas: EmpresaCodigo[]; terminales: Terminal[] }),
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

  const guardarCredenciales = useMutation({
    mutationFn: () => datafonosApi.admin.guardarCredenciales(codigoModal!.titularId, { ...(firma.trim() && !esTienda ? { webhookSecret: firma.trim() } : {}), ...(codigo.trim() ? { businessCode: codigo.trim() } : {}), ...(esTienda && (codigo.trim() || canal !== canalOriginal) ? { canal } : {}) }),
    onSuccess: () => { toast.success('Credenciales guardadas'); setCodigoModal(null); setFirma(''); setCodigo(''); refrescar(); },
    onError: (err: any) => toast.error(err.response?.data?.mensaje || 'No se pudieron guardar'),
  });
  const sincronizar = useMutation({
    mutationFn: (e: { titularId: string; nombre: string }) => datafonosApi.admin.sincronizar(e.titularId).then((r) => ({ e, r: r.data.resumen })),
    onSuccess: ({ e, r }) => {
      refrescar();
      if (r.omitida) { toast(`${e.nombre}: ${r.omitida}`, { duration: 8000 }); return; }
      toast.success(`${e.nombre}: ${r.revisadas} movimientos revisados · ${r.ventas} ventas nuevas · ${r.reembolsos} reembolsos${r.sinAparato ? ` · ${r.sinAparato} sin identificar el datáfono` : ''}${r.errores ? ` · ${r.errores} con error` : ''}${r.campos ? ` · Kushki trae: ${(r.campos as string[]).join(', ')}` : ''}`, { duration: 20000 });
    },
    onError: (err: any) => toast.error(err.response?.data?.mensaje || 'No se pudo sincronizar con Kushki', { duration: 10000 }),
  });
  // Importar un reporte de transacciones de la consola de Kushki (.csv): refleja lo que ya ocurrió (datáfono y/o página web)
  const [importarModal, setImportarModal] = useState(false);
  const [importCuenta, setImportCuenta] = useState('');
  const [importArchivo, setImportArchivo] = useState<File | null>(null);
  const importar = useMutation({
    mutationFn: () => datafonosApi.admin.importarVentas(importCuenta, importArchivo!).then((r) => r.data.resumen),
    onSuccess: (r) => {
      refrescar();
      setImportarModal(false); setImportArchivo(null);
      toast.success(`${r.ventas} ventas (${fmt(r.montoVentas)}: ${r.ventasWeb} de la web, ${r.ventasDatafono} de datáfonos) y ${r.reembolsos} reembolsos (${fmt(r.montoReembolsos)}) importados · ${r.repetidas} ya estaban · ${r.ignoradas} ignoradas (rechazadas o sin número)${r.errores ? ` · ${r.errores} con error` : ''}`, { duration: 20000 });
    },
    onError: (err: any) => toast.error(err.response?.data?.mensaje || 'No se pudo importar el archivo', { duration: 10000 }),
  });

  // Comisión de datáfonos propia de una empresa (lo pactado con ella); vacía = usa la general
  const [comisionEmpresa, setComisionEmpresa] = useState<{ titularId: string; nombre: string } | null>(null);
  const [comisionEmpresaTexto, setComisionEmpresaTexto] = useState('');
  const guardarComisionEmpresa = useMutation({
    mutationFn: (v: { titularId: string; pct: number | null }) => datafonosApi.admin.guardarComisionEmpresa(v.titularId, v.pct),
    onSuccess: ({ data }) => {
      toast.success(data.comisionPropia === null ? `Ahora usa la comisión general (${data.efectiva}%)` : `Comisión de esa empresa: ${data.comisionPropia}%`);
      setComisionEmpresa(null);
      refrescar();
    },
    onError: (err: any) => toast.error(err.response?.data?.mensaje || 'No se pudo guardar la comisión'),
  });

  const quitarCodigo = useMutation({
    mutationFn: (titularId: string) => datafonosApi.admin.quitarBusinessCode(titularId),
    onSuccess: () => { toast.success('Credenciales quitadas'); refrescar(); },
    onError: (err: any) => toast.error(err.response?.data?.mensaje || 'No se pudo quitar'),
  });

  const q = buscar.trim().toLowerCase();
  // Los "terminales" virtuales (datáfono sin identificar, página web) son del sistema, no aparatos: no se listan
  const todasLasTerminales = (terminalesQ.data?.terminales ?? []).filter((t) => !t.virtual);
  const todasLasEmpresas = terminalesQ.data?.empresas ?? [];
  // Con muchas empresas se busca por nombre de empresa, de tienda, alias o serial
  const terminales = q ? todasLasTerminales.filter((t) => `${t.alias} ${t.serial} ${t.titular} ${t.sede ?? ''}`.toLowerCase().includes(q)) : todasLasTerminales;
  const empresasCodigo = q ? todasLasEmpresas.filter((e) => e.nombre.toLowerCase().includes(q) || e.sedes.some((x) => x.nombre.toLowerCase().includes(q))) : todasLasEmpresas;
  const sinFirma = todasLasEmpresas.filter((e) => e.terminales > 0 && !e.firma);
  const esTienda = !!codigoModal?.titularId && (empresasQ.data ?? []).some((e) => (e.subcuentas ?? []).some((s) => s.id === codigoModal.titularId));
  const firmaOk = firma.trim() === '' || /^\S{8,300}$/.test(firma.trim());
  const codigoOk = codigo.trim() === '' || /^[A-Za-z0-9_-]{8,128}$/.test(codigo.trim());
  const hayAlgo = (firma.trim() !== '' && !esTienda) || codigo.trim() !== '' || (esTienda && canal !== canalOriginal);
  const urlWebhook = terminalesQ.data?.urlWebhook ?? '';
  const empresa = empresasQ.data?.find((e) => e.userId === form.titularId);
  const serialOk = /^[A-Za-z0-9_-]{4,64}$/.test(form.serial.trim());
  const puedeCrear = serialOk && form.alias.trim().length >= 2 && !!form.titularId && !crear.isPending;
  const pctEditado = comision ?? String(configQ.data ?? 0);

  return (
    <div style={{ display: 'grid', gap: 20 }}>
      {terminalesQ.data && !terminalesQ.data.urlPublica && (
        <Panel style={{ padding: '14px 20px', borderColor: 'rgba(212,160,23,.45)' }}>
          <strong style={{ color: '#d4a017' }}>Falta la dirección pública del API.</strong>{' '}
          Agrega en Railway la variable <code>KUSHKI_ONE_WEBHOOK_URL</code> con la dirección del API; sin ella Kushki no sabe a dónde avisar.
        </Panel>
      )}
      {sinFirma.length > 0 && (
        <Panel style={{ padding: '14px 20px', borderColor: 'rgba(212,160,23,.45)' }}>
          <strong style={{ color: '#d4a017' }}>Falta la firma de webhooks de Kushki</strong> para: {sinFirma.slice(0, 6).map((e) => e.nombre).join(', ')}{sinFirma.length > 6 ? ` y ${sinFirma.length - 6} más` : ''}. Sin ella, las ventas que se hagan en sus datáfonos no se reflejan en TrendPay (Kushki las reintenta unas horas y luego las descarta).
        </Panel>
      )}

      <Panel>
        <PanelHeader
          title="Conexión con Kushki por empresa"
          icon={<KeyRound size={16} />}
          actions={<div style={{ display: 'flex', gap: 8 }}><Btn onClick={() => { setImportCuenta(''); setImportArchivo(null); setImportarModal(true); }}><FileUp size={14} /> Importar reporte de Kushki</Btn><Btn variant="primary" onClick={() => { setFirma(''); setCodigo(''); setCodigoModal({ titularId: '' }); }}><Plus size={14} /> Asignar firma de webhooks</Btn></div>}
        />
        <div style={{ padding: '12px 20px 4px', fontSize: 12, lineHeight: 1.7, opacity: 0.85 }}>
          <strong>Cómo se conectan los datáfonos.</strong> El cajero digita el valor en el aparato; TrendPay no le manda nada. Las ventas llegan de dos formas que pueden convivir: <strong>(1) sincronización</strong> — TrendPay le pregunta a Kushki cada 2 minutos con la llave privada de la empresa (columna Business-Code; basta con asignarla), y <strong>(2) webhook</strong> — Kushki avisa al instante, si te activan los webhooks de card present. Para el webhook, en la consola de la cuenta de <strong>card present</strong>:
          <ol style={{ margin: '6px 0 0', paddingLeft: 18 }}>
            <li>Entra a <strong>Desarrolladores → Webhooks</strong> y crea un webhook con esta dirección, marcando las transacciones aprobadas y las devoluciones:</li>
          </ol>
          {urlWebhook ? (
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, margin: '8px 0', flexWrap: 'wrap' }}>
              <code style={{ background: 'rgba(var(--adm-card-rgb),.7)', padding: '6px 10px', borderRadius: 8, fontSize: 12, wordBreak: 'break-all' }}>{urlWebhook}</code>
              <Btn onClick={() => { navigator.clipboard.writeText(urlWebhook); toast.success('Dirección copiada'); }}><Copy size={13} /> Copiar</Btn>
            </div>
          ) : <div style={{ color: '#d4a017', margin: '6px 0' }}>Falta la dirección pública del API (arriba).</div>}
          <ol start={2} style={{ margin: 0, paddingLeft: 18 }}>
            <li>Copia la <strong>Webhook signature</strong> que sale arriba de esa misma página y pégala aquí para la empresa (se guarda cifrada y no se vuelve a mostrar).</li>
          </ol>
        </div>
        <div style={{ padding: '4px 20px 12px' }}>
          <Input label="" placeholder="Buscar empresa, tienda, datáfono o serial…" value={buscar} onChange={(e) => setBuscar(e.target.value)} style={{ maxWidth: 360 }} />
        </div>
        <Table headers={['Empresa', 'Datáfonos', 'Comisión datáfonos', 'Firma de webhooks (opcional)', 'Llave privada (Business-Code)', '']} empty="Aún no hay empresas con datáfonos">
          {empresasCodigo.flatMap((e) => [
            <Tr key={e.titularId}>
              <Td><strong>{e.nombre}</strong></Td>
              <Td>{e.terminales}</Td>
              <Td>
                {e.comisionPropia != null ? <Etiqueta texto={`${e.comisionPropia}% propia`} color="#c088f0" /> : <span style={{ fontSize: 12, opacity: 0.7 }}>General ({configQ.data ?? 0}%)</span>}
              </Td>
              <Td><Etiqueta texto={e.firma ? 'Configurada' : 'Falta'} color={e.firma ? '#6CC998' : '#d4a017'} /></Td>
              <Td>{e.configurado ? <Etiqueta texto="Guardada" color="#6CC998" /> : <Etiqueta texto="Falta" color="#d4a017" />}</Td>
              <Td>
                <div style={{ display: 'flex', gap: 6 }}>
                  {e.configurado && <Btn disabled={sincronizar.isPending} title="Trae ahora las ventas del datáfono desde Kushki (se hace solo cada 2 minutos)" onClick={() => sincronizar.mutate(e)}>{sincronizar.isPending && sincronizar.variables?.titularId === e.titularId ? 'Sincronizando…' : 'Sincronizar ahora'}</Btn>}
                  <Btn title="Comisión de datáfonos de esta empresa" onClick={() => { setComisionEmpresaTexto(e.comisionPropia != null ? String(e.comisionPropia) : ''); setComisionEmpresa({ titularId: e.titularId, nombre: e.nombre }); }}>Comisión</Btn>
                  <Btn onClick={() => { setFirma(''); setCodigo(''); setCodigoModal({ titularId: e.titularId }); }}>{e.firma ? 'Cambiar' : 'Asignar'}</Btn>
                  {(e.firma || e.configurado) && <Btn variant="danger" disabled={quitarCodigo.isPending} onClick={() => { if (window.confirm(`¿Quitar las credenciales de ${e.nombre}? Sus datáfonos dejarán de reflejarse en TrendPay.`)) quitarCodigo.mutate(e.titularId); }}>Quitar</Btn>}
                </div>
              </Td>
            </Tr>,
            ...e.sedes.map((s) => (
              <Tr key={s.id}>
                <Td style={{ paddingLeft: 28 }}>↳ {s.nombre}<div style={{ fontSize: 11, opacity: 0.6 }}>{s.canal === 'web' ? 'Pagos de la página web (en línea)' : 'Llave propia de esta tienda (datáfonos)'}</div></Td>
                <Td>{s.terminales}</Td>
                <Td><span style={{ opacity: 0.5 }}>—</span></Td>
                <Td><span style={{ opacity: 0.5 }}>—</span></Td>
                <Td>{s.configurado ? <Etiqueta texto="Guardada" color="#6CC998" /> : <Etiqueta texto="Sin llave propia" color="#888" />}</Td>
                <Td>
                  <div style={{ display: 'flex', gap: 6 }}>
                    {s.configurado && <Btn disabled={sincronizar.isPending} title="Trae ahora las ventas de esta tienda desde Kushki (se hace solo cada 2 minutos)" onClick={() => sincronizar.mutate({ titularId: s.id, nombre: `${e.nombre} · ${s.nombre}` })}>{sincronizar.isPending && sincronizar.variables?.titularId === s.id ? 'Sincronizando…' : 'Sincronizar ahora'}</Btn>}
                    <Btn onClick={() => { setFirma(''); setCodigo(''); setCanal(s.canal ?? 'datafono'); setCanalOriginal(s.canal ?? 'datafono'); setCodigoModal({ titularId: s.id }); }}>{s.configurado ? 'Cambiar' : 'Asignar llave'}</Btn>
                    {s.configurado && <Btn variant="danger" disabled={quitarCodigo.isPending} onClick={() => { if (window.confirm(`¿Quitar la llave de ${s.nombre}? Sus ventas dejarán de reflejarse en esa tienda por esta vía.`)) quitarCodigo.mutate(s.id); }}>Quitar</Btn>}
                  </div>
                </Td>
              </Tr>
            )),
          ])}
        </Table>
      </Panel>

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
                <div style={{ display: 'flex', gap: 6 }}>
                  <Btn variant={t.activo ? 'danger' : 'default'} disabled={editar.isPending} onClick={() => editar.mutate({ id: t.id, data: { activo: !t.activo } })}>
                    {t.activo ? 'Desactivar' : 'Activar'}
                  </Btn>
                </div>
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
        <Table headers={['Fecha', 'Empresa', 'Datáfono', 'Movimiento', 'Monto', 'Estado', 'Detalle']} empty="Todavía no hay cobros con datáfono">
          {(cobrosQ.data ?? []).map((c) => (
            <Tr key={c.id}>
              <Td>{fmtDate(c.creado)}</Td>
              <Td>{c.empresa}</Td>
              <Td>{c.terminal}</Td>
              <Td><Etiqueta texto={c.tipo === 'reembolso' ? 'Reembolso' : 'Venta'} color={c.tipo === 'reembolso' ? '#C0392B' : '#852EC7'} /><div style={{ fontSize: 11, opacity: 0.6, marginTop: 2 }}>{c.cajero}</div></Td>
              <Td>{c.tipo === 'reembolso' ? '−' : ''}{fmt(c.monto)}{c.comisionPct > 0 && <div style={{ fontSize: 11, opacity: 0.6 }}>comisión {c.comisionPct}%</div>}</Td>
              <Td><Etiqueta texto={c.estado} color={COLOR_ESTADO[c.estado] ?? '#888'} /></Td>
              <Td style={{ fontSize: 12, opacity: 0.8 }}>{c.detalle ?? (c.ticketNumber ? `Ticket ${c.ticketNumber}` : c.estadoTerminal ?? '')}</Td>
            </Tr>
          ))}
        </Table>
      </Panel>

      <Modal open={!!codigoModal} onClose={() => { setCodigoModal(null); setFirma(''); setCodigo(''); }} title="Conexión con Kushki">
        <Select label="Empresa" value={codigoModal?.titularId ?? ''} onChange={(e) => setCodigoModal({ titularId: e.target.value })}>
          <option value="">Elige una empresa…</option>
          {(empresasQ.data ?? []).flatMap((e) => [
            <option key={e.userId} value={e.userId}>{e.nombre}</option>,
            ...(e.subcuentas ?? []).map((s) => <option key={s.id} value={s.id}>↳ {e.nombre} · {s.nombre} (llave propia de la tienda)</option>),
          ])}
        </Select>
        {!esTienda && (
          <>
            <Input label="Firma de webhooks (opcional: solo si Kushki te activa los webhooks)" type="password" autoComplete="off" value={firma} onChange={(e) => setFirma(e.target.value)} />
            {!firmaOk && <p style={{ color: '#C0392B', fontSize: 12, marginTop: -8 }}>Sin espacios, de 8 a 300 caracteres.</p>}
            <p style={{ fontSize: 12, opacity: 0.7, marginTop: -6 }}>Consola de Kushki, cuenta de card present → Desarrolladores → Webhooks: aparece arriba de la página. No se vuelve a mostrar.</p>
          </>
        )}
        {esTienda && (
          <>
            <Select label="¿Qué cobra el Branch de esta llave?" value={canal} onChange={(e) => setCanal(e.target.value as 'datafono' | 'web')}>
              <option value="datafono">Datáfonos de la tienda (tarjeta presente)</option>
              <option value="web">Página web (pagos en línea: tarjeta, PSE, efectivo)</option>
            </Select>
            <p style={{ fontSize: 12, opacity: 0.7, marginTop: -6 }}>
              {canal === 'web'
                ? 'Cada pago aprobado en ese Branch de pagos en línea queda en esta cuenta con la comisión de datáfonos; los reembolsos se descuentan completos.'
                : 'Todo lo que Kushki registre en el Branch de esta tienda queda en esta tienda, sin importar el datáfono.'}
            </p>
          </>
        )}
        <Input label={esTienda ? 'Llave privada del Branch de esta tienda (Private Merchant ID) — déjala vacía para conservar la que ya está guardada' : 'Llave privada de la Branch de card present (Business-Code): para la sincronización cada 2 minutos'} type="password" autoComplete="off" value={codigo} onChange={(e) => setCodigo(e.target.value)} />
        {!codigoOk && <p style={{ color: '#C0392B', fontSize: 12, marginTop: -8 }}>Solo letras, números, guion y guion bajo (8 a 128 caracteres).</p>}
        <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
          <Btn variant="ghost" onClick={() => { setCodigoModal(null); setFirma(''); setCodigo(''); }}>Cancelar</Btn>
          <Btn variant="primary" disabled={!codigoModal?.titularId || !hayAlgo || !firmaOk || !codigoOk || guardarCredenciales.isPending} onClick={() => guardarCredenciales.mutate()}>{guardarCredenciales.isPending ? 'Guardando…' : 'Guardar'}</Btn>
        </div>
      </Modal>

      <Modal open={!!comisionEmpresa} onClose={() => setComisionEmpresa(null)} title={`Comisión de datáfonos · ${comisionEmpresa?.nombre ?? ''}`}>
        <p style={{ fontSize: 12, opacity: 0.75, marginTop: 0 }}>
          Es lo que TrendPay descuenta a esta empresa en cada venta de datáfono o de su página web. Si la dejas vacía usa la comisión general (<strong>{configQ.data ?? 0}%</strong>).
          Aplica a las ventas nuevas; las ya registradas no cambian.
        </p>
        <Input label="Comisión propia (%)" type="number" min={0} max={20} step={0.1} placeholder={`Vacío = general (${configQ.data ?? 0}%)`} value={comisionEmpresaTexto} onChange={(e) => setComisionEmpresaTexto(e.target.value)} />
        <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
          <Btn variant="ghost" onClick={() => setComisionEmpresa(null)}>Cancelar</Btn>
          <Btn variant="primary" disabled={guardarComisionEmpresa.isPending || (comisionEmpresaTexto.trim() !== '' && (Number.isNaN(Number(comisionEmpresaTexto)) || Number(comisionEmpresaTexto) < 0 || Number(comisionEmpresaTexto) > 20))}
            onClick={() => guardarComisionEmpresa.mutate({ titularId: comisionEmpresa!.titularId, pct: comisionEmpresaTexto.trim() === '' ? null : Number(comisionEmpresaTexto) })}>
            {guardarComisionEmpresa.isPending ? 'Guardando…' : 'Guardar'}
          </Btn>
        </div>
      </Modal>

      <Modal open={importarModal} onClose={() => setImportarModal(false)} title="Importar reporte de Kushki">
        <p style={{ fontSize: 12, opacity: 0.75, marginTop: 0 }}>
          Sube el archivo .csv de transacciones de la consola de Kushki. Las filas de datáfono y las de pagos en línea (tarjeta no presente, PSE, efectivo) se reconocen solas.
          Se acredita con la comisión de datáfonos de esa empresa (la propia, o la general de <strong>{configQ.data ?? 0}%</strong>) y cada movimiento conserva su fecha real. Lo que ya esté registrado no se duplica; los rechazados no se cuentan.
        </p>
        <Select label="¿A qué cuenta se acredita?" value={importCuenta} onChange={(e) => setImportCuenta(e.target.value)}>
          <option value="">Elige la cuenta…</option>
          {(empresasQ.data ?? []).flatMap((e) => [
            <option key={e.userId} value={e.userId}>{e.nombre} (cuenta principal)</option>,
            ...(e.subcuentas ?? []).map((s) => <option key={s.id} value={s.id}>↳ {e.nombre} · {s.nombre}</option>),
          ])}
        </Select>
        <label style={{ display: 'block', fontSize: 12, fontWeight: 600, margin: '4px 0 6px' }}>Archivo .csv</label>
        <input type="file" accept=".csv,text/csv,text/plain" onChange={(e) => setImportArchivo(e.target.files?.[0] ?? null)} style={{ marginBottom: 14, fontSize: 12 }} />
        <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
          <Btn variant="ghost" onClick={() => setImportarModal(false)}>Cancelar</Btn>
          <Btn variant="primary" disabled={!importCuenta || !importArchivo || importar.isPending} onClick={() => importar.mutate()}>{importar.isPending ? 'Importando…' : 'Importar'}</Btn>
        </div>
      </Modal>

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
