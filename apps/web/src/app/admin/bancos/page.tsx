'use client';
import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import toast from 'react-hot-toast';
import { adminApi } from '@/lib/api';
import { Panel, PanelHeader, Table, TR, TD, Btn, Modal, Input } from '@/components/admin/ui';
import { Landmark, Pencil, Power } from 'lucide-react';

function BankLogo({ id, nombre }: { id: string; nombre: string }) {
  const [attempt, setAttempt] = useState(0);
  const exts = ['png', 'jpg'];
  if (attempt >= exts.length) {
    return (
      <div style={{ width:36, height:36, borderRadius:10, background:'linear-gradient(135deg,#852EC7,#321168)', color:'#fff', fontWeight:900, fontSize:13, display:'flex', alignItems:'center', justifyContent:'center', flexShrink:0 }}>
        {nombre.slice(0, 2).toUpperCase()}
      </div>
    );
  }
  return (
    <img
      src={`/bancos/${id}.${exts[attempt]}`}
      alt={nombre}
      width={36}
      height={36}
      style={{ borderRadius:10, objectFit:'cover', flexShrink:0 }}
      onError={() => setAttempt((a) => a + 1)}
    />
  );
}

export default function BancosPage() {
  const qc = useQueryClient();
  const [showNew, setShowNew] = useState(false);
  const [showEdit, setShowEdit] = useState<any>(null);
  const [form, setForm] = useState({ nombre: '', orden: '99', nuevo: false });

  const { data, isLoading } = useQuery({
    queryKey: ['admin-banks'],
    queryFn: () => adminApi.banks(),
    select: (d) => d.data,
  });
  const bancos: any[] = data?.bancos || [];

  const createMut = useMutation({
    mutationFn: (data: any) => adminApi.createBank(data),
    onSuccess: () => { qc.invalidateQueries({ queryKey:['admin-banks'] }); toast.success('Banco creado'); setShowNew(false); setForm({ nombre:'', orden:'99', nuevo:false }); },
    onError: (e: any) => toast.error(e.response?.data?.mensaje || 'Error creando el banco'),
  });

  const updateMut = useMutation({
    mutationFn: ({ id, data }: any) => adminApi.updateBank(id, data),
    onSuccess: () => { qc.invalidateQueries({ queryKey:['admin-banks'] }); toast.success('Banco actualizado'); setShowEdit(null); },
    onError: (e: any) => toast.error(e.response?.data?.mensaje || 'Error actualizando el banco'),
  });

  let rows: React.ReactNode;
  if (isLoading) {
    rows = <TR><TD style={{ textAlign:'center', padding:32, color:'rgba(var(--adm-fg-rgb),.3)' }} colSpan={5 as any}>Cargando...</TD></TR>;
  } else if (bancos.length === 0) {
    rows = <TR><TD style={{ textAlign:'center', padding:32, color:'rgba(var(--adm-fg-rgb),.3)' }} colSpan={5 as any}>Sin bancos registrados</TD></TR>;
  } else {
    rows = bancos.map((b: any) => (
      <TR key={b.id}>
        <TD>
          <div style={{ display:'flex', alignItems:'center', gap:10 }}>
            <BankLogo id={b.id} nombre={b.nombre} />
            <div>
              <div style={{ fontSize:13, fontWeight:600, color:'var(--adm-text)' }}>{b.nombre}</div>
              <div style={{ fontSize:10, color:'rgba(var(--adm-fg-rgb),.35)', fontFamily:'monospace' }}>{b.id}</div>
            </div>
          </div>
        </TD>
        <TD style={{ color:'rgba(var(--adm-fg-rgb),.6)' }}>{b.orden}</TD>
        <TD>
          {b.nuevo && <span style={{ fontSize:10, fontWeight:700, color:'#fff', background:'#5d1ca9', borderRadius:5, padding:'2px 8px' }}>Nuevo</span>}
        </TD>
        <TD>
          <span style={{ background: b.habilitado ? 'rgba(108,201,152,.15)' : 'rgba(192,57,43,.15)', color: b.habilitado ? '#6CC998' : '#C0392B', padding:'3px 10px', borderRadius:20, fontSize:11, fontWeight:600 }}>
            {b.habilitado ? 'Habilitado' : 'Deshabilitado'}
          </span>
        </TD>
        <TD>
          <div style={{ display:'flex', gap:6 }}>
            <Btn variant="ghost" style={{ padding:'5px 8px' }} onClick={() => { setShowEdit(b); setForm({ nombre:b.nombre, orden:String(b.orden), nuevo:b.nuevo }); }}><Pencil size={14} /></Btn>
            <Btn
              variant={b.habilitado ? 'danger' : 'default'}
              style={{ padding:'5px 8px' }}
              disabled={updateMut.isPending}
              onClick={() => updateMut.mutate({ id:b.id, data:{ habilitado: !b.habilitado } })}
            >
              <Power size={14} />
            </Btn>
          </div>
        </TD>
      </TR>
    ));
  }

  return (
    <div>
      <Panel>
        <PanelHeader
          title={`${bancos.length} bancos`} icon={<Landmark size={16} />}
          actions={<Btn variant="primary" onClick={() => setShowNew(true)}>+ Nuevo banco</Btn>}
        />
        <Table headers={['Banco', 'Orden', 'Nuevo', 'Estado', 'Acciones']}>
          {rows}
        </Table>
      </Panel>

      {/* New bank modal */}
      <Modal open={showNew} onClose={() => setShowNew(false)} title="Nuevo banco">
        <Input label="Nombre" value={form.nombre} onChange={(e) => setForm((f) => ({ ...f, nombre: e.target.value }))} placeholder="Ej. Banco Agrario" />
        <Input label="Orden (menor = aparece primero)" type="number" value={form.orden} onChange={(e) => setForm((f) => ({ ...f, orden: e.target.value }))} />
        <label style={{ display:'flex', alignItems:'center', gap:8, width:'100%', fontSize:13, color:'rgba(var(--adm-fg-rgb),.8)', margin:'6px 0 16px', cursor:'pointer', whiteSpace:'nowrap' }}>
          <input type="checkbox" checked={form.nuevo} onChange={(e) => setForm((f) => ({ ...f, nuevo: e.target.checked }))} />
          <span>Marcar como "Nuevo"</span>
        </label>
        <div style={{ fontSize:11, color:'rgba(var(--adm-fg-rgb),.35)', marginBottom:16 }}>
          El logo se toma de <code style={{ fontFamily:'monospace' }}>/bancos/&lt;id&gt;.png</code> según el nombre — si no existe, se muestran las iniciales.
        </div>
        <Btn variant="primary" style={{ width:'100%', justifyContent:'center' }} disabled={!form.nombre.trim() || createMut.isPending}
          onClick={() => createMut.mutate({ nombre: form.nombre, orden: form.orden, nuevo: form.nuevo })}>
          Crear banco
        </Btn>
      </Modal>

      {/* Edit bank modal */}
      <Modal open={!!showEdit} onClose={() => setShowEdit(null)} title="Editar banco">
        {showEdit && (
          <>
            <Input label="Nombre" value={form.nombre} onChange={(e) => setForm((f) => ({ ...f, nombre: e.target.value }))} />
            <Input label="Orden" type="number" value={form.orden} onChange={(e) => setForm((f) => ({ ...f, orden: e.target.value }))} />
            <label style={{ display:'flex', alignItems:'center', gap:8, width:'100%', fontSize:13, color:'rgba(var(--adm-fg-rgb),.8)', margin:'6px 0 16px', cursor:'pointer', whiteSpace:'nowrap' }}>
              <input type="checkbox" checked={form.nuevo} onChange={(e) => setForm((f) => ({ ...f, nuevo: e.target.checked }))} />
              <span>Marcar como "Nuevo"</span>
            </label>
            <Btn variant="primary" style={{ width:'100%', justifyContent:'center' }} disabled={!form.nombre.trim() || updateMut.isPending}
              onClick={() => updateMut.mutate({ id: showEdit.id, data: { nombre: form.nombre, orden: form.orden, nuevo: form.nuevo } })}>
              Guardar cambios
            </Btn>
          </>
        )}
      </Modal>
    </div>
  );
}
