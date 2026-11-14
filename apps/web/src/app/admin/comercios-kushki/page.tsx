'use client';
import { useEffect, useState } from 'react';
import toast from 'react-hot-toast';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { QrCode, Search } from 'lucide-react';
import { adminApi } from '@/lib/api';
import { Panel, PanelHeader, Table, Tr, Td, Btn, Modal, Input, Select, fmtDate } from '@/components/admin/ui';

interface Cuenta {
  userId: string;
  nombre: string;
  cedula: string;
  correo: string;
  comercio: { activo: boolean; ambiente: string; publicTermina: string; actualizado: string } | null;
}

const LIMITE = 50;
const vacio = { publicMerchantId: '', privateMerchantId: '', ambiente: 'produccion', activo: true };

function Etiqueta({ children, color }: Readonly<{ children: React.ReactNode; color: 'verde' | 'gris' | 'amarillo' }>) {
  const c = { verde: ['rgba(108,201,152,.15)', '#6CC998'], gris: ['rgba(var(--adm-fg-rgb),.08)', 'rgba(var(--adm-fg-rgb),.5)'], amarillo: ['rgba(212,160,23,.15)', '#d4a017'] }[color];
  return <span style={{ background: c[0], color: c[1], padding: '3px 10px', borderRadius: 20, fontSize: 11, fontWeight: 600, whiteSpace: 'nowrap' }}>{children}</span>;
}

