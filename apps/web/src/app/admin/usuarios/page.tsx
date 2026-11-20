'use client';
import { useEffect, useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { adminApi } from '@/lib/api';
import { Panel, PanelHeader, Table, Tr, Td, StatusBadge, KycBadge, Avatar, Btn, Modal, Input, Select, fmt, fmtDate } from '@/components/admin/ui';
import toast from 'react-hot-toast';
import { Users, Download, Eye, Pencil, Lock, Trash2, Undo2, AlertTriangle, ChevronDown, ChevronRight, Search } from 'lucide-react';
import { downloadCsv } from '@/lib/exportCsv';

// Una empresa (cuenta padre) con sus sedes (cuentas hijo) debajo, y el estado de su Branch de Kushki.
interface Sede {
  id: string; userId: string; nombre: string; cedula: string; correo: string; celular?: string; ciudad?: string;
  rol: string; kycNivel: number; bloqueado: boolean; ultimoLogin?: string; puedeRecargar: boolean;
  eliminacionProgramadaAt?: string | null;
}
interface Cuenta extends Omit<Sede, 'puedeRecargar'> {
  saldo: number;
  subcuentas: Sede[];
  comercio: { activo: boolean; ambiente: string; publicTermina: string; actualizado: string } | null;
}

const LIMITE = 50;
const NUEVO = { nombre:'', cedula:'', correo:'', celular:'', ciudad:'', pin:'' };
type Empresa = { id: string; nombre: string };
const SIN_LLAVES = { publicMerchantId: '', privateMerchantId: '', ambiente: 'produccion', activo: true };
const LLAVE = /^[A-Za-z0-9]{20,64}$/;

function Etiqueta({ children, color }: Readonly<{ children: React.ReactNode; color: 'verde' | 'gris' | 'amarillo' }>) {
  const c = { verde: ['rgba(108,201,152,.15)', '#6CC998'], gris: ['rgba(var(--adm-fg-rgb),.08)', 'rgba(var(--adm-fg-rgb),.5)'], amarillo: ['rgba(212,160,23,.15)', '#d4a017'] }[color];
  return <span style={{ background: c[0], color: c[1], padding: '3px 10px', borderRadius: 20, fontSize: 11, fontWeight: 600, whiteSpace: 'nowrap' }}>{children}</span>;
}

// Busca empresas (cuentas padre de clientes) por nombre, cédula o correo y deja elegir una
function SelectorEmpresa({ value, onChange, excluir }: Readonly<{ value: Empresa | null; onChange: (e: Empresa | null) => void; excluir?: string }>) {
  const [texto, setTexto] = useState('');
  const [q, setQ] = useState('');
  useEffect(() => { const t = setTimeout(() => setQ(texto.trim()), 300); return () => clearTimeout(t); }, [texto]);
  const { data, isFetching } = useQuery({
    queryKey: ['empresas-selector', q],
    queryFn: () => adminApi.kushkiComercios({ q: q || undefined, page: 1, limit: 8 }),
    select: (d) => (d.data.cuentas as Cuenta[]).filter((c) => c.userId !== excluir),
    enabled: !value,
  });

  if (value) {
    return (
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8, padding: '10px 12px', borderRadius: 10, border: '1.5px solid rgba(133,46,199,.4)', background: 'rgba(133,46,199,.08)', fontSize: 13 }}>
        <strong>{value.nombre}</strong>
        <Btn variant="ghost" onClick={() => onChange(null)} style={{ padding: '3px 10px' }}>Cambiar</Btn>
      </div>
    );
  }
  return (
    <div>
      <input value={texto} onChange={(e) => setTexto(e.target.value)} placeholder="Buscar empresa por nombre, NIT o correo"
        style={{ width: '100%', background: 'rgba(var(--adm-card-rgb),.7)', border: '1.5px solid rgba(133,46,199,.25)', borderRadius: 10, padding: '10px 12px', fontSize: 13, color: 'var(--adm-text)', outline: 'none', boxSizing: 'border-box' }} />
      <div style={{ maxHeight: 170, overflowY: 'auto', marginTop: 6, borderRadius: 10, border: '1px solid rgba(var(--adm-fg-rgb),.08)' }}>
        {isFetching && !data && <div style={{ padding: 10, fontSize: 12, color: 'var(--adm-muted)' }}>Buscando...</div>}
        {data?.length === 0 && <div style={{ padding: 10, fontSize: 12, color: 'var(--adm-muted)' }}>No hay empresas con ese criterio</div>}
        {(data ?? []).map((c) => (
          <button key={c.userId} type="button" onClick={() => onChange({ id: c.userId, nombre: c.nombre })}
            style={{ all: 'unset', cursor: 'pointer', display: 'block', width: '100%', boxSizing: 'border-box', padding: '8px 12px', fontSize: 13, borderBottom: '1px solid rgba(var(--adm-fg-rgb),.05)' }}>
            <strong>{c.nombre}</strong>
            <div style={{ fontSize: 11, color: 'var(--adm-muted)' }}>CC {c.cedula} · {c.correo}</div>
          </button>
        ))}
      </div>
    </div>
  );
}

