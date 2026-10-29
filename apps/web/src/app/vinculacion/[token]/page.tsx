'use client';
import { useCallback, useEffect, useRef, useState } from 'react';
import { useParams } from 'next/navigation';
import { ShieldCheck, Lock, FileText, UploadCloud, CheckCircle2, AlertCircle, Clock, RefreshCw, Send, FileCheck2, XCircle } from 'lucide-react';

// Portal público de vinculación: el cliente entra con un enlace privado, sin cuenta ni contraseña.
// Usa fetch directo (no el cliente axios de la app) porque aquí no hay sesión ni refresco de tokens.
const API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3001';

interface Documento {
  tipo: string; nombre: string; descripcion: string; vigencia: string; requerido: boolean;
  pedirFecha: boolean; etiquetaFecha: string | null; subido: boolean; nombreOriginal: string | null;
  tamano: number | null; fechaExpedicion: string | null; estado: string; motivo: string | null;
}
interface Solicitud { razonSocial: string; contactoNombre: string; estado: string; mensaje: string | null; expiraAt: string }
interface Contrato { estado: string; motivo: string | null; enviado: { nombre: string } | null; firmado: { nombre: string } | null }

const ESTILOS = `
.vc-page { min-height:100vh; background:linear-gradient(180deg,#f4effb 0%,#faf8fd 320px,#faf8fd 100%); color:#241b2f; font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif; }
.vc-top { background:#fff; border-bottom:1px solid #ece4f5; }
.vc-top-in { max-width:880px; margin:0 auto; padding:14px 20px; display:flex; align-items:center; justify-content:space-between; gap:12px; }
.vc-brand { display:flex; align-items:center; gap:10px; font-weight:800; color:#5a1a8a; font-size:18px; }
.vc-brand img { width:32px; height:32px; border-radius:8px; }
.vc-secure { display:flex; align-items:center; gap:6px; font-size:12px; color:#6b5b78; font-weight:600; }
.vc-wrap { max-width:880px; margin:0 auto; padding:32px 20px 140px; }
.vc-hero h1 { font-size:28px; line-height:1.2; font-weight:800; letter-spacing:-.02em; margin-bottom:8px; }
.vc-hero p { color:#6b5b78; font-size:15px; line-height:1.55; max-width:620px; }
.vc-hero strong { color:#241b2f; }
.vc-progress { margin:26px 0 22px; background:#fff; border:1px solid #ece4f5; border-radius:16px; padding:16px 18px; }
.vc-progress-top { display:flex; justify-content:space-between; font-size:13px; font-weight:700; margin-bottom:10px; }
.vc-bar { height:8px; background:#efe7f8; border-radius:99px; overflow:hidden; }
.vc-bar > div { height:100%; background:linear-gradient(90deg,#852EC7,#b05ce6); border-radius:99px; transition:width .35s; }
.vc-banner { display:flex; gap:12px; background:#fff7e8; border:1px solid #f3d9a4; color:#7a5200; border-radius:14px; padding:14px 16px; margin-bottom:18px; font-size:14px; line-height:1.5; }
.vc-list { display:flex; flex-direction:column; gap:14px; }
.vc-card { background:#fff; border:1px solid #ece4f5; border-radius:18px; padding:20px; transition:border-color .2s, box-shadow .2s; }
.vc-card.ok { border-color:#bfe6cf; }
.vc-card.bad { border-color:#f0b9b4; box-shadow:0 0 0 3px rgba(192,57,43,.06); }
.vc-card-head { display:flex; gap:14px; align-items:flex-start; }
.vc-num { flex:none; width:34px; height:34px; border-radius:50%; background:#f1e9fb; color:#852EC7; font-weight:800; display:flex; align-items:center; justify-content:center; font-size:14px; }
.vc-card.ok .vc-num { background:#e3f6ec; color:#1e8a55; }
.vc-card.bad .vc-num { background:#fbe6e4; color:#c0392b; }
.vc-card-title { font-weight:700; font-size:16px; line-height:1.3; }
.vc-card-desc { color:#6b5b78; font-size:13.5px; margin-top:3px; line-height:1.5; }
.vc-chips { display:flex; flex-wrap:wrap; gap:8px; margin-top:10px; }
.vc-chip { display:inline-flex; align-items:center; gap:6px; font-size:12px; font-weight:600; padding:4px 10px; border-radius:99px; background:#f4effb; color:#5a1a8a; }
.vc-pill { margin-left:auto; flex:none; display:inline-flex; align-items:center; gap:6px; font-size:12px; font-weight:700; padding:5px 11px; border-radius:99px; white-space:nowrap; }
.vc-pill.pend { background:#f2eff5; color:#6b5b78; }
.vc-pill.cargado { background:#e8f0fe; color:#2557b7; }
.vc-pill.aprobado { background:#e3f6ec; color:#1e8a55; }
.vc-pill.rechazado { background:#fbe6e4; color:#c0392b; }
.vc-body { margin-top:16px; display:grid; gap:12px; }
.vc-field label { display:block; font-size:12.5px; font-weight:700; color:#4a3a5c; margin-bottom:6px; }
.vc-field input[type=date] { width:100%; max-width:240px; padding:10px 12px; border:1px solid #d9cce8; border-radius:10px; font-size:14px; background:#fff; color:#241b2f; font-family:inherit; }
.vc-field input[type=date]:focus { outline:2px solid #852EC7; outline-offset:1px; }
.vc-drop { border:2px dashed #d3c2e6; border-radius:14px; padding:22px 16px; text-align:center; cursor:pointer; background:#fcfaff; transition:all .15s; }
.vc-drop:hover, .vc-drop.over { border-color:#852EC7; background:#f6eefd; }
.vc-drop b { color:#852EC7; }
.vc-drop small { display:block; color:#8a7b98; margin-top:4px; font-size:12px; }
.vc-file { display:flex; align-items:center; gap:12px; background:#f8f5fc; border-radius:12px; padding:12px 14px; }
.vc-file-name { font-weight:600; font-size:14px; word-break:break-all; }
.vc-file-meta { color:#8a7b98; font-size:12px; }
.vc-btn { border:1px solid #d3c2e6; background:#fff; color:#5a1a8a; font-weight:700; font-size:13px; padding:8px 14px; border-radius:10px; cursor:pointer; display:inline-flex; align-items:center; gap:6px; font-family:inherit; }
.vc-btn:hover { background:#f6eefd; }
.vc-btn:disabled { opacity:.5; cursor:not-allowed; }
.vc-err { color:#c0392b; font-size:13px; font-weight:600; display:flex; gap:6px; align-items:flex-start; }
.vc-motivo { background:#fdf0ef; border-left:4px solid #c0392b; border-radius:8px; padding:10px 14px; font-size:13.5px; color:#7a2018; }
.vc-bar-fixed { position:fixed; left:0; right:0; bottom:0; background:rgba(255,255,255,.96); backdrop-filter:blur(8px); border-top:1px solid #ece4f5; z-index:20; }
.vc-bar-in { max-width:880px; margin:0 auto; padding:14px 20px; display:flex; align-items:center; justify-content:space-between; gap:16px; }
.vc-bar-txt { font-size:13.5px; color:#6b5b78; line-height:1.4; }
.vc-send { background:#852EC7; color:#fff; border:none; font-weight:800; font-size:15px; padding:13px 26px; border-radius:12px; cursor:pointer; display:inline-flex; align-items:center; gap:8px; font-family:inherit; white-space:nowrap; }
.vc-send:hover { background:#7125ab; }
.vc-send:disabled { background:#cdbfdc; cursor:not-allowed; }
.vc-priv { display:flex; gap:10px; align-items:flex-start; color:#6b5b78; font-size:12.5px; line-height:1.5; margin-top:22px; }
.vc-center { max-width:560px; margin:70px auto 0; background:#fff; border:1px solid #ece4f5; border-radius:22px; padding:38px 30px; text-align:center; box-shadow:0 20px 50px rgba(88,30,140,.08); }
.vc-center h2 { font-size:24px; margin:16px 0 8px; font-weight:800; }
.vc-center p { color:#6b5b78; font-size:15px; line-height:1.6; }
.vc-ico { width:64px; height:64px; border-radius:50%; display:inline-flex; align-items:center; justify-content:center; }
.vc-steps { display:flex; justify-content:center; gap:0; margin-top:28px; text-align:center; }
.vc-step { flex:1; font-size:12.5px; color:#8a7b98; font-weight:600; position:relative; padding-top:26px; }
.vc-step::before { content:''; position:absolute; top:6px; left:50%; width:12px; height:12px; margin-left:-6px; border-radius:50%; background:#d9cce8; z-index:1; }
.vc-step::after { content:''; position:absolute; top:11px; left:-50%; width:100%; height:2px; background:#d9cce8; }
.vc-step:first-child::after { display:none; }
.vc-step.done, .vc-step.now { color:#241b2f; }
.vc-step.done::before { background:#1e8a55; } .vc-step.done::after { background:#1e8a55; }
.vc-step.now::before { background:#852EC7; box-shadow:0 0 0 5px rgba(133,46,199,.18); } .vc-step.now::after { background:#1e8a55; }
@media (max-width:640px) {
  .vc-hero h1 { font-size:23px; } .vc-card-head { flex-wrap:wrap; } .vc-pill { margin-left:48px; }
  .vc-bar-in { flex-direction:column; align-items:stretch; gap:10px; } .vc-send { justify-content:center; }
  .vc-secure span { display:none; }
}
`;

