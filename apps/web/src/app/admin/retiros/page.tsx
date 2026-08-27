'use client';
import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { adminApi } from '@/lib/api';
import { Panel, PanelHeader, Table, Tr, Td, StatusBadge, Btn, Modal, Input, fmt, fmtDate } from '@/components/admin/ui';
import toast from 'react-hot-toast';
import { Clock, CheckCircle2, Check, X, Download } from 'lucide-react';
import { downloadCsv } from '@/lib/exportCsv';

export default function RetirosPage() {
  const qc = useQueryClient();
  const [showReject, setShowReject] = useState<any>(null);
  const [motivo, setMotivo]         = useState('');

  const { data: pendData, isLoading: pendLoading } = useQuery({
    queryKey: ['admin-retiros-pend'],
    queryFn: () => adminApi.pending(),
    select: d => d.data,
    refetchInterval: 30000,
  });

  const { data: allData } = useQuery({
    queryKey: ['admin-retiros-all'],
    queryFn: () => adminApi.withdrawalsAll(),
    select: d => d.data,
  });

  const approveMut = useMutation({
    mutationFn: (id: string) => adminApi.approveWD(id),
    onSuccess: () => { qc.invalidateQueries({ queryKey:['admin-retiros-pend'] }); qc.invalidateQueries({ queryKey:['admin-retiros-all'] }); toast.success('Retiro aprobado'); },
    onError: (e:any) => toast.error(e.response?.data?.mensaje || 'Error'),
  });

  const rejectMut = useMutation({
    mutationFn: ({ id, motivo }:any) => adminApi.rejectWD(id, motivo),
    onSuccess: () => { qc.invalidateQueries({ queryKey:['admin-retiros-pend'] }); qc.invalidateQueries({ queryKey:['admin-retiros-all'] }); toast.success('Retiro rechazado · Saldo revertido'); setShowReject(null); setMotivo(''); },
    onError: (e:any) => toast.error(e.response?.data?.mensaje || 'Error'),
  });

  const pendientes: any[] = pendData?.retiros || [];
  const procesados: any[] = (allData?.retiros || []).filter((w: any) => w.status !== 'pendiente');

  function exportarCsv() {
    downloadCsv('retiros', ['Banco', 'Titular', 'Cuenta', 'Usuario', 'Monto', 'Estado', 'Fecha'],
      procesados.map((w: any) => [w.banco_nombre || '', w.nombre_titular || '', w.numero_cuenta_masked || '', w.usuario_nombre || '', w.monto || 0, w.status || '', fmtDate(w.created_at)]));
  }

  return (
    <div style={{ display:'flex', flexDirection:'column', gap:16 }}>

      {/* Pending queue */}
      <Panel style={{ border:'1px solid rgba(212,160,23,.25)' }}>
        <PanelHeader title={`Cola de aprobación · ${pendientes.length} pendiente${pendientes.length!==1?'s':''}`} icon={<Clock size={16} />}
          actions={<span style={{ fontSize:11, color:'rgba(212,160,23,.7)' }}>Para procesar: transfiere manualmente y marca como aprobado</span>}
        />
        <Table headers={['Referencia','Usuario','Banco destino','Datos de transferencia','Monto','Solicitado','Acciones']}>
          {pendLoading ? (
            <Tr><Td style={{ textAlign:'center', padding:32, color:'rgba(var(--adm-fg-rgb),.3)' }} colSpan={7 as any}>Cargando...</Td></Tr>
          ) : pendientes.length === 0 ? (
            <Tr><Td style={{ textAlign:'center', padding:36, color:'rgba(var(--adm-fg-rgb),.3)' }} colSpan={7 as any}>
              <div style={{ display:'flex', justifyContent:'center', color:'#6CC998', marginBottom:8 }}><CheckCircle2 size={28} /></div>
              Sin retiros pendientes · Todo al día
            </Td></Tr>
          ) : pendientes.map((w:any) => (
            <Tr key={w.id}>
              <Td style={{ fontFamily:'monospace', fontSize:10, color:'rgba(var(--adm-fg-rgb),.4)' }}>{(w.id||'').slice(0,8)}…</Td>
              <Td>
                <div style={{ fontSize:13, fontWeight:600, color:'var(--adm-text)' }}>{w.usuario_nombre||'—'}</div>
                <div style={{ fontSize:10, color:'rgba(var(--adm-fg-rgb),.35)' }}>CC {w.usuario_cedula}</div>
              </Td>
              <Td>
                <div style={{ fontSize:13, fontWeight:600, color:'var(--adm-text)' }}>{w.banco_nombre||'—'}</div>
                <div style={{ fontSize:10, color:'rgba(var(--adm-fg-rgb),.4)' }}>{w.tipo_cuenta}</div>
              </Td>
              <Td>
                <div style={{ background:'rgba(212,160,23,.08)', border:'1px solid rgba(212,160,23,.2)', borderRadius:8, padding:'8px 10px', fontSize:11, minWidth:180 }}>
                  <div style={{ display:'flex', justifyContent:'space-between', marginBottom:3 }}>
                    <span style={{ color:'rgba(var(--adm-fg-rgb),.4)' }}>Titular</span>
                    <span style={{ color:'var(--adm-text)', fontWeight:600 }}>{w.nombre_titular||'—'}</span>
                  </div>
                  <div style={{ display:'flex', justifyContent:'space-between', marginBottom:3 }}>
                    <span style={{ color:'rgba(var(--adm-fg-rgb),.4)' }}>Cédula</span>
                    <span style={{ color:'var(--adm-text)', fontFamily:'monospace' }}>{w.cedula_titular||'—'}</span>
                  </div>
                  <div style={{ display:'flex', justifyContent:'space-between' }}>
                    <span style={{ color:'rgba(var(--adm-fg-rgb),.4)' }}>Cuenta</span>
                    <span style={{ color:'#d4a017', fontFamily:'monospace', fontWeight:700 }}>{w.numero_cuenta||'—'}</span>
                  </div>
                </div>
              </Td>
              <Td style={{ fontSize:16, fontWeight:800, color:'#C0392B' }}>−{fmt(w.monto)}</Td>
              <Td style={{ fontSize:11, color:'rgba(var(--adm-fg-rgb),.35)', whiteSpace:'nowrap' }}>{fmtDate(w.created_at)}</Td>
              <Td>
                <div style={{ display:'flex', flexDirection:'column', gap:5 }}>
                  <Btn variant="primary" onClick={() => approveMut.mutate(w.id)} disabled={approveMut.isPending}><Check size={14} /> Transferido</Btn>
                  <Btn variant="danger"  onClick={() => { setShowReject(w); setMotivo(''); }}><X size={14} /> Rechazar</Btn>
                </div>
              </Td>
            </Tr>
          ))}
        </Table>
      </Panel>

      {/* History */}
      <Panel>
        <PanelHeader title="Historial de retiros · procesados" icon={<CheckCircle2 size={16} />}
          actions={<Btn variant="ghost" onClick={exportarCsv}><Download size={13} /> CSV</Btn>}
        />
        <Table headers={['Banco','Titular','Cuenta','Usuario','Monto','Estado','Fecha']}>
          {procesados.length === 0 ? (
            <Tr><Td style={{ textAlign:'center', padding:24, color:'rgba(var(--adm-fg-rgb),.3)', fontSize:12 }} colSpan={7 as any}>Sin historial aún</Td></Tr>
          ) : procesados.map((w:any) => (
            <Tr key={w.id}>
              <Td style={{ fontSize:12 }}>{w.banco_nombre||'—'}</Td>
              <Td style={{ fontSize:12 }}>{w.nombre_titular||'—'}</Td>
              <Td style={{ fontFamily:'monospace', fontSize:11, color:'rgba(var(--adm-fg-rgb),.5)' }}>{w.numero_cuenta_masked||'****'}</Td>
              <Td style={{ fontSize:11, color:'rgba(var(--adm-fg-rgb),.5)' }}>{w.usuario_nombre||'—'}</Td>
              <Td style={{ color:'#C0392B', fontWeight:700 }}>{fmt(w.monto)}</Td>
              <Td><StatusBadge status={w.status} /></Td>
              <Td style={{ fontSize:11, color:'rgba(var(--adm-fg-rgb),.35)', whiteSpace:'nowrap' }}>{fmtDate(w.created_at)}</Td>
            </Tr>
          ))}
        </Table>
      </Panel>

      {/* Reject modal */}
      <Modal open={!!showReject} onClose={() => setShowReject(null)} title="Rechazar retiro">
        {showReject && (
          <div>
            <div style={{ background:'rgba(192,57,43,.1)', border:'1px solid rgba(192,57,43,.2)', borderRadius:12, padding:14, marginBottom:16, fontSize:13, color:'rgba(var(--adm-fg-rgb),.8)' }}>
              El saldo de <strong style={{ color:'var(--adm-text)' }}>{fmt(showReject.monto)}</strong> será revertido a la billetera de <strong style={{ color:'var(--adm-text)' }}>{showReject.usuario_nombre}</strong>.
            </div>
            <Input label="Motivo del rechazo (opcional)" value={motivo} onChange={e => setMotivo(e.target.value)} placeholder="Ej. Datos bancarios incorrectos..." />
            <div style={{ display:'flex', gap:10, marginTop:8 }}>
              <Btn variant="ghost" style={{ flex:1, justifyContent:'center' }} onClick={() => setShowReject(null)}>Cancelar</Btn>
              <Btn variant="danger" style={{ flex:1, justifyContent:'center' }} onClick={() => rejectMut.mutate({ id:showReject.id, motivo: motivo||'Rechazado por administrador' })}>
                Rechazar y devolver saldo
              </Btn>
            </div>
          </div>
        )}
      </Modal>
    </div>
  );
}
