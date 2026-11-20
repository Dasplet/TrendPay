'use client';
import { useQuery } from '@tanstack/react-query';
import { adminApi } from '@/lib/api';
import { Panel, PanelHeader } from '@/components/admin/ui';
import { LimpiezaDatos } from '@/components/admin/LimpiezaDatos';
import { Lock } from 'lucide-react';

function EstadoFila({ ok, titulo, detalle }: { ok?: boolean; titulo: string; detalle: string }) {
  const color = ok === undefined ? 'rgba(var(--adm-fg-rgb),.3)' : ok ? '#6CC998' : '#d4a017';
  return (
    <div style={{ display:'flex', alignItems:'center', gap:12, padding:'12px 0', borderBottom:'1px solid rgba(var(--adm-fg-rgb),.05)' }}>
      <span style={{ width:10, height:10, borderRadius:'50%', background:color, flexShrink:0 }} />
      <div style={{ flex:1 }}>
        <div style={{ fontSize:13, fontWeight:600, color:'var(--adm-text)' }}>{titulo}</div>
        <div style={{ fontSize:12, color:'rgba(var(--adm-fg-rgb),.5)' }}>{detalle}</div>
      </div>
      <span style={{ fontSize:11, fontWeight:700, color }}>{ok === undefined ? '…' : ok ? 'Activo' : 'Pendiente'}</span>
    </div>
  );
}

export default function ConfiguracionPage() {
  const { data: seg } = useQuery({ queryKey:['admin-seguridad'], queryFn:()=>adminApi.seguridadEstado(), select:d=>d.data });


  return (
    <div style={{ display:'grid', gridTemplateColumns:'1fr', gap:16 }}>
      <Panel style={{ gridColumn:'1 / -1' }}>
        <PanelHeader title="Seguridad de credenciales y archivos" icon={<Lock size={16} />} />
        <div style={{ padding:'8px 24px 16px' }}>
          <EstadoFila ok={seg?.secretosAws?.activo} titulo="Credenciales en AWS Secrets Manager"
            detalle={seg?.secretosAws?.activo ? `${seg.secretosAws.cargados} credenciales cargadas desde AWS al arrancar` : 'Siguen en las variables de Railway'} />
          <EstadoFila ok={seg?.llaveKms} titulo="Llave de cifrado protegida por AWS KMS"
            detalle={seg?.llaveKms ? 'Los datos nuevos se cifran con una llave que solo KMS puede entregar' : 'Se usa la llave antigua guardada en Railway'} />
          <EstadoFila ok={seg?.almacenamiento?.cifradoBucket === 'kms' || (seg?.almacenamiento?.modo === 'bd' && seg?.llaveKms)} titulo="Documentos de clientes cifrados"
            detalle={seg ? (seg.almacenamiento.modo === 's3' ? `Bucket privado · cifrado: ${seg.almacenamiento.cifradoBucket === 'kms' ? 'con tu llave de KMS' : seg.almacenamiento.cifradoBucket}` : `En la base de datos (${seg.almacenamiento.archivosEnBaseDeDatos} archivos)`) : 'Consultando…'} />
          <EstadoFila ok={seg ? Object.values(seg.pendientesDeMigrar as Record<string, number>).every((n) => n === 0) : undefined} titulo="Datos antiguos re-cifrados"
            detalle={seg ? (Object.values(seg.pendientesDeMigrar as Record<string, number>).every((n) => n === 0) ? 'Nada pendiente' : 'Quedan cuentas, retiros o enlaces con la llave antigua') : 'Consultando…'} />
          {(seg?.alertas || []).length > 0 && (
            <div style={{ marginTop:12, fontSize:12, color:'#d4a017', lineHeight:1.7 }}>
              {(seg.alertas as string[]).map((a) => <div key={a}>• {a}</div>)}
            </div>
          )}
        </div>
      </Panel>

      <LimpiezaDatos />
    </div>
  );
}