function tamanoLegible(bytes: number | null) {
  if (!bytes) return '';
  return bytes > 1024 * 1024 ? `${(bytes / 1024 / 1024).toFixed(1)} MB` : `${Math.max(1, Math.round(bytes / 1024))} KB`;
}

function Etiqueta({ doc, bloqueado }: Readonly<{ doc: Documento; bloqueado: boolean }>) {
  if (doc.estado === 'aprobado') return <span className="vc-pill aprobado"><CheckCircle2 size={14} /> Aprobado</span>;
  if (doc.estado === 'rechazado') return <span className="vc-pill rechazado"><XCircle size={14} /> Requiere corrección</span>;
  if (doc.subido) return <span className="vc-pill cargado"><FileCheck2 size={14} /> {bloqueado ? 'En revisión' : 'Cargado'}</span>;
  return <span className="vc-pill pend"><Clock size={14} /> Pendiente</span>;
}

function TarjetaDocumento({ doc, indice, editable, token, onCambio }: Readonly<{ doc: Documento; indice: number; editable: boolean; token: string; onCambio: () => void }>) {
  const [fecha, setFecha] = useState(doc.fechaExpedicion || '');
  const [subiendo, setSubiendo] = useState(false);
  const [error, setError] = useState('');
  const [arrastrando, setArrastrando] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const hoy = new Date().toISOString().slice(0, 10);

  const aprobado = doc.estado === 'aprobado';
  const puedeEditar = editable && !aprobado;
  const clase = aprobado ? 'ok' : doc.estado === 'rechazado' ? 'bad' : '';

  async function subir(archivo: File) {
    setError('');
    if (doc.pedirFecha && !fecha) { setError(`Indica la ${(doc.etiquetaFecha || 'fecha').toLowerCase()} antes de cargar el archivo`); return; }
    setSubiendo(true);
    try {
      const form = new FormData();
      form.append('archivo', archivo);
      if (doc.pedirFecha) form.append('fechaExpedicion', fecha);
      const res = await fetch(`${API_URL}/api/vinculacion/${token}/documentos/${doc.tipo}`, { method: 'POST', body: form });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) { setError(data.mensaje || 'No pudimos cargar el documento'); return; }
      onCambio();
    } catch {
      setError('No pudimos conectar con el servidor. Revisa tu internet e intenta de nuevo.');
    } finally {
      setSubiendo(false);
      if (inputRef.current) inputRef.current.value = '';
    }
  }

  return (
    <div className={`vc-card ${clase}`}>
      <div className="vc-card-head">
        <div className="vc-num">{aprobado ? <CheckCircle2 size={18} /> : indice}</div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div className="vc-card-title">{doc.nombre}</div>
          <div className="vc-card-desc">{doc.descripcion}</div>
          <div className="vc-chips"><span className="vc-chip"><Clock size={12} /> {doc.vigencia}</span></div>
        </div>
        <Etiqueta doc={doc} bloqueado={!editable} />
      </div>

      <div className="vc-body">
        {doc.estado === 'rechazado' && doc.motivo && (
          <div className="vc-motivo"><strong>Qué corregir:</strong> {doc.motivo}</div>
        )}

        {puedeEditar && doc.pedirFecha && (
          <div className="vc-field">
            <label htmlFor={`fecha-${doc.tipo}`}>{doc.etiquetaFecha}</label>
            <input id={`fecha-${doc.tipo}`} type="date" max={hoy} value={fecha} onChange={e => { setFecha(e.target.value); setError(''); }} />
          </div>
        )}

        {doc.subido && (
          <div className="vc-file">
            <FileText size={22} color="#852EC7" />
            <div style={{ flex: 1, minWidth: 0 }}>
              <div className="vc-file-name">{doc.nombreOriginal}</div>
              <div className="vc-file-meta">
                {tamanoLegible(doc.tamano)}{doc.fechaExpedicion ? ` · ${doc.etiquetaFecha?.toLowerCase()}: ${doc.fechaExpedicion}` : ''}
              </div>
            </div>
            {puedeEditar && (
              <button className="vc-btn" disabled={subiendo} onClick={() => inputRef.current?.click()}><RefreshCw size={14} /> Reemplazar</button>
            )}
          </div>
        )}

        {puedeEditar && !doc.subido && (
          <div
            className={`vc-drop ${arrastrando ? 'over' : ''}`}
            onClick={() => inputRef.current?.click()}
            onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') inputRef.current?.click(); }}
            onDragOver={e => { e.preventDefault(); setArrastrando(true); }}
            onDragLeave={() => setArrastrando(false)}
            onDrop={e => { e.preventDefault(); setArrastrando(false); const f = e.dataTransfer.files?.[0]; if (f) subir(f); }}
            role="button" tabIndex={0}
          >
            <span style={{ display: 'flex', justifyContent: 'center' }}><UploadCloud size={26} color="#852EC7" /></span>
            <div style={{ marginTop: 6, fontSize: 14 }}>{subiendo ? 'Cargando…' : <>Arrastra el archivo aquí o <b>búscalo en tu equipo</b></>}</div>
            <small>PDF, JPG o PNG · máximo 8 MB</small>
          </div>
        )}

        {puedeEditar && (
          <input ref={inputRef} type="file" accept="application/pdf,image/jpeg,image/png" hidden onChange={e => { const f = e.target.files?.[0]; if (f) subir(f); }} />
        )}
        {error && <div className="vc-err"><AlertCircle size={16} style={{ flex: 'none', marginTop: 1 }} /> {error}</div>}
      </div>
    </div>
  );
}

