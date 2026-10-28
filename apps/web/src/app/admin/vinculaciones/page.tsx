'use client';
import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import toast from 'react-hot-toast';
import { FolderCheck, Plus, Eye, Link2, Copy, Check, X, FileText, ExternalLink } from 'lucide-react';
import { adminApi } from '@/lib/api';
import { Panel, PanelHeader, Table, Tr, Td, StatusBadge, Btn, Modal, Input, fmtDate } from '@/components/admin/ui';

const FILTROS = [
  { label: 'Todas', value: '' },
  { label: 'Por revisar', value: 'en_revision' },
  { label: 'Invitadas', value: 'invitada' },
  { label: 'Con correcciones', value: 'requiere_correccion' },
  { label: 'Aprobadas', value: 'aprobada' },
  { label: 'Rechazadas', value: 'rechazada' },
];

const API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3001';

const VACIO = { razonSocial: '', nit: '', contactoNombre: '', contactoCorreo: '' };

const mensajeError = (e: any, def: string) => e.response?.data?.mensaje || def;

export default function VinculacionesPage() {
  const qc = useQueryClient();
  const [filtro, setFiltro] = useState('');
  const [nueva, setNueva] = useState(false);
  const [form, setForm] = useState(VACIO);
  const [enlace, setEnlace] = useState<{ url: string; correoEnviado: boolean } | null>(null);
  const [copiado, setCopiado] = useState(false);
  const [abierta, setAbierta] = useState<string | null>(null);
  const [rechazando, setRechazando] = useState<{ tipo: string; motivo: string } | null>(null);
  const [decision, setDecision] = useState<{ tipo: 'solicitar_correccion' | 'rechazar'; mensaje: string } | null>(null);

  const { data, isLoading } = useQuery({
    queryKey: ['admin-vinculaciones'],
    queryFn: () => adminApi.vinculaciones(),
    select: d => d.data,
  });
  const lista: any[] = (data?.vinculaciones || []).filter((v: any) => !filtro || v.estado === filtro);

  const detalle = useQuery({
    queryKey: ['admin-vinculacion', abierta],
    queryFn: () => adminApi.vinculacion(abierta as string),
    select: d => d.data,
    enabled: !!abierta,
  });
  const sol = detalle.data?.vinculacion;
  const documentos: any[] = detalle.data?.documentos || [];

  function refrescar() {
    qc.invalidateQueries({ queryKey: ['admin-vinculaciones'] });
    qc.invalidateQueries({ queryKey: ['admin-vinculacion'] });
  }

  const crearMut = useMutation({
    mutationFn: () => adminApi.crearVinculacion({ ...form, nit: form.nit || undefined }),
    onSuccess: ({ data: res }) => {
      refrescar();
      setEnlace({ url: res.enlace, correoEnviado: res.correoEnviado });
      toast.success(res.correoEnviado ? 'Invitación enviada por correo' : 'Solicitud creada');
    },
    onError: (e: any) => toast.error(mensajeError(e, 'No se pudo crear la solicitud')),
  });

  const enlaceMut = useMutation({
    mutationFn: (id: string) => adminApi.enlaceVinculacion(id),
    onSuccess: ({ data: res }) => {
      setNueva(true);
      setEnlace({ url: res.enlace, correoEnviado: res.correoEnviado });
      toast.success('Enlace nuevo generado; el anterior dejó de funcionar');
    },
    onError: (e: any) => toast.error(mensajeError(e, 'No se pudo generar el enlace')),
  });

  const docMut = useMutation({
    mutationFn: (a: { tipo: string; estado: 'aprobado' | 'rechazado'; motivo?: string }) => adminApi.revisarDocVinculacion(abierta as string, a.tipo, { estado: a.estado, motivo: a.motivo }),
    onSuccess: () => { refrescar(); setRechazando(null); },
    onError: (e: any) => toast.error(mensajeError(e, 'No se pudo guardar la revisión')),
  });

  const decisionMut = useMutation({
    mutationFn: (a: { decision: 'aprobar' | 'solicitar_correccion' | 'rechazar'; mensaje?: string }) => adminApi.decidirVinculacion(abierta as string, a),
    onSuccess: ({ data: res }) => {
      refrescar();
      setDecision(null);
      const avisoCorreo = res.correoEnviado ? 'Se avisó al cliente por correo' : 'No se pudo enviar el correo: avísale tú';
      toast.success(`Solicitud ${{ aprobada: 'aprobada', requiere_correccion: 'devuelta con correcciones', rechazada: 'rechazada' }[res.estado as string] ?? 'actualizada'}. ${avisoCorreo}`);
      if (res.enlace) { setEnlace({ url: res.enlace, correoEnviado: res.correoEnviado }); setNueva(true); setAbierta(null); }
    },
    onError: (e: any) => toast.error(mensajeError(e, 'No se pudo registrar la decisión')),
  });

  async function verArchivo(tipo: string) {
    const ventana = window.open('about:blank', '_blank');
    try {
      const { data: res } = await adminApi.archivoVinculacion(abierta as string, tipo);
      // En el almacenamiento propio la dirección es relativa al API; en S3/R2 ya es absoluta
      const destino = res.url.startsWith('/') ? `${API_URL}${res.url}` : res.url;
      if (ventana) { ventana.opener = null; ventana.location.href = destino; }
    } catch (e: any) {
      ventana?.close();
      toast.error(mensajeError(e, 'No se pudo abrir el documento'));
    }
  }

  async function copiar(url: string) {
    try {
      await navigator.clipboard.writeText(url);
      setCopiado(true);
      setTimeout(() => setCopiado(false), 2000);
    } catch { toast.error('No se pudo copiar; selecciona el enlace y cópialo a mano'); }
  }

  function cerrarNueva() { setNueva(false); setEnlace(null); setForm(VACIO); setCopiado(false); }

  const formValido = form.razonSocial.trim().length >= 2 && form.contactoNombre.trim().length >= 2 && /\S+@\S+\.\S+/.test(form.contactoCorreo);
  const puedeAprobar = documentos.length > 0 && documentos.filter(d => d.requerido).every(d => d.estado === 'aprobado');
  const hayRechazados = documentos.some(d => d.estado === 'rechazado');
  const enRevision = sol?.estado === 'en_revision';

  return (
    <div>
      <div style={{ display:'flex', gap:8, flexWrap:'wrap', marginBottom:16 }}>
        {FILTROS.map(f => (
          <button key={f.value} onClick={() => setFiltro(f.value)}
            style={{ padding:'7px 14px', borderRadius:20, fontSize:12, fontWeight:600, cursor:'pointer', border:'1px solid rgba(133,46,199,.25)', background: filtro === f.value ? '#852EC7' : 'transparent', color: filtro === f.value ? '#fff' : 'rgba(var(--adm-fg-rgb),.7)' }}>
            {f.label}
          </button>
        ))}
      </div>

      <Panel>
        <PanelHeader title={`${lista.length} solicitud${lista.length === 1 ? '' : 'es'}`} icon={<FolderCheck size={16} />}
          actions={<Btn variant="primary" onClick={() => setNueva(true)}><Plus size={14} /> Nueva vinculación</Btn>} />
        <Table headers={['Empresa', 'Contacto', 'Estado', 'Documentos', 'Enviada', 'Acciones']}>
          {isLoading && <Tr><Td colSpan={6} style={{ textAlign:'center', padding:24 }}>Cargando…</Td></Tr>}
          {!isLoading && lista.length === 0 && (
            <Tr><Td colSpan={6} style={{ textAlign:'center', padding:28, color:'rgba(var(--adm-fg-rgb),.4)', fontSize:12 }}>Aún no hay solicitudes. Crea la primera con “Nueva vinculación”.</Td></Tr>
          )}
          {lista.map((v: any) => (
            <Tr key={v.id}>
              <Td><div style={{ fontWeight:700, color:'var(--adm-text)' }}>{v.razonSocial}</div>{v.nit && <div style={{ fontSize:11, color:'var(--adm-muted)' }}>NIT {v.nit}</div>}</Td>
              <Td><div style={{ fontSize:13 }}>{v.contactoNombre}</div><div style={{ fontSize:11, color:'var(--adm-muted)' }}>{v.contactoCorreo}</div></Td>
              <Td><StatusBadge status={v.estado} /></Td>
              <Td>
                <div style={{ fontSize:12, marginBottom:5 }}>{v.documentosSubidos}/{v.documentosTotales} cargados · {v.documentosAprobados} aprobados</div>
                <div style={{ height:5, width:120, borderRadius:9, background:'rgba(var(--adm-fg-rgb),.1)', overflow:'hidden' }}>
                  <div style={{ height:'100%', width:`${(v.documentosSubidos / v.documentosTotales) * 100}%`, background:'#852EC7' }} />
                </div>
              </Td>
              <Td style={{ fontSize:11, color:'rgba(var(--adm-fg-rgb),.5)', whiteSpace:'nowrap' }}>{v.enviadaAt ? fmtDate(v.enviadaAt) : '—'}</Td>
              <Td>
                <div style={{ display:'flex', gap:6 }}>
                  <Btn variant={v.estado === 'en_revision' ? 'primary' : 'ghost'} title="Abrir y revisar" onClick={() => setAbierta(v.id)} style={{ padding:'5px 8px' }}><Eye size={14} /></Btn>
                  {(v.estado === 'invitada' || v.estado === 'requiere_correccion') && (
                    <Btn variant="ghost" title="Generar enlace nuevo y reenviarlo" disabled={enlaceMut.isPending} onClick={() => enlaceMut.mutate(v.id)} style={{ padding:'5px 8px' }}><Link2 size={14} /></Btn>
                  )}
                </div>
              </Td>
            </Tr>
          ))}
        </Table>
      </Panel>

      {/* Nueva vinculación / enlace generado */}
      <Modal open={nueva} onClose={cerrarNueva} title={enlace ? 'Enlace de vinculación' : 'Nueva vinculación'}>
        {enlace ? (
          <div>
            <p style={{ fontSize:13, color:'rgba(var(--adm-fg-rgb),.75)', lineHeight:1.5, marginBottom:12 }}>
              {enlace.correoEnviado ? 'Enviamos el enlace por correo al cliente. También puedes copiarlo y compartirlo tú.' : 'No se pudo enviar el correo automático. Copia el enlace y envíaselo al cliente.'}
            </p>
            <div style={{ display:'flex', gap:8, alignItems:'center', padding:'10px 12px', borderRadius:10, background:'rgba(var(--adm-card-rgb),.6)', border:'1px solid rgba(133,46,199,.25)' }}>
              <code style={{ flex:1, fontSize:11, wordBreak:'break-all', color:'var(--adm-text)' }}>{enlace.url}</code>
              <Btn variant="ghost" title="Copiar enlace" onClick={() => copiar(enlace.url)} style={{ padding:'6px 9px' }}>{copiado ? <Check size={14} /> : <Copy size={14} />}</Btn>
            </div>
            <p style={{ fontSize:11, color:'var(--adm-muted)', marginTop:10 }}>Por seguridad, este enlace solo se muestra ahora. Si lo pierdes, genera uno nuevo y el anterior dejará de funcionar.</p>
            <Btn variant="primary" style={{ width:'100%', justifyContent:'center', marginTop:14 }} onClick={cerrarNueva}>Listo</Btn>
          </div>
        ) : (
          <div>
            <Input label="Razón social" value={form.razonSocial} onChange={e => setForm(p => ({ ...p, razonSocial: e.target.value }))} />
            <Input label="NIT (opcional)" value={form.nit} onChange={e => setForm(p => ({ ...p, nit: e.target.value }))} />
            <Input label="Nombre del contacto" value={form.contactoNombre} onChange={e => setForm(p => ({ ...p, contactoNombre: e.target.value }))} />
            <Input label="Correo del contacto" type="email" value={form.contactoCorreo} onChange={e => setForm(p => ({ ...p, contactoCorreo: e.target.value }))} />
            <Btn variant="primary" style={{ width:'100%', justifyContent:'center', marginTop:8 }} disabled={!formValido || crearMut.isPending} onClick={() => crearMut.mutate()}>
              {crearMut.isPending ? 'Creando…' : 'Crear y enviar invitación'}
            </Btn>
          </div>
        )}
      </Modal>

      {/* Revisión */}
      <Modal open={!!abierta} onClose={() => { setAbierta(null); setRechazando(null); setDecision(null); }} title={sol ? sol.razonSocial : 'Solicitud'} wide>
        {sol && (
          <div>
            <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', flexWrap:'wrap', gap:8, marginBottom:16 }}>
              <div style={{ fontSize:12, color:'var(--adm-muted)' }}>{sol.contactoNombre} · {sol.contactoCorreo}{sol.nit ? ` · NIT ${sol.nit}` : ''}</div>
              <StatusBadge status={sol.estado} />
            </div>
            {sol.mensaje && <div style={{ fontSize:12, padding:'8px 12px', borderRadius:8, background:'rgba(133,46,199,.1)', marginBottom:14 }}>Mensaje al cliente: {sol.mensaje}</div>}

            <div style={{ display:'flex', flexDirection:'column', gap:10 }}>
              {documentos.map(d => (
                <div key={d.tipo} style={{ border:'1px solid rgba(var(--adm-fg-rgb),.12)', borderRadius:12, padding:'12px 14px' }}>
                  <div style={{ display:'flex', alignItems:'center', gap:10, flexWrap:'wrap' }}>
                    <FileText size={18} style={{ color:'#852EC7', flex:'none' }} />
                    <div style={{ flex:1, minWidth:180 }}>
                      <div style={{ fontSize:13, fontWeight:700, color:'var(--adm-text)' }}>{d.nombre}</div>
                      <div style={{ fontSize:11, color:'var(--adm-muted)' }}>
                        {d.subido ? `${d.nombreOriginal}${d.fechaExpedicion ? ` · ${d.etiquetaFecha?.toLowerCase()}: ${d.fechaExpedicion}` : ''}` : 'El cliente aún no lo carga'}
                      </div>
                    </div>
                    {d.subido && <StatusBadge status={d.estado === 'pendiente' ? 'pendiente' : d.estado} />}
                    {d.subido && (
                      <div style={{ display:'flex', gap:6 }}>
                        <Btn variant="ghost" title="Ver documento" onClick={() => verArchivo(d.tipo)} style={{ padding:'5px 8px' }}><ExternalLink size={14} /></Btn>
                        {enRevision && d.estado !== 'aprobado' && (
                          <Btn variant="default" title="Aprobar documento" disabled={docMut.isPending} onClick={() => docMut.mutate({ tipo: d.tipo, estado: 'aprobado' })} style={{ padding:'5px 8px' }}><Check size={14} /></Btn>
                        )}
                        {enRevision && d.estado !== 'rechazado' && (
                          <Btn variant="danger" title="Rechazar documento" onClick={() => setRechazando({ tipo: d.tipo, motivo: '' })} style={{ padding:'5px 8px' }}><X size={14} /></Btn>
                        )}
                      </div>
                    )}
                  </div>
                  {d.estado === 'rechazado' && d.motivo && <div style={{ fontSize:12, color:'#C0392B', marginTop:8 }}>Motivo: {d.motivo}</div>}
                  {rechazando && rechazando.tipo === d.tipo && (
                    <div style={{ display:'flex', gap:8, marginTop:10, alignItems:'flex-end' }}>
                      <div style={{ flex:1 }}><Input label="Qué debe corregir el cliente" value={rechazando.motivo} onChange={e => setRechazando({ tipo: d.tipo, motivo: e.target.value })} /></div>
                      <Btn variant="danger" disabled={!rechazando.motivo.trim() || docMut.isPending} onClick={() => docMut.mutate({ tipo: d.tipo, estado: 'rechazado', motivo: rechazando.motivo.trim() })} style={{ marginBottom:14 }}>Rechazar</Btn>
                    </div>
                  )}
                </div>
              ))}
            </div>

            {enRevision && (
              <div style={{ marginTop:18, paddingTop:16, borderTop:'1px solid rgba(var(--adm-fg-rgb),.1)' }}>
                {decision ? (
                  <div>
                    <Input label={decision.tipo === 'rechazar' ? 'Motivo para el cliente (obligatorio)' : 'Mensaje para el cliente (opcional)'} value={decision.mensaje} onChange={e => setDecision({ ...decision, mensaje: e.target.value })} />
                    <div style={{ display:'flex', gap:8 }}>
                      <Btn variant="ghost" style={{ flex:1, justifyContent:'center' }} onClick={() => setDecision(null)}>Cancelar</Btn>
                      <Btn variant={decision.tipo === 'rechazar' ? 'danger' : 'primary'} style={{ flex:1, justifyContent:'center' }}
                        disabled={decisionMut.isPending || (decision.tipo === 'rechazar' && !decision.mensaje.trim())}
                        onClick={() => decisionMut.mutate({ decision: decision.tipo, mensaje: decision.mensaje.trim() || undefined })}>
                        {decision.tipo === 'rechazar' ? 'Rechazar vinculación' : 'Enviar correcciones'}
                      </Btn>
                    </div>
                  </div>
                ) : (
                  <div style={{ display:'flex', gap:8, flexWrap:'wrap' }}>
                    <Btn variant="primary" disabled={!puedeAprobar || decisionMut.isPending} title={puedeAprobar ? '' : 'Aprueba primero todos los documentos'} onClick={() => decisionMut.mutate({ decision: 'aprobar' })}><Check size={14} /> Aprobar vinculación</Btn>
                    <Btn variant="default" disabled={!hayRechazados} title={hayRechazados ? '' : 'Rechaza al menos un documento con su motivo'} onClick={() => setDecision({ tipo: 'solicitar_correccion', mensaje: '' })}>Pedir correcciones</Btn>
                    <Btn variant="danger" onClick={() => setDecision({ tipo: 'rechazar', mensaje: '' })}>Rechazar vinculación</Btn>
                  </div>
                )}
              </div>
            )}
          </div>
        )}
      </Modal>
    </div>
  );
}
