'use client';
import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { adminApi } from '@/lib/api';
import { Panel, PanelHeader, Table, Tr, Td, StatusBadge, KycBadge, Avatar, Btn, Modal, Input, Select, fmt, fmtDate } from '@/components/admin/ui';
import toast from 'react-hot-toast';
import { Users, Download, Eye, Pencil, Lock, Trash2, AlertTriangle } from 'lucide-react';
import { downloadCsv } from '@/lib/exportCsv';

export default function UsuariosPage() {
  const qc = useQueryClient();
  const [search, setSearch]   = useState('');
  const [selected, setSelected] = useState<any>(null);
  const [showNew, setShowNew]   = useState(false);
  const [newUser, setNewUser]   = useState({ nombre:'', cedula:'', correo:'', celular:'', ciudad:'', pin:'', rol:'usuario' });
  const [showEdit, setShowEdit] = useState<any>(null);
  const [showDel, setShowDel]   = useState<any>(null);

  const { data, isLoading } = useQuery({
    queryKey: ['admin-users'],
    queryFn: () => adminApi.users({ limit: 200 }),
    select: d => d.data,
  });

  const users: any[] = (data?.usuarios || []).filter((u:any) => {
    if (!search) return true;
    const q = search.toLowerCase();
    return u.nombre?.toLowerCase().includes(q) || u.cedula?.includes(q) || u.correo?.toLowerCase().includes(q);
  });

  const updateMut = useMutation({
    mutationFn: ({ id, data }: any) => adminApi.updateUser(id, data),
    onSuccess: () => { qc.invalidateQueries({ queryKey:['admin-users'] }); toast.success('Usuario actualizado'); setShowEdit(null); },
    onError: (e:any) => toast.error(e.response?.data?.mensaje || 'Error'),
  });

  function exportarCsv() {
    downloadCsv('usuarios', ['Nombre', 'Correo', 'Cédula', 'Rol', 'Saldo', 'KYC', 'Transacciones', 'Estado'],
      users.map((u: any) => [u.nombre, u.correo, u.cedula, u.rol === 'admin' ? 'Admin' : 'Usuario', u.saldo || 0, u.kycNivel || u.kyc_nivel || 1, u._txCount || 0, u.bloqueado ? 'Bloqueado' : 'Activo']));
  }

  const deleteMut = useMutation({
    mutationFn: (id: string) => adminApi.deleteUser(id),
    onSuccess: () => { qc.invalidateQueries({ queryKey:['admin-users'] }); toast.success('Usuario eliminado'); setShowDel(null); },
    onError: (e:any) => toast.error(e.response?.data?.mensaje || 'Error'),
  });

  const createMut = useMutation({
    mutationFn: (data: any) => adminApi.createUser(data),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey:['admin-users'] });
      toast.success('Usuario creado');
      setShowNew(false);
      setNewUser({ nombre:'', cedula:'', correo:'', celular:'', ciudad:'', pin:'', rol:'usuario' });
    },
    onError: (e:any) => toast.error(e.response?.data?.mensaje || 'Error creando el usuario'),
  });

  function submitNewUser() {
    if (!newUser.nombre.trim() || newUser.cedula.length < 6 || !newUser.correo.trim() || !/^\d{4}$/.test(newUser.pin)) {
      toast.error('Completa nombre, cédula, correo y un PIN de 4 dígitos');
      return;
    }
    createMut.mutate(newUser);
  }

  return (
    <div>
      <Panel>
        <PanelHeader
          title={`${users.length} usuarios registrados`} icon={<Users size={16} />}
          actions={
            <>
              <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Buscar usuario..."
                style={{ background:'rgba(var(--adm-card-rgb),.6)', border:'1px solid rgba(133,46,199,.2)', borderRadius:8, padding:'6px 12px', fontSize:12, color:'var(--adm-text)', outline:'none', width:200 }} />
              <Btn variant="ghost" onClick={exportarCsv}><Download size={13} /> Exportar CSV</Btn>
              <Btn variant="primary" onClick={() => setShowNew(true)}>+ Nuevo usuario</Btn>
            </>
          }
        />
        <Table headers={['Usuario','Cédula','Rol','Saldo','KYC','Transacciones','Estado','Acciones']}>
          {isLoading ? (
            <Tr><Td style={{ textAlign:'center', padding:32, color:'rgba(var(--adm-fg-rgb),.3)' }} colSpan={8 as any}>Cargando...</Td></Tr>
          ) : users.map((u:any) => (
            <Tr key={u.id}>
              <Td>
                <div style={{ display:'flex', alignItems:'center', gap:10 }}>
                  <Avatar name={u.nombre||'?'} size={34} />
                  <div>
                    <div style={{ fontSize:13, fontWeight:600, color:'var(--adm-text)' }}>{u.nombre}</div>
                    <div style={{ fontSize:11, color:'var(--adm-muted)' }}>{u.correo}</div>
                  </div>
                </div>
              </Td>
              <Td style={{ fontFamily:'monospace', fontSize:12 }}>{u.cedula}</Td>
              <Td>
                <span style={{ background: u.rol==='admin'?'rgba(133,46,199,.2)':'rgba(var(--adm-muted-rgb),.1)', color: u.rol==='admin'?'#c088f0':'var(--adm-muted)', padding:'3px 10px', borderRadius:20, fontSize:11, fontWeight:600 }}>
                  {u.rol==='admin'?'Admin':'Usuario'}
                </span>
              </Td>
              <Td style={{ fontWeight:700, color:'#6CC998' }}>{fmt(u.saldo||0)}</Td>
              <Td><KycBadge nivel={u.kycNivel||u.kyc_nivel||1} /></Td>
              <Td style={{ color:'rgba(var(--adm-fg-rgb),.6)' }}>{u._txCount||0}</Td>
              <Td><StatusBadge status={u.bloqueado?'bloqueado':'activo'} /></Td>
              <Td>
                <div style={{ display:'flex', gap:6 }}>
                  <Btn variant="ghost" onClick={() => setSelected(u)} style={{ padding:'5px 8px' }}><Eye size={14} /></Btn>
                  <Btn variant="ghost" onClick={() => setShowEdit({...u})} style={{ padding:'5px 8px' }}><Pencil size={14} /></Btn>
                  <Btn variant="ghost" onClick={() => updateMut.mutate({ id:u.id, data:{ bloqueado: !u.bloqueado } })} style={{ padding:'5px 8px' }}><Lock size={14} /></Btn>
                  <Btn variant="danger" onClick={() => setShowDel(u)} style={{ padding:'5px 8px' }}><Trash2 size={14} /></Btn>
                </div>
              </Td>
            </Tr>
          ))}
        </Table>
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
            {[['Celular', selected.celular||'—'],['Ciudad', selected.ciudad||'—'],['Saldo', fmt(selected.saldo||0)],['Código referido', selected.codigoReferido||selected.codigo_referido||'—'],['Último login', fmtDate(selected.ultimoLogin||selected.ultimo_login)]].map(([l,v]) => (
              <div key={l} style={{ display:'flex', justifyContent:'space-between', padding:'8px 0', borderBottom:'1px solid rgba(var(--adm-fg-rgb),.06)', fontSize:13 }}>
                <span style={{ color:'var(--adm-muted)' }}>{l}</span>
                <span style={{ color:'var(--adm-text)', fontWeight:600 }}>{v}</span>
              </div>
            ))}
          </div>
        )}
      </Modal>

      {/* New user modal */}
      <Modal open={showNew} onClose={() => setShowNew(false)} title="Nuevo usuario">
        <div>
          <Input label="Nombre completo" value={newUser.nombre} onChange={e => setNewUser(p => ({...p, nombre:e.target.value}))} />
          <Input label="Cédula" value={newUser.cedula} onChange={e => setNewUser(p => ({...p, cedula:e.target.value.replaceAll(/\D/g,'')}))} />
          <Input label="Correo" type="email" value={newUser.correo} onChange={e => setNewUser(p => ({...p, correo:e.target.value}))} />
          <Input label="Celular (opcional)" value={newUser.celular} onChange={e => setNewUser(p => ({...p, celular:e.target.value.replaceAll(/\D/g,'')}))} />
          <Input label="Ciudad (opcional)" value={newUser.ciudad} onChange={e => setNewUser(p => ({...p, ciudad:e.target.value}))} />
          <Input label="PIN de 4 dígitos" type="password" maxLength={4} value={newUser.pin} onChange={e => setNewUser(p => ({...p, pin:e.target.value.replaceAll(/\D/g,'').slice(0,4)}))} />
          <Select label="Rol" value={newUser.rol} onChange={e => setNewUser(p => ({...p, rol:e.target.value}))}>
            <option value="usuario">Usuario</option>
            <option value="admin">Admin</option>
          </Select>
          <Btn variant="primary" style={{ width:'100%', justifyContent:'center', marginTop:8 }} disabled={createMut.isPending} onClick={submitNewUser}>
            {createMut.isPending ? 'Creando...' : 'Crear usuario'}
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
            <Btn variant="primary" style={{ width:'100%', justifyContent:'center', marginTop:8 }}
              onClick={() => updateMut.mutate({ id:showEdit.id, data:{ nombre:showEdit.nombre, correo:showEdit.correo, celular:showEdit.celular, ciudad:showEdit.ciudad, ...(showEdit.nuevo_pin?{nuevo_pin:showEdit.nuevo_pin}:{}) }})}>
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
              Estás por eliminar a <strong style={{ color:'var(--adm-text)' }}>{showDel.nombre}</strong>. Esta acción no se puede deshacer.
            </div>
            <div style={{ display:'flex', gap:10 }}>
              <Btn variant="ghost" style={{ flex:1, justifyContent:'center' }} onClick={() => setShowDel(null)}>Cancelar</Btn>
              <Btn variant="danger" style={{ flex:1, justifyContent:'center' }} onClick={() => deleteMut.mutate(showDel.id)}>Eliminar</Btn>
            </div>
          </div>
        )}
      </Modal>
    </div>
  );
}