// Paso final: el cliente descarga el contrato que le envió TrendPay, lo firma y sube el PDF firmado.
function PasoContrato({ token, contrato, onCambio }: Readonly<{ token: string; contrato: Contrato; onCambio: () => void }>) {
  const [abriendo, setAbriendo] = useState(false);
  const [subiendo, setSubiendo] = useState(false);
  const [arrastrando, setArrastrando] = useState(false);
  const [error, setError] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);
  const devuelto = contrato.estado === 'rechazado';

  async function descargar() {
    setError('');
    setAbriendo(true);
    const ventana = window.open('about:blank', '_blank');
    try {
      const res = await fetch(`${API_URL}/api/vinculacion/${token}/contrato`);
      const data = await res.json().catch(() => ({}));
      if (!res.ok) { ventana?.close(); setError(data.mensaje || 'No pudimos abrir el contrato'); return; }
      const destino = String(data.url).startsWith('/') ? `${API_URL}${data.url}` : data.url;
      if (ventana) { ventana.opener = null; ventana.location.href = destino; }
    } catch {
      ventana?.close();
      setError('No pudimos conectar con el servidor. Intenta de nuevo.');
    } finally {
      setAbriendo(false);
    }
  }

  async function subir(archivo: File) {
    setError('');
    setSubiendo(true);
    try {
      const form = new FormData();
      form.append('archivo', archivo);
      const res = await fetch(`${API_URL}/api/vinculacion/${token}/contrato-firmado`, { method: 'POST', body: form });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) { setError(data.mensaje || 'No pudimos cargar el contrato'); return; }
      onCambio();
    } catch {
      setError('No pudimos conectar con el servidor. Revisa tu internet e intenta de nuevo.');
    } finally {
      setSubiendo(false);
      if (inputRef.current) inputRef.current.value = '';
    }
  }

  return (
    <>
      <section className="vc-hero">
        <h1>¡Documentos aprobados! Falta firmar el contrato</h1>
        <p>Descarga el contrato, fírmalo (a mano y escaneado, o con tu firma digital) y sube el archivo firmado. Cuando lo validemos, tu vinculación quedará completa.</p>
      </section>

      <div className="vc-steps" style={{ margin: '24px auto 8px', maxWidth: 520 }}>
        <div className="vc-step done">Documentos aprobados</div>
        <div className="vc-step now">Firma del contrato</div>
        <div className="vc-step">Completada</div>
      </div>

      <div className="vc-list" style={{ marginTop: 22 }}>
        {devuelto && contrato.motivo && (
          <div className="vc-banner"><AlertCircle size={20} style={{ flex: 'none' }} />
            <div><strong>Necesitamos que corrijas el contrato firmado.</strong> {contrato.motivo}</div>
          </div>
        )}

        <div className="vc-card">
          <div className="vc-card-head">
            <div className="vc-num">1</div>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div className="vc-card-title">Descarga el contrato</div>
              <div className="vc-card-desc">{contrato.enviado?.nombre || 'Contrato de vinculación'}</div>
            </div>
            <button className="vc-btn" disabled={abriendo} onClick={descargar}><FileText size={15} /> {abriendo ? 'Abriendo…' : 'Ver contrato'}</button>
          </div>
        </div>

        <div className={`vc-card ${devuelto ? 'bad' : ''}`}>
          <div className="vc-card-head">
            <div className="vc-num">2</div>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div className="vc-card-title">Sube el contrato firmado</div>
              <div className="vc-card-desc">Debe verse la firma del representante legal en el documento.</div>
            </div>
          </div>
          <div className="vc-body">
            <div
              className={`vc-drop ${arrastrando ? 'over' : ''}`}
              onClick={() => inputRef.current?.click()}
              onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') inputRef.current?.click(); }}
              onDragOver={e => { e.preventDefault(); setArrastrando(true); }}
              onDragLeave={() => setArrastrando(false)}
              onDrop={e => { e.preventDefault(); setArrastrando(false); const f = e.dataTransfer.files?.[0]; if (f) subir(f); }}
              role="button" tabIndex={0}
            >
              <span style={{ display: 'flex', justifyContent: 'center' }}><UploadCloud size={26} color="#852EC7" /></span>
              <div style={{ marginTop: 6, fontSize: 14 }}>{subiendo ? 'Cargando…' : <>Arrastra el contrato firmado aquí o <b>búscalo en tu equipo</b></>}</div>
              <small>PDF, JPG o PNG · máximo 8 MB</small>
            </div>
            <input ref={inputRef} type="file" accept="application/pdf,image/jpeg,image/png" hidden onChange={e => { const f = e.target.files?.[0]; if (f) subir(f); }} />
            {error && <div className="vc-err"><AlertCircle size={16} style={{ flex: 'none', marginTop: 1 }} /> {error}</div>}
          </div>
        </div>
      </div>
    </>
  );
}

