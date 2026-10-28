'use client';
import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { adminApi } from '@/lib/api';
import { Panel, PanelHeader, Table, Tr, Td, StatusBadge, Btn, Modal, Input, fmt, fmtDate } from '@/components/admin/ui';
import toast from 'react-hot-toast';
import { Clock, CheckCircle2, Check, X, Download, RefreshCw, FileText } from 'lucide-react';
import { downloadCsv } from '@/lib/exportCsv';

export default function RetirosPage() {
  const qc = useQueryClient();
  const [showReject, setShowReject] = useState<any>(null);
  const [motivo, setMotivo]         = useState('');
  const [consultando, setConsultando] = useState<string | null>(null);
  const [respuestas, setRespuestas]   = useState<{ retiro: any; items: any[] } | null>(null);

  const ETAPAS: Record<string, string> = {
    init: 'Envío a Kushki',
    estado: 'Consulta de estado',
    webhook: 'Aviso de Kushki (webhook)',
    error: 'Error al enviar',
    estado_error: 'Error al consultar el estado',
  };

  async function verRespuestas(retiro: any) {
    try {
      const { data } = await adminApi.respuestasWD(retiro.id);
      setRespuestas({ retiro, items: data.respuestas || [] });
    } catch (e: any) {
      toast.error(e.response?.data?.mensaje || 'No se pudieron cargar las respuestas');
    }
  }

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
    mutationFn: ({ id, manual }: { id: string; manual?: boolean }) => adminApi.approveWD(id, manual),
    onSuccess: (res) => { qc.invalidateQueries({ queryKey:['admin-retiros-pend'] }); qc.invalidateQueries({ queryKey:['admin-retiros-all'] }); toast.success(res.data?.mensaje || 'Retiro aprobado'); },
    onError: (e:any) => toast.error(e.response?.data?.mensaje || 'Error'),
  });

  const rejectMut = useMutation({
    mutationFn: ({ id, motivo }:any) => adminApi.rejectWD(id, motivo),
    onSuccess: () => { qc.invalidateQueries({ queryKey:['admin-retiros-pend'] }); qc.invalidateQueries({ queryKey:['admin-retiros-all'] }); toast.success('Retiro rechazado · Saldo revertido'); setShowReject(null); setMotivo(''); },
    onError: (e:any) => toast.error(e.response?.data?.mensaje || 'Error'),
  });

  const pendientes: any[] = pendData?.retiros || [];
  const ach: boolean = !!pendData?.ach;
  const procesados: any[] = (allData?.retiros || []).filter((w: any) => w.status !== 'pendiente');

  async function consultarKushki(id: string) {
    setConsultando(id);
    try {
      const { data } = await adminApi.kushkiWD(id);
      const detalle = data.responseText ? ` · ${data.responseText}` : '';
      toast(`Kushki · ticket ${data.ticket}: ${data.estadoKushki || 'SIN ESTADO'}${detalle}`, { duration: 8000 });
    } catch (e: any) {
      toast.error(e.response?.data?.mensaje || 'No se pudo consultar Kushki');
    } finally {
      setConsultando(null);
    }
  }

  function exportarCsv() {
    downloadCsv('retiros', ['Banco', 'Titular', 'Cuenta', 'Usuario', 'Monto', 'Estado', 'Ticket Kushki', 'Motivo', 'Fecha'],
      procesados.map((w: any) => [w.banco_nombre || '', w.nombre_titular || '', w.numero_cuenta_masked || '', w.usuario_nombre || '', w.monto || 0, w.status || '', w.payout_ticket || '', w.notas_admin || '', fmtDate(w.created_at)]));
  }

  let pendRows: React.ReactNode;
  if (pendLoading) {
    pendRows = <Tr><Td style={{ textAlign:'center', padding:32, color:'rgba(var(--adm-fg-rgb),.3)' }} colSpan={7 as any}>Cargando...</Td></Tr>;
  } else if (pendientes.length === 0) {
    pendRows = (
      <Tr><Td style={{ textAlign:'center', padding:36, color:'rgba(var(--adm-fg-rgb),.3)' }} colSpan={7 as any}>
        <div style={{ display:'flex', justifyContent:'center', color:'#6CC998', marginBottom:8 }}><CheckCircle2 size={28} /></div>
        Sin retiros pendientes · Todo al día
      </Td></Tr>
    );
  } else {
    pendRows = pendientes.map((w:any) => (
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
            <Btn variant="primary" onClick={() => approveMut.mutate({ id: w.id })} disabled={approveMut.isPending}><Check size={14} /> {ach ? 'Enviar por ACH' : 'Transferido'}</Btn>
            {ach && <Btn variant="ghost" onClick={() => approveMut.mutate({ id: w.id, manual: true })} disabled={approveMut.isPending}>Ya lo transferí a mano</Btn>}
            <Btn variant="danger"  onClick={() => { setShowReject(w); setMotivo(''); }}><X size={14} /> Rechazar</Btn>
          </div>
        </Td>
      </Tr>
    ));
  }

  return (
    <div style={{ display:'flex', flexDirection:'column', gap:16 }}>

      {/* Pending queue */}
      <Panel style={{ border:'1px solid rgba(212,160,23,.25)' }}>
        <PanelHeader title={`Cola de aprobación · ${pendientes.length} pendiente${pendientes.length!==1?'s':''}`} icon={<Clock size={16} />}
          actions={<span style={{ fontSize:11, color:'rgba(212,160,23,.7)' }}>{ach ? 'Se envía por ACH vía Kushki · el banco confirma en minutos u horas hábiles' : 'Para procesar: transfiere manualmente y marca como aprobado'}</span>}
        />
        <Table headers={['Referencia','Usuario','Banco destino','Datos de transferencia','Monto','Solicitado','Acciones']}>
          {pendRows}
        </Table>
      </Panel>

      {/* History */}
      <Panel>
        <PanelHeader title="Historial de retiros · procesados" icon={<CheckCircle2 size={16} />}
          actions={<Btn variant="ghost" onClick={exportarCsv}><Download size={13} /> CSV</Btn>}
        />
        <Table headers={['Banco','Titular','Cuenta','Usuario','Monto','Estado','Ticket Kushki','Motivo','Fecha']}>
          {procesados.length === 0 ? (
            <Tr><Td style={{ textAlign:'center', padding:24, color:'rgba(var(--adm-fg-rgb),.3)', fontSize:12 }} colSpan={9 as any}>Sin historial aún</Td></Tr>
          ) : procesados.map((w:any) => (
            <Tr key={w.id}>
              <Td style={{ fontSize:12 }}>{w.banco_nombre||'—'}</Td>
              <Td style={{ fontSize:12 }}>{w.nombre_titular||'—'}</Td>
              <Td style={{ fontFamily:'monospace', fontSize:11, color:'rgba(var(--adm-fg-rgb),.5)' }}>{w.numero_cuenta_masked||'****'}</Td>
              <Td style={{ fontSize:11, color:'rgba(var(--adm-fg-rgb),.5)' }}>{w.usuario_nombre||'—'}</Td>
              <Td style={{ color:'#C0392B', fontWeight:700 }}>{fmt(w.monto)}</Td>
              <Td><StatusBadge status={w.status} /></Td>
              <Td style={{ fontSize:11 }}>
                {w.payout_ticket ? (
                  <div style={{ display:'flex', alignItems:'center', gap:8, whiteSpace:'nowrap' }}>
                    <span style={{ fontFamily:'monospace', color:'rgba(var(--adm-fg-rgb),.6)' }}>{w.payout_ticket}</span>
                    <Btn variant="ghost" title="Consultar estado en Kushki" onClick={() => consultarKushki(w.id)} disabled={consultando === w.id} style={{ padding:'5px 7px' }}>
                      <RefreshCw size={13} className={consultando === w.id ? 'animate-spin' : undefined} />
                    </Btn>
                    <Btn variant="ghost" title="Ver respuestas guardadas" onClick={() => verRespuestas(w)} style={{ padding:'5px 7px' }}>
                      <FileText size={13} />
                    </Btn>
                  </div>
                ) : <span style={{ color:'rgba(var(--adm-fg-rgb),.3)' }}>—</span>}
              </Td>
              <Td style={{ fontSize:11, color:'rgba(var(--adm-fg-rgb),.5)', maxWidth:200 }}>{w.notas_admin || '—'}</Td>
              <Td style={{ fontSize:11, color:'rgba(var(--adm-fg-rgb),.35)', whiteSpace:'nowrap' }}>{fmtDate(w.created_at)}</Td>
            </Tr>
          ))}
        </Table>
      </Panel>

      {/* Respuestas de Kushki */}
      <Modal open={!!respuestas} onClose={() => setRespuestas(null)} title="Respuestas de Kushki">
        {respuestas && (
          <div>
            <div style={{ fontSize:12, color:'rgba(var(--adm-fg-rgb),.6)', marginBottom:12 }}>
              Ticket <span style={{ fontFamily:'monospace', color:'var(--adm-text)' }}>{respuestas.retiro.payout_ticket}</span> · {respuestas.retiro.banco_nombre} · {fmt(respuestas.retiro.monto)}
            </div>
            {respuestas.items.length === 0 ? (
              <div style={{ textAlign:'center', padding:24, color:'rgba(var(--adm-fg-rgb),.4)', fontSize:12 }}>Aún no hay respuestas guardadas</div>
            ) : (
              <div style={{ display:'flex', flexDirection:'column', gap:10, maxHeight:420, overflowY:'auto' }}>
                {respuestas.items.map((r: any, i: number) => (
                  <div key={`${r.etapa}-${r.fecha}-${i}`} style={{ border:'1px solid rgba(var(--adm-fg-rgb),.12)', borderRadius:10, padding:10 }}>
                    <div style={{ display:'flex', justifyContent:'space-between', marginBottom:6, fontSize:12 }}>
                      <strong style={{ color: r.etapa?.includes('error') ? '#C0392B' : 'var(--adm-text)' }}>{ETAPAS[r.etapa] || r.etapa}</strong>
                      <span style={{ color:'rgba(var(--adm-fg-rgb),.4)' }}>{fmtDate(r.fecha)}</span>
                    </div>
                    <pre style={{ margin:0, fontSize:10, whiteSpace:'pre-wrap', wordBreak:'break-all', color:'rgba(var(--adm-fg-rgb),.7)' }}>{JSON.stringify(r.respuesta, null, 2)}</pre>
                  </div>
                ))}
              </div>
            )}
            <div style={{ marginTop:14 }}>
              <Btn variant="ghost" style={{ width:'100%', justifyContent:'center' }} onClick={() => setRespuestas(null)}>Cerrar</Btn>
            </div>
          </div>
        )}
      </Modal>

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
