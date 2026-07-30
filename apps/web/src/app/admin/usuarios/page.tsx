'use client';
import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { adminApi } from '@/lib/api';
import { Panel, PanelHeader, Table, TR, TD, StatusBadge, KycBadge, Avatar, Btn, Modal, Input, fmt, fmtDate } from '@/components/admin/ui';
import toast from 'react-hot-toast';

export default function UsuariosPage() {
  const qc = useQueryClient();
  const [search, setSearch]   = useState('');
  const [selected, setSelected] = useState<any>(null);
  const [showNew, setShowNew]   = useState(false);
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

  const deleteMut = useMutation({
    mutationFn: (id: string) => adminApi.deleteUser(id),
    onSuccess: () => { qc.invalidateQueries({ queryKey:['admin-users'] }); toast.success('Usuario eliminado'); setShowDel(null); },
    onError: (e:any) => toast.error(e.response?.data?.mensaje || 'Error'),
  });

  return (
    <div>
      <Panel>
        <PanelHeader
          title={`${users.length} usuarios registrados`} icon="◉"
          actions={
            <>
              <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Buscar usuario..."
                style={{ background:'rgba(30,12,65,.6)', border:'1px solid rgba(133,46,199,.2)', borderRadius:8, padding:'6px 12px', fontSize:12, color:'#fff', outline:'none', width:200 }} />
              <Btn variant="ghost">⬇ Exportar CSV</Btn>
              <Btn variant="primary" onClick={() => setShowNew(true)}>+ Nuevo usuario</Btn>
            </>
          }
        />
        <Table headers={['Usuario','Cédula','Rol','Saldo','KYC','Transacciones','Estado','Acciones']}>
          {isLoading ? (
            <TR><TD style={{ textAlign:'center', padding:32, color:'rgba(255,255,255,.3)' }} colSpan={8 as any}>Cargando...</TD></TR>
          ) : users.map((u:any) => (
            <TR key={u.id}>
              <TD>
                <div style={{ display:'flex', alignItems:'center', gap:10 }}>
                  <Avatar name={u.nombre||'?'} size={34} />
                  <div>
                    <div style={{ fontSize:13, fontWeight:600, color:'#fff' }}>{u.nombre}</div>
                    <div style={{ fontSize:11, color:'#AE93AA' }}>{u.correo}</div>
                  </div>
                </div>
              </TD>
              <TD style={{ fontFamily:'monospace', fontSize:12 }}>{u.cedula}</TD>
              <TD>
                <span style={{ background: u.rol==='admin'?'rgba(133,46,199,.2)':'rgba(174,147,170,.1)', color: u.rol==='admin'?'#c088f0':'#AE93AA', padding:'3px 10px', borderRadius:20, fontSize:11, fontWeight:600 }}>
                  {u.rol==='admin'?'Admin':'Usuario'}
                </span>
              </TD>
              <TD style={{ fontWeight:700, color:'#6CC998' }}>{fmt(u.saldo||0)}</TD>
              <TD><KycBadge nivel={u.kycNivel||u.kyc_nivel||1} /></TD>
              <TD style={{ color:'rgba(255,255,255,.6)' }}>{u._txCount||0}</TD>
              <TD><StatusBadge status={u.bloqueado?'bloqueado':'activo'} /></TD>
              <TD>
                <div style={{ display:'flex', gap:6 }}>
                  <Btn variant="ghost" onClick={() => setSelected(u)} style={{ padding:'5px 8px' }}>👁</Btn>
                  <Btn variant="ghost" onClick={() => setShowEdit({...u})} style={{ padding:'5px 8px' }}>✏</Btn>
                  <Btn variant="ghost" onClick={() => updateMut.mutate({ id:u.id, data:{ bloqueado: !u.bloqueado } })} style={{ padding:'5px 8px' }}>🔒</Btn>
                  <Btn variant="danger" onClick={() => setShowDel(u)} style={{ padding:'5px 8px' }}>🗑</Btn>
                </div>
              </TD>
            </TR>
          ))}
        </Table>
      </Panel>

      {/* View modal */}
      <Modal open={!!selected} onClose={() => setSelected(null)} title="Detalle de usuario">
        {selected && (
          <div>
            <div style={{ display:'flex', alignItems:'center', gap:12, marginBottom:20, padding:14, background:'rgba(30,12,65,.5)', borderRadius:12 }}>
              <Avatar name={selected.nombre||'?'} size={48} />
              <div>
                <div style={{ fontSize:16, fontWeight:700, color:'#fff' }}>{selected.nombre}</div>
                <div style={{ fontSize:12, color:'#AE93AA' }}>{selected.correo}</div>
                <div style={{ fontSize:11, color:'#AE93AA', marginTop:2 }}>CC {selected.cedula}</div>
              </div>
            </div>
            {[['Celular', selected.celular||'—'],['Ciudad', selected.ciudad||'—'],['Saldo', fmt(selected.saldo||0)],['Código referido', selected.codigoReferido||selected.codigo_referido||'—'],['Último login', fmtDate(selected.ultimoLogin||selected.ultimo_login)]].map(([l,v]) => (
              <div key={l} style={{ display:'flex', justifyContent:'space-between', padding:'8px 0', borderBottom:'1px solid rgba(255,255,255,.06)', fontSize:13 }}>
                <span style={{ color:'#AE93AA' }}>{l}</span>
                <span style={{ color:'#fff', fontWeight:600 }}>{v}</span>
              </div>
            ))}
          </div>
        )}
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
            <div style={{ fontSize:40, marginBottom:12 }}>⚠️</div>
            <div style={{ fontSize:14, color:'rgba(255,255,255,.8)', marginBottom:20 }}>
              Estás por eliminar a <strong style={{ color:'#fff' }}>{showDel.nombre}</strong>. Esta acción no se puede deshacer.
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