export default function UsuariosPage() {
  const qc = useQueryClient();
  const [busqueda, setBusqueda] = useState('');
  const [q, setQ]               = useState('');
  const [page, setPage]         = useState(1);
  const [abiertas, setAbiertas] = useState<Set<string>>(new Set());
  const [selected, setSelected] = useState<any>(null);
  const [showNew, setShowNew]   = useState(false);
  const [newUser, setNewUser]   = useState(NUEVO);
  const [esSedeNueva, setEsSedeNueva] = useState(false);
  const [empresaNueva, setEmpresaNueva] = useState<Empresa | null>(null);
  const [empresaEdit, setEmpresaEdit] = useState<Empresa | null>(null);
  const [showEdit, setShowEdit] = useState<any>(null);
  const [showDel, setShowDel]   = useState<any>(null);
  const [branchDe, setBranchDe] = useState<Cuenta | null>(null);
  const [llaves, setLlaves]     = useState(SIN_LLAVES);
  // Resultado de "Verificar" por empresa (solo para mostrarlo en la fila)
  const [verificados, setVerificados] = useState<Record<string, boolean>>({});

  // Espera a que se deje de escribir para no consultar en cada tecla
  useEffect(() => {
    const t = setTimeout(() => { setQ(busqueda.trim()); setPage(1); }, 350);
    return () => clearTimeout(t);
  }, [busqueda]);

  const { data, isLoading } = useQuery({
    queryKey: ['admin-users', q, page],
    queryFn: () => adminApi.kushkiComercios({ q: q || undefined, page, limit: LIMITE, todos: 1 }),
    select: d => d.data as { total: number; configurados: number; cuentas: Cuenta[] },
  });
  const cuentas = data?.cuentas ?? [];
  const totalSedes = cuentas.reduce((n, c) => n + c.subcuentas.length, 0);
  const paginas = Math.max(1, Math.ceil((data?.total ?? 0) / LIMITE));
  const refrescar = () => qc.invalidateQueries({ queryKey: ['admin-users'] });
  const alternar = (id: string) => setAbiertas((s) => { const n = new Set(s); if (n.has(id)) n.delete(id); else n.add(id); return n; });

  const updateMut = useMutation({
    mutationFn: ({ id, data }: any) => adminApi.updateUser(id, data),
    onSuccess: () => { refrescar(); toast.success('Usuario actualizado'); setShowEdit(null); },
    onError: (e:any) => toast.error(e.response?.data?.mensaje || 'Error'),
  });

  const deleteMut = useMutation({
    mutationFn: (id: string) => adminApi.deleteUser(id),
    onSuccess: ({ data: r }) => {
      refrescar();
      // Con saldo no se elimina al momento: queda un plazo de 7 días para que el cliente lo retire
      if (r.estado === 'programada') toast(r.mensaje, { duration: 9000 });
      else toast.success('Cuenta eliminada');
      setShowDel(null);
    },
    onError: (e:any) => toast.error(e.response?.data?.mensaje || 'Error'),
  });

  const cancelarEliminacion = useMutation({
    mutationFn: (id: string) => adminApi.cancelarEliminacion(id),
    onSuccess: () => { refrescar(); toast.success('Eliminación cancelada'); },
    onError: (e:any) => toast.error(e.response?.data?.mensaje || 'No se pudo cancelar'),
  });

  const createMut = useMutation({
    mutationFn: (d: any) => adminApi.createUser(d),
    onSuccess: ({ data: r }) => { refrescar(); toast.success(r.mensaje || 'Usuario creado'); cerrarNuevo(); },
    onError: (e:any) => toast.error(e.response?.data?.mensaje || 'Error creando el usuario'),
  });

  const guardarBranch = useMutation({
    mutationFn: () => adminApi.kushkiGuardarComercio(branchDe!.userId, llaves),
    onSuccess: ({ data: r }) => {
      if (!r.verificado) toast('Guardado, pero Kushki no respondió: no se pudo verificar la llave');
      else if (r.brebHabilitado) toast.success('Guardado. Bre-B (QR) está activo en este Branch');
      else toast('Guardado, pero este Branch todavía no tiene Bre-B activo en Kushki');
      setBranchDe(null);
      refrescar();
    },
    onError: (err: any) => toast.error(err.response?.data?.mensaje || 'No se pudo guardar'),
  });

  const verificarBranch = useMutation({
    mutationFn: (c: Cuenta) => adminApi.kushkiVerificarComercio(c.userId).then((r) => ({ c, r })),
    onSuccess: ({ c, r }) => {
      setVerificados((v) => ({ ...v, [c.userId]: r.data.brebHabilitado }));
      if (r.data.brebHabilitado) toast.success(`${c.nombre}: Bre-B (QR) activo`);
      else toast.error(`${c.nombre}: Kushki no devuelve Bre-B en este Branch`);
    },
    onError: (err: any) => toast.error(err.response?.data?.mensaje || 'No se pudo consultar a Kushki'),
  });

  const quitarBranch = useMutation({
    mutationFn: (c: Cuenta) => adminApi.kushkiQuitarComercio(c.userId),
    onSuccess: () => { toast.success('Branch quitado'); refrescar(); },
    onError: (err: any) => toast.error(err.response?.data?.mensaje || 'No se pudo quitar'),
  });

  // Exporta lo que coincide con la búsqueda (empresas y sedes), hasta 200 empresas
  async function exportarCsv() {
    try {
      const { data: todo } = await adminApi.kushkiComercios({ q: q || undefined, page: 1, limit: 200, todos: 1 });
      const filas: (string | number)[][] = [];
      for (const c of todo.cuentas as Cuenta[]) {
        const fila = (u: Cuenta | Sede, empresa: string, saldo: number | string) =>
          [u.nombre, u.correo, u.cedula, u.rol === 'admin' ? 'Admin' : empresa ? 'Sede' : 'Usuario', empresa, saldo, u.kycNivel || 1, u.bloqueado ? 'Bloqueado' : 'Activo'];
        filas.push(fila(c, '', c.saldo || 0));
        c.subcuentas.forEach((s) => filas.push(fila(s, c.nombre, '')));
      }
      downloadCsv('usuarios', ['Nombre', 'Correo', 'Cédula', 'Tipo', 'Empresa', 'Saldo', 'KYC', 'Estado'], filas);
    } catch { toast.error('No se pudo exportar'); }
  }

  function abrirNuevo(empresa?: Empresa) {
    setNewUser(NUEVO);
    setEsSedeNueva(!!empresa); setEmpresaNueva(empresa ?? null);
    setShowNew(true);
  }
  function cerrarNuevo() { setShowNew(false); setNewUser(NUEVO); setEsSedeNueva(false); setEmpresaNueva(null); }

  function submitNewUser() {
    if (!newUser.nombre.trim() || newUser.cedula.length < 6 || !newUser.correo.trim() || !/^\d{4}$/.test(newUser.pin)) {
      toast.error('Completa nombre, cédula, correo y un PIN de 4 dígitos');
      return;
    }
    if (esSedeNueva && !empresaNueva) { toast.error('Elige la empresa a la que pertenece la sede'); return; }
    createMut.mutate(esSedeNueva ? { ...newUser, cuentaPadreId: empresaNueva!.id } : newUser);
  }

  function abrirBranch(c: Cuenta) {
    setLlaves({ ...SIN_LLAVES, activo: c.comercio?.activo ?? true });
    setBranchDe(c);
  }

  const acciones = (u: Cuenta | Sede, empresa?: Cuenta) => (
    <div style={{ display:'flex', gap:6 }}>
      <Btn variant="ghost" title="Ver detalle" onClick={() => setSelected(u)} style={{ padding:'5px 8px' }}><Eye size={14} /></Btn>
      <Btn variant="ghost" title="Editar" onClick={() => { setShowEdit({...u, esSede: !!empresa}); setEmpresaEdit(empresa ? { id: empresa.id, nombre: empresa.nombre } : null); }} style={{ padding:'5px 8px' }}><Pencil size={14} /></Btn>
      <Btn variant="ghost" title={u.bloqueado ? 'Desbloquear' : 'Bloquear'} onClick={() => updateMut.mutate({ id:u.id, data:{ bloqueado: !u.bloqueado } })} style={{ padding:'5px 8px' }}><Lock size={14} /></Btn>
      {u.eliminacionProgramadaAt ? (
        <>
          <Etiqueta color="amarillo">Se elimina el {new Date(u.eliminacionProgramadaAt).toLocaleDateString('es-CO', { day: 'numeric', month: 'short' })}</Etiqueta>
          <Btn variant="ghost" title="Cancelar la eliminación" onClick={() => cancelarEliminacion.mutate(u.id)} style={{ padding:'5px 8px' }}><Undo2 size={14} /></Btn>
        </>
      ) : (
        <Btn variant="danger" title="Eliminar" onClick={() => setShowDel(u)} style={{ padding:'5px 8px' }}><Trash2 size={14} /></Btn>
      )}
    </div>
  );

  const celdaKushki = (c: Cuenta) => {
    if (c.rol === 'admin') return <span style={{ fontSize: 11, color: 'rgba(var(--adm-fg-rgb),.3)' }}>—</span>;
    const v = verificados[c.userId];
    return (
      <div style={{ display: 'grid', gap: 6, justifyItems: 'start' }}>
        <div style={{ display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap' }}>
          {c.comercio
            ? <Etiqueta color={c.comercio.activo ? 'verde' : 'amarillo'}>{c.comercio.activo ? 'Branch activo' : 'Desactivado'}</Etiqueta>
            : <Etiqueta color="gris">Sin Branch</Etiqueta>}
          {v !== undefined && <Etiqueta color={v ? 'verde' : 'amarillo'}>{v ? 'Bre-B activo' : 'Sin Bre-B'}</Etiqueta>}
        </div>
        {c.comercio && (
          <span style={{ fontSize: 10, fontFamily: 'monospace', color: 'rgba(var(--adm-fg-rgb),.45)' }}>
            Public Key {c.comercio.publicTermina}
          </span>
        )}
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
          <Btn variant="default" onClick={() => abrirBranch(c)} style={{ padding: '4px 10px' }}>{c.comercio ? 'Cambiar llaves' : 'Asignar Branch'}</Btn>
          {c.comercio && (
            <>
              <Btn variant="ghost" disabled={verificarBranch.isPending} onClick={() => verificarBranch.mutate(c)} style={{ padding: '4px 10px' }}
                title="Pregunta a Kushki qué métodos tiene activos este Branch">Verificar</Btn>
              <Btn variant="danger" disabled={quitarBranch.isPending} style={{ padding: '4px 10px' }}
                onClick={() => { if (window.confirm(`¿Quitar el Branch de ${c.nombre}? Sus clientes dejarán de ver Bre-B.`)) quitarBranch.mutate(c); }}>Quitar</Btn>
            </>
          )}
        </div>
      </div>
    );
  };

  let filas: React.ReactNode;
  if (isLoading) {
    filas = <Tr><Td style={{ textAlign:'center', padding:32, color:'rgba(var(--adm-fg-rgb),.3)' }} colSpan={7}>Cargando...</Td></Tr>;
  } else if (cuentas.length === 0) {
    filas = <Tr><Td style={{ textAlign:'center', padding:32, color:'rgba(var(--adm-fg-rgb),.3)' }} colSpan={7}>No hay cuentas con ese criterio</Td></Tr>;
  } else {
    filas = cuentas.flatMap((c) => {
      const abierta = abiertas.has(c.userId) || (q !== '' && c.subcuentas.length > 0);
      const conSedes = c.subcuentas.length > 0;
      const fila = (
        <Tr key={c.userId}>
          <Td>
            <div style={{ display:'flex', alignItems:'center', gap:8 }}>
              <button type="button" onClick={() => conSedes && alternar(c.userId)} aria-expanded={abierta} disabled={!conSedes}
                title={conSedes ? (abierta ? 'Ocultar sedes' : 'Ver sedes') : 'Sin sedes'}
                style={{ all:'unset', cursor: conSedes ? 'pointer' : 'default', color:'#c088f0', opacity: conSedes ? 1 : .2, width:14, display:'flex' }}>
                {abierta ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
              </button>
              <Avatar name={c.nombre||'?'} size={34} />
              <div>
                <div style={{ fontSize:13, fontWeight:600, color:'var(--adm-text)' }}>{c.nombre}</div>
                <div style={{ fontSize:11, color:'var(--adm-muted)' }}>
                  {c.correo}{conSedes ? ` · ${c.subcuentas.length} ${c.subcuentas.length === 1 ? 'sede' : 'sedes'}` : ''}
                </div>
              </div>
            </div>
          </Td>
          <Td style={{ fontFamily:'monospace', fontSize:12 }}>{c.cedula}</Td>
          <Td style={{ fontWeight:700, color:'#6CC998' }}>{fmt(c.saldo||0)}</Td>
          <Td><KycBadge nivel={c.kycNivel||1} /></Td>
          <Td><StatusBadge status={c.bloqueado?'bloqueado':'activo'} /></Td>
          <Td>{celdaKushki(c)}</Td>
          <Td>
            <div style={{ display:'grid', gap:6 }}>
              {acciones(c)}
              {c.rol !== 'admin' && <Btn variant="default" onClick={() => abrirNuevo({ id: c.userId, nombre: c.nombre })} style={{ padding:'4px 10px', justifyContent:'center' }} title={`Crear una sede dentro de ${c.nombre}`}>+ Sede</Btn>}
            </div>
          </Td>
        </Tr>
      );
      if (!abierta) return [fila];
      const fondo = { background: 'rgba(133,46,199,.04)' };
      return [fila, ...c.subcuentas.map((s) => (
        <Tr key={s.userId}>
          <Td style={{ ...fondo, paddingLeft: 40 }}>
            <div style={{ display:'flex', alignItems:'center', gap:8 }}>
              <span style={{ color:'rgba(var(--adm-fg-rgb),.35)' }}>↳</span>
              <Avatar name={s.nombre||'?'} size={28} />
              <div>
                <div style={{ fontSize:12, fontWeight:600, color:'var(--adm-text)' }}>{s.nombre}</div>
                <div style={{ fontSize:10, color:'var(--adm-muted)' }}>Sede · {s.correo}</div>
              </div>
            </div>
          </Td>
          <Td style={{ ...fondo, fontFamily:'monospace', fontSize:12 }}>{s.cedula}</Td>
          <Td style={{ ...fondo, fontSize:11, color:'rgba(var(--adm-fg-rgb),.45)' }}>Saldo de la empresa</Td>
          <Td style={fondo}><KycBadge nivel={s.kycNivel||1} /></Td>
          <Td style={fondo}><StatusBadge status={s.bloqueado?'bloqueado':'activo'} /></Td>
          <Td style={fondo}>
            {s.puedeRecargar
              ? <span style={{ fontSize: 11, color: 'rgba(var(--adm-fg-rgb),.5)' }}>Usa el Branch de {c.nombre}</span>
              : <Etiqueta color="amarillo">Sin permiso de recargar</Etiqueta>}
          </Td>
          <Td style={fondo}>{acciones(s, c)}</Td>
        </Tr>
      ))];
    });
  }

  return (
    <div>
      <Panel>
        <PanelHeader
          title={`${data?.total ?? 0} cuentas${totalSedes ? ` · ${totalSedes} sedes en esta página` : ''}${data ? ` · ${data.configurados} con Branch de Kushki` : ''}`}
          icon={<Users size={16} />}
          actions={
            <>
              <div style={{ position:'relative' }}>
                <Search size={13} style={{ position:'absolute', left:10, top:9, color:'rgba(var(--adm-fg-rgb),.4)' }} />
                <input value={busqueda} onChange={e => setBusqueda(e.target.value)} placeholder="Buscar empresa, sede, cédula..."
                  style={{ background:'rgba(var(--adm-card-rgb),.6)', border:'1px solid rgba(133,46,199,.2)', borderRadius:8, padding:'6px 12px 6px 30px', fontSize:12, color:'var(--adm-text)', outline:'none', width:230 }} />
              </div>
              <Btn variant="ghost" onClick={exportarCsv}><Download size={13} /> Exportar CSV</Btn>
              <Btn variant="primary" onClick={() => abrirNuevo()}>+ Nuevo usuario</Btn>
            </>
          }
        />
        <div style={{ padding:'10px 16px', fontSize:12, color:'rgba(var(--adm-fg-rgb),.55)', lineHeight:1.6, borderBottom:'1px solid rgba(133,46,199,.12)' }}>
          Cada empresa (cuenta padre) muestra sus sedes al pulsar la flecha. El Branch de Kushki es de la empresa: el pago de un QR de Bre-B entra a su comercio y todas sus sedes lo usan.
        </div>
        <Table headers={['Empresa / usuario','Cédula','Saldo','KYC','Estado','Kushki (QR Bre-B)','Acciones']}>
          {filas}
        </Table>
        {paginas > 1 && (
          <div style={{ display:'flex', justifyContent:'center', alignItems:'center', gap:12, padding:14, fontSize:12 }}>
            <Btn variant="ghost" disabled={page <= 1} onClick={() => setPage((p) => p - 1)}>Anterior</Btn>
            <span>Página {page} de {paginas}</span>
            <Btn variant="ghost" disabled={page >= paginas} onClick={() => setPage((p) => p + 1)}>Siguiente</Btn>
          </div>
        )}
      </Panel>

      {/* View modal */}
      <Modal open={!!selected} onClose={() => setSelected(null)} title="Detalle de usuario">
        {selected && (
          <div>
            <div style={{ display:'flex', alignItems:'center', gap:12, marginBottom:20, padding:14, background:'rgba(var(--adm-card-rgb),.5)', borderRadius:12 }}>
              <Avatar name={selected.nombre||'?'} size={48} />
              <div>
                <div style={{ fontSize:16, fontWeight:700, color:'var(--adm-text)' }}>{selected.nombre}</div>
                <div style={{ fontSize:12, color:'var(--adm-muted)' }}>{selected.correo}</div>
                <div style={{ fontSize:11, color:'var(--adm-muted)', marginTop:2 }}>CC {selected.cedula}</div>
              </div>
            </div>
            {[['Celular', selected.celular||'—'],['Ciudad', selected.ciudad||'—'],['Saldo', selected.saldo === undefined ? 'Saldo de la empresa' : fmt(selected.saldo||0)],['Último login', selected.ultimoLogin ? fmtDate(selected.ultimoLogin) : '—']].map(([l,v]) => (
              <div key={l} style={{ display:'flex', justifyContent:'space-between', padding:'8px 0', borderBottom:'1px solid rgba(var(--adm-fg-rgb),.06)', fontSize:13 }}>
                <span style={{ color:'var(--adm-muted)' }}>{l}</span>
                <span style={{ color:'var(--adm-text)', fontWeight:600 }}>{v}</span>
              </div>
            ))}
          </div>
        )}
      </Modal>

      {/* New user modal */}
      <Modal open={showNew} onClose={cerrarNuevo} title={esSedeNueva ? 'Nueva sede' : 'Nuevo usuario'}>
        <div>
          <Input label="Nombre completo" value={newUser.nombre} onChange={e => setNewUser(p => ({...p, nombre:e.target.value}))} />
          <Input label="Cédula" value={newUser.cedula} onChange={e => setNewUser(p => ({...p, cedula:e.target.value.replaceAll(/\D/g,'')}))} />
          <Input label="Correo" type="email" value={newUser.correo} onChange={e => setNewUser(p => ({...p, correo:e.target.value}))} />
          <Input label="Celular (opcional)" value={newUser.celular} onChange={e => setNewUser(p => ({...p, celular:e.target.value.replaceAll(/\D/g,'')}))} />
          <Input label="Ciudad (opcional)" value={newUser.ciudad} onChange={e => setNewUser(p => ({...p, ciudad:e.target.value}))} />
          <Input label="PIN de 4 dígitos" type="password" maxLength={4} value={newUser.pin} onChange={e => setNewUser(p => ({...p, pin:e.target.value.replaceAll(/\D/g,'').slice(0,4)}))} />
          <Select label="Tipo de cuenta" value={esSedeNueva ? 'sede' : 'cuenta'} onChange={e => { setEsSedeNueva(e.target.value === 'sede'); if (e.target.value !== 'sede') setEmpresaNueva(null); }}>
            <option value="cuenta">Empresa o usuario (cuenta principal, con su propia billetera)</option>
            <option value="sede">Sede de una empresa (usa la billetera de la empresa)</option>
          </Select>
          {esSedeNueva && (
            <>
              <div style={{ fontSize:11, fontWeight:600, color:'var(--adm-muted)', textTransform:'uppercase', letterSpacing:'.5px', marginBottom:6 }}>Empresa a la que pertenece</div>
              <div style={{ marginBottom:14 }}><SelectorEmpresa value={empresaNueva} onChange={setEmpresaNueva} /></div>
              <p style={{ fontSize:12, color:'var(--adm-muted)', lineHeight:1.6, margin:'0 0 16px' }}>
                Todas las sedes tienen el mismo formato: <strong>no ven el saldo</strong>, solo <strong>recargan y cobran</strong> (QR y datáfono) y <strong>no envían ni retiran</strong>.
              </p>
            </>
          )}
          <Btn variant="primary" style={{ width:'100%', justifyContent:'center', marginTop:8 }} disabled={createMut.isPending} onClick={submitNewUser}>
            {createMut.isPending ? 'Creando...' : esSedeNueva ? 'Crear sede' : 'Crear usuario'}
          </Btn>
        </div>
      </Modal>

      {/* Edit modal */}
      <Modal open={!!showEdit} onClose={() => setShowEdit(null)} title="Editar usuario">
        {showEdit && (
          <div>
            <Input label="Nombre" value={showEdit.nombre||''} onChange={e => setShowEdit((p:any) => ({...p, nombre:e.target.value}))} />
            <Input label="Correo" value={showEdit.correo||''} onChange={e => setShowEdit((p:any) => ({...p, correo:e.target.value}))} />
            <Input label="Celular" value={showEdit.celular||''} onChange={e => setShowEdit((p:any) => ({...p, celular:e.target.value}))} />
            <Input label="Ciudad" value={showEdit.ciudad||''} onChange={e => setShowEdit((p:any) => ({...p, ciudad:e.target.value}))} />
            <Input label="Nuevo PIN (dejar vacío para no cambiar)" type="password" maxLength={4} placeholder="4 dígitos" onChange={e => setShowEdit((p:any) => ({...p, nuevo_pin:e.target.value}))} />
            {showEdit.esSede && (
              <>
                <div style={{ fontSize:11, fontWeight:600, color:'var(--adm-muted)', textTransform:'uppercase', letterSpacing:'.5px', marginBottom:6 }}>Empresa a la que pertenece esta sede</div>
                <div style={{ marginBottom:14 }}><SelectorEmpresa value={empresaEdit} onChange={setEmpresaEdit} excluir={showEdit.id} /></div>
              </>
            )}
            <Btn variant="primary" style={{ width:'100%', justifyContent:'center', marginTop:8 }}
              onClick={() => updateMut.mutate({ id:showEdit.id, data:{ nombre:showEdit.nombre, correo:showEdit.correo, celular:showEdit.celular, ciudad:showEdit.ciudad, ...(showEdit.nuevo_pin?{nuevo_pin:showEdit.nuevo_pin}:{}), ...(showEdit.esSede && empresaEdit ? { cuentaPadreId: empresaEdit.id } : {}) }})}>
              Guardar cambios
            </Btn>
          </div>
        )}
      </Modal>

      {/* Delete confirm modal */}
      <Modal open={!!showDel} onClose={() => setShowDel(null)} title="¿Eliminar usuario?">
        {showDel && (
          <div style={{ textAlign:'center' }}>
            <div style={{ display:'flex', justifyContent:'center', color:'#d4a017', marginBottom:12 }}><AlertTriangle size={40} /></div>
            <div style={{ fontSize:14, color:'rgba(var(--adm-fg-rgb),.8)', marginBottom:20 }}>
              Estás por eliminar a <strong style={{ color:'var(--adm-text)' }}>{showDel.nombre}</strong>. Se borrarán sus datos personales y saldrá del sistema; no se puede deshacer.
              <div style={{ marginTop:8, fontSize:13 }}>Si la cuenta tiene saldo, tendrá <strong>7 días</strong> para retirarlo (solo podrá retirar) y después se eliminará sola cuando el saldo llegue a cero.</div>
              {showDel.subcuentas?.length > 0 && <div style={{ marginTop:8, color:'#d4a017' }}>Esta empresa tiene {showDel.subcuentas.length} sede(s): elimínalas primero.</div>}
            </div>
            <div style={{ display:'flex', gap:10 }}>
              <Btn variant="ghost" style={{ flex:1, justifyContent:'center' }} onClick={() => setShowDel(null)}>Cancelar</Btn>
              <Btn variant="danger" style={{ flex:1, justifyContent:'center' }} onClick={() => deleteMut.mutate(showDel.id)}>Eliminar</Btn>
            </div>
          </div>
        )}
      </Modal>

      {/* Branch de Kushki de la empresa */}
      <Modal open={!!branchDe} onClose={() => setBranchDe(null)} title={branchDe ? `Branch de Kushki · ${branchDe.nombre}` : ''}>
        <p style={{ fontSize: 12, color: 'rgba(var(--adm-fg-rgb),.6)', lineHeight: 1.6, marginTop: 0 }}>
          Copia las llaves desde <strong>Credenciales</strong> del Branch de esta empresa en la consola de Kushki. Se guardan cifradas y no se vuelven a mostrar.
          {branchDe?.comercio && ' Al guardar se reemplazan las anteriores.'}
        </p>
        <Input label="Public Key" value={llaves.publicMerchantId} autoComplete="off" spellCheck={false}
          onChange={(e) => setLlaves((f) => ({ ...f, publicMerchantId: e.target.value }))} />
        <Input label="Private Key" type="password" value={llaves.privateMerchantId} autoComplete="new-password" spellCheck={false}
          onChange={(e) => setLlaves((f) => ({ ...f, privateMerchantId: e.target.value }))} />
        <label style={{ display: 'flex', alignItems: 'center', gap: 10, fontSize: 12, marginBottom: 16, cursor: 'pointer' }}>
          <input type="checkbox" checked={llaves.activo} onChange={(e) => setLlaves((f) => ({ ...f, activo: e.target.checked }))} />
          Activo (la empresa y sus sedes pueden generar QR)
        </label>
        <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end' }}>
          <Btn variant="ghost" onClick={() => setBranchDe(null)}>Cancelar</Btn>
          <Btn variant="primary" disabled={!LLAVE.test(llaves.publicMerchantId.trim()) || !LLAVE.test(llaves.privateMerchantId.trim()) || guardarBranch.isPending} onClick={() => guardarBranch.mutate()}>
            {guardarBranch.isPending ? 'Guardando y verificando...' : 'Guardar'}
          </Btn>
        </div>
      </Modal>
    </div>
  );
}