function Mensaje({ icono, color, titulo, texto, pasos }: Readonly<{ icono: React.ReactNode; color: string; titulo: string; texto: string; pasos?: { etiqueta: string; estado: 'done' | 'now' | 'next' }[] }>) {
  return (
    <div className="vc-center">
      <div className="vc-ico" style={{ background: `${color}1a`, color }}>{icono}</div>
      <h2>{titulo}</h2>
      <p>{texto}</p>
      {pasos && <div className="vc-steps">{pasos.map(p => <div key={p.etiqueta} className={`vc-step ${p.estado === 'next' ? '' : p.estado}`}>{p.etiqueta}</div>)}</div>}
    </div>
  );
}

export default function VinculacionPage() {
  const { token } = useParams<{ token: string }>();
  const [cargando, setCargando] = useState(true);
  const [errorCarga, setErrorCarga] = useState('');
  const [sol, setSol] = useState<Solicitud | null>(null);
  const [docs, setDocs] = useState<Documento[]>([]);
  const [contrato, setContrato] = useState<Contrato | null>(null);
  const [enviando, setEnviando] = useState(false);
  const [errorEnvio, setErrorEnvio] = useState('');

  const cargar = useCallback(async () => {
    try {
      const res = await fetch(`${API_URL}/api/vinculacion/${token}`);
      const data = await res.json().catch(() => ({}));
      if (!res.ok) { setErrorCarga(data.mensaje || 'No pudimos abrir este enlace'); return; }
      setSol(data.vinculacion);
      setDocs(data.documentos);
      setContrato(data.contrato ?? null);
      setErrorCarga('');
    } catch {
      setErrorCarga('No pudimos conectar con el servidor. Revisa tu internet e intenta de nuevo.');
    } finally {
      setCargando(false);
    }
  }, [token]);

  useEffect(() => { cargar(); }, [cargar]);

  async function enviar() {
    setEnviando(true);
    setErrorEnvio('');
    try {
      const res = await fetch(`${API_URL}/api/vinculacion/${token}/enviar`, { method: 'POST' });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) { setErrorEnvio(data.mensaje || 'No pudimos enviar tu solicitud'); return; }
      await cargar();
      window.scrollTo({ top: 0, behavior: 'smooth' });
    } catch {
      setErrorEnvio('No pudimos conectar con el servidor. Intenta de nuevo.');
    } finally {
      setEnviando(false);
    }
  }

  const requeridos = docs.filter(d => d.requerido);
  const cargados = requeridos.filter(d => d.subido && d.estado !== 'rechazado').length;
  const faltantes = requeridos.length - cargados;
  const listo = requeridos.length > 0 && faltantes === 0;
  const editable = sol?.estado === 'invitada' || sol?.estado === 'requiere_correccion';

  let contenido: React.ReactNode;
  if (cargando) {
    contenido = <Mensaje icono={<RefreshCw size={30} />} color="#852EC7" titulo="Cargando tu solicitud…" texto="Un momento, por favor." />;
  } else if (errorCarga || !sol) {
    contenido = <Mensaje icono={<AlertCircle size={32} />} color="#c0392b" titulo="No pudimos abrir este enlace" texto={errorCarga} />;
  } else if (sol.estado === 'en_revision') {
    contenido = (
      <Mensaje icono={<Clock size={32} />} color="#852EC7" titulo="Estamos revisando tus documentos"
        texto={`Recibimos la documentación de ${sol.razonSocial}; nuestro equipo la está evaluando y te avisaremos el resultado por correo. No necesitas hacer nada más.`}
        pasos={[{ etiqueta: 'Documentos recibidos', estado: 'done' }, { etiqueta: 'En evaluación', estado: 'now' }, { etiqueta: 'Resultado', estado: 'next' }]} />
    );
  } else if (sol.estado === 'aprobada' && contrato && (contrato.estado === 'enviado' || contrato.estado === 'rechazado')) {
    contenido = <PasoContrato token={token} contrato={contrato} onCambio={cargar} />;
  } else if (sol.estado === 'aprobada' && contrato?.estado === 'firmado') {
    contenido = (
      <Mensaje icono={<Clock size={32} />} color="#852EC7" titulo="Estamos validando tu contrato"
        texto={`Recibimos el contrato firmado de ${sol.razonSocial}; lo validaremos y te avisaremos por correo cuando tu vinculación quede completa.`}
        pasos={[{ etiqueta: 'Documentos aprobados', estado: 'done' }, { etiqueta: 'Contrato firmado', estado: 'now' }, { etiqueta: 'Completada', estado: 'next' }]} />
    );
  } else if (sol.estado === 'aprobada') {
    contenido = (
      <Mensaje icono={<ShieldCheck size={34} />} color="#1e8a55" titulo="¡Tus documentos fueron aprobados!"
        texto={`Los documentos de ${sol.razonSocial} fueron aprobados. En breve te enviaremos el contrato por correo para que lo firmes.`}
        pasos={[{ etiqueta: 'Documentos aprobados', estado: 'done' }, { etiqueta: 'Contrato', estado: 'now' }, { etiqueta: 'Completada', estado: 'next' }]} />
    );
  } else if (sol.estado === 'completada') {
    contenido = (
      <Mensaje icono={<ShieldCheck size={34} />} color="#1e8a55" titulo="¡Vinculación completada!"
        texto={`Validamos el contrato firmado de ${sol.razonSocial}: tu vinculación con TrendPay está completa y nuestro equipo se pondrá en contacto contigo para activar tu cuenta.`}
        pasos={[{ etiqueta: 'Documentos aprobados', estado: 'done' }, { etiqueta: 'Contrato firmado', estado: 'done' }, { etiqueta: 'Completada', estado: 'done' }]} />
    );
  } else if (sol.estado === 'rechazada') {
    contenido = (
      <Mensaje icono={<XCircle size={34} />} color="#c0392b" titulo="No pudimos continuar con la vinculación"
        texto={sol.mensaje || 'Después de revisar tu documentación no fue posible aprobar la vinculación en este momento. Puedes escribirnos para conocer más detalles.'} />
    );
  } else {
    contenido = (
      <>
        <section className="vc-hero">
          <h1>Hola {sol.contactoNombre.split(' ')[0]}, vinculemos a {sol.razonSocial}</h1>
          <p>Solo necesitas subir <strong>{requeridos.length} documentos</strong>. Nuestro equipo los revisará y te avisaremos el resultado por correo; no tienes que crear una cuenta.</p>
        </section>

        <section className="vc-progress">
          <div className="vc-progress-top"><span>Documentos cargados</span><span>{cargados} de {requeridos.length}</span></div>
          <div className="vc-bar"><div style={{ width: `${requeridos.length ? (cargados / requeridos.length) * 100 : 0}%` }} /></div>
        </section>

        {sol.estado === 'requiere_correccion' && (
          <div className="vc-banner"><AlertCircle size={20} style={{ flex: 'none' }} />
            <div><strong>Necesitamos que corrijas algunos documentos.</strong>{sol.mensaje ? ` ${sol.mensaje}` : ''} Vuelve a cargar solo los marcados en rojo y envía de nuevo.</div>
          </div>
        )}

        <div className="vc-list">
          {docs.map((d, i) => <TarjetaDocumento key={`${d.tipo}-${d.subido}-${d.estado}`} doc={d} indice={i + 1} editable={!!editable} token={token} onCambio={cargar} />)}
        </div>

        <div className="vc-priv">
          <Lock size={16} style={{ flex: 'none', marginTop: 2 }} />
          <span>Tus documentos viajan cifrados y se guardan en un almacenamiento privado. Solo el equipo de cumplimiento de TrendPay puede abrirlos, y cada consulta queda registrada.</span>
        </div>
      </>
    );
  }

  const mostrarBarra = !cargando && !errorCarga && sol && editable;

  return (
    <div className="vc-page">
      <style dangerouslySetInnerHTML={{ __html: ESTILOS }} />
      <header className="vc-top">
        <div className="vc-top-in">
          <div className="vc-brand"><img src="/tp_icon.png" alt="" /> TrendPay</div>
          <div className="vc-secure"><ShieldCheck size={16} color="#1e8a55" /> <span>Portal de vinculación · Conexión segura</span></div>
        </div>
      </header>
      <main className="vc-wrap">{contenido}</main>

      {mostrarBarra && (
        <div className="vc-bar-fixed">
          <div className="vc-bar-in">
            <div className="vc-bar-txt">
              {errorEnvio
                ? <span style={{ color: '#c0392b', fontWeight: 600 }}>{errorEnvio}</span>
                : listo ? 'Todo listo. Cuando envíes, ya no podrás modificar los documentos.' : `Te ${faltantes === 1 ? 'falta' : 'faltan'} ${faltantes} ${faltantes === 1 ? 'documento' : 'documentos'} para poder enviar.`}
            </div>
            <button className="vc-send" disabled={!listo || enviando} onClick={enviar}><Send size={17} /> {enviando ? 'Enviando…' : 'Enviar para revisión'}</button>
          </div>
        </div>
      )}
    </div>
  );
}