export default function ComerciosKushkiPage() {
  const queryClient = useQueryClient();
  const [busqueda, setBusqueda] = useState('');
  const [q, setQ] = useState('');
  const [page, setPage] = useState(1);
  const [editando, setEditando] = useState<Cuenta | null>(null);
  const [form, setForm] = useState(vacio);
  // Resultado de "Verificar" por cliente (no se guarda: solo para mostrarlo en la fila)
  const [verificados, setVerificados] = useState<Record<string, { breb: boolean; url: string }>>({});

  // Espera a que se deje de escribir para no consultar en cada tecla
  useEffect(() => {
    const t = setTimeout(() => { setQ(busqueda.trim()); setPage(1); }, 350);
    return () => clearTimeout(t);
  }, [busqueda]);

  const { data, isLoading } = useQuery({
    queryKey: ['admin-kushki-comercios', q, page],
    queryFn: () => adminApi.kushkiComercios({ q: q || undefined, page, limit: LIMITE }),
    select: (r) => r.data as { total: number; configurados: number; cuentas: Cuenta[] },
  });
  const cuentas = data?.cuentas ?? [];
  const paginas = Math.max(1, Math.ceil((data?.total ?? 0) / LIMITE));
  const refrescar = () => queryClient.invalidateQueries({ queryKey: ['admin-kushki-comercios'] });

  const guardar = useMutation({
    mutationFn: () => adminApi.kushkiGuardarComercio(editando!.userId, form),
    onSuccess: ({ data: r }) => {
      if (!r.verificado) toast('Guardado, pero Kushki no respondió: no se pudo verificar la llave');
      else if (r.brebHabilitado) toast.success('Guardado. Bre-B (QR) está activo en este Branch');
      else toast('Guardado, pero este Branch todavía no tiene Bre-B activo en Kushki');
      setEditando(null);
      refrescar();
    },
    onError: (err: any) => toast.error(err.response?.data?.mensaje || 'No se pudo guardar'),
  });

  const verificar = useMutation({
    mutationFn: (c: Cuenta) => adminApi.kushkiVerificarComercio(c.userId).then((r) => ({ c, r })),
    onSuccess: ({ c, r }) => {
      setVerificados((v) => ({ ...v, [c.userId]: { breb: r.data.brebHabilitado, url: r.data.entorno.urlBase } }));
      if (r.data.brebHabilitado) toast.success(`${c.nombre}: Bre-B (QR) activo`);
      else toast.error(`${c.nombre}: Kushki no devuelve Bre-B en este Branch`);
    },
    onError: (err: any) => toast.error(err.response?.data?.mensaje || 'No se pudo consultar a Kushki'),
  });

  const quitar = useMutation({
    mutationFn: (c: Cuenta) => adminApi.kushkiQuitarComercio(c.userId),
    onSuccess: () => { toast.success('Branch quitado'); refrescar(); },
    onError: (err: any) => toast.error(err.response?.data?.mensaje || 'No se pudo quitar'),
  });

  function abrir(c: Cuenta) {
    setForm({ ...vacio, ambiente: c.comercio?.ambiente ?? 'produccion', activo: c.comercio?.activo ?? true });
    setEditando(c);
  }

  const formValido = /^[A-Za-z0-9]{20,64}$/.test(form.publicMerchantId.trim()) && /^[A-Za-z0-9]{20,64}$/.test(form.privateMerchantId.trim());

  let filas: React.ReactNode;
  if (isLoading) filas = <Tr><Td colSpan={5} style={{ textAlign: 'center', padding: 32, color: 'rgba(var(--adm-fg-rgb),.3)' }}>Cargando...</Td></Tr>;
  else if (cuentas.length === 0) filas = <Tr><Td colSpan={5} style={{ textAlign: 'center', padding: 32, color: 'rgba(var(--adm-fg-rgb),.3)' }}>No hay cuentas con ese criterio</Td></Tr>;
  else {
    filas = cuentas.map((c) => {
      const v = verificados[c.userId];
      return (
        <Tr key={c.userId}>
          <Td style={{ fontSize: 12 }}>
            <strong>{c.nombre}</strong>
            <div style={{ fontSize: 10, color: 'rgba(var(--adm-fg-rgb),.4)' }}>CC {c.cedula} · {c.correo}</div>
          </Td>
          <Td>
            {c.comercio
              ? <Etiqueta color={c.comercio.activo ? 'verde' : 'amarillo'}>{c.comercio.activo ? 'Configurado' : 'Desactivado'}</Etiqueta>
              : <Etiqueta color="gris">Sin Branch</Etiqueta>}
          </Td>
          <Td style={{ fontSize: 11, fontFamily: 'monospace', color: 'rgba(var(--adm-fg-rgb),.5)' }}>
            {c.comercio ? `${c.comercio.ambiente === 'pruebas' ? 'Pruebas' : 'Producción'} · ${c.comercio.publicTermina}` : '—'}
          </Td>
          <Td>
            {v ? <Etiqueta color={v.breb ? 'verde' : 'amarillo'}>{v.breb ? 'Bre-B activo' : 'Sin Bre-B'}</Etiqueta>
              : <span style={{ fontSize: 11, color: 'rgba(var(--adm-fg-rgb),.3)' }}>{c.comercio ? 'Sin verificar' : '—'}</span>}
          </Td>
          <Td>
            <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
              <Btn variant="primary" onClick={() => abrir(c)}>{c.comercio ? 'Cambiar llaves' : 'Asignar Branch'}</Btn>
              {c.comercio && (
                <>
                  <Btn variant="ghost" disabled={verificar.isPending} onClick={() => verificar.mutate(c)} title="Pregunta a Kushki qué métodos tiene activos este Branch">Verificar</Btn>
                  <Btn variant="danger" disabled={quitar.isPending}
                    onClick={() => { if (window.confirm(`¿Quitar el Branch de ${c.nombre}? Sus clientes dejarán de ver Bre-B.`)) quitar.mutate(c); }}>Quitar</Btn>
                </>
              )}
            </div>
          </Td>
        </Tr>
      );
    });
  }

  return (
    <>
      <Panel>
        <PanelHeader title={`Cuentas y su Branch de Kushki${data ? ` · ${data.configurados} de ${data.total} configurados` : ''}`} icon={<QrCode size={16} />} />
        <div style={{ padding: '12px 16px', fontSize: 12, color: 'rgba(var(--adm-fg-rgb),.6)', lineHeight: 1.6, borderBottom: '1px solid rgba(133,46,199,.12)' }}>
          Cada cliente (cuenta padre) cobra sus QR de Bre-B con su propio Branch de Kushki: el pago entra a su comercio, no al de TrendPay.
          Aquí pegas la Public Key y la Private Key de cada Branch (se guardan cifradas y no se vuelven a mostrar). Sin Branch asignado, el cliente no ve la opción Bre-B.
        </div>
        <div style={{ position: 'relative', padding: '12px 16px' }}>
          <Search size={14} style={{ position: 'absolute', left: 28, top: 24, color: 'rgba(var(--adm-fg-rgb),.4)' }} />
          <input value={busqueda} onChange={(e) => setBusqueda(e.target.value)} placeholder="Buscar por nombre, cédula o correo"
            style={{ width: '100%', maxWidth: 380, background: 'rgba(var(--adm-card-rgb),.7)', border: '1.5px solid rgba(133,46,199,.25)', borderRadius: 10, padding: '9px 12px 9px 34px', fontSize: 13, color: 'var(--adm-text)', outline: 'none', boxSizing: 'border-box' }} />
        </div>
        <Table headers={['Cliente', 'Branch', 'Ambiente · Public Key', 'Bre-B', 'Acciones']}>{filas}</Table>
        {paginas > 1 && (
          <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', gap: 12, padding: 14, fontSize: 12 }}>
            <Btn variant="ghost" disabled={page <= 1} onClick={() => setPage((p) => p - 1)}>Anterior</Btn>
            <span>Página {page} de {paginas}</span>
            <Btn variant="ghost" disabled={page >= paginas} onClick={() => setPage((p) => p + 1)}>Siguiente</Btn>
          </div>
        )}
      </Panel>

      <Modal open={!!editando} onClose={() => setEditando(null)} title={editando ? `Branch de Kushki · ${editando.nombre}` : ''}>
        <p style={{ fontSize: 12, color: 'rgba(var(--adm-fg-rgb),.6)', lineHeight: 1.6, marginTop: 0 }}>
          Copia las llaves desde <strong>Credenciales</strong> del Branch de este cliente en la consola de Kushki.
          {editando?.comercio && ' Al guardar se reemplazan las anteriores.'}
        </p>
        <Input label="Public Key" value={form.publicMerchantId} autoComplete="off" spellCheck={false}
          onChange={(e) => setForm((f) => ({ ...f, publicMerchantId: e.target.value }))} />
        <Input label="Private Key" type="password" value={form.privateMerchantId} autoComplete="new-password" spellCheck={false}
          onChange={(e) => setForm((f) => ({ ...f, privateMerchantId: e.target.value }))} />
        <Select label="Ambiente del Branch" value={form.ambiente} onChange={(e) => setForm((f) => ({ ...f, ambiente: e.target.value }))}>
          <option value="produccion">Producción (console.kushkipagos.com)</option>
          <option value="pruebas">Pruebas (UAT)</option>
        </Select>
        <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12, marginBottom: 16 }}>
          <input type="checkbox" checked={form.activo} onChange={(e) => setForm((f) => ({ ...f, activo: e.target.checked }))} />
          Activo (el cliente puede generar QR)
        </label>
        <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end' }}>
          <Btn variant="ghost" onClick={() => setEditando(null)}>Cancelar</Btn>
          <Btn variant="primary" disabled={!formValido || guardar.isPending} onClick={() => guardar.mutate()}>
            {guardar.isPending ? 'Guardando y verificando...' : 'Guardar'}
          </Btn>
        </div>
        {editando?.comercio && <p style={{ fontSize: 10, color: 'rgba(var(--adm-fg-rgb),.35)', marginBottom: 0 }}>Última actualización: {fmtDate(editando.comercio.actualizado)}</p>}
      </Modal>
    </>
  );
}
