'use client';
import { useQuery } from '@tanstack/react-query';
import { api } from '@/lib/api';
import { Panel, PanelHeader, Table, TR, TD, Btn, fmtDate } from '@/components/admin/ui';

const ACTION_COLORS: Record<string,{c:string,bg:string}> = {
  CAMBIO_PERFIL:             { c:'#852EC7', bg:'rgba(133,46,199,.15)' },
  CAMBIO_PIN:                { c:'#d4a017', bg:'rgba(212,160,23,.15)'  },
  CUENTA_BANCARIA_AGREGADA:  { c:'#6CC998', bg:'rgba(108,201,152,.15)' },
  CUENTA_BANCARIA_ELIMINADA: { c:'#C0392B', bg:'rgba(192,57,43,.15)'   },
};
const CAMPO_LABELS: Record<string,string> = { nombre:'Nombre', correo:'Correo', celular:'Celular', ciudad:'Ciudad', pin:'PIN', banco:'Banco' };
const ACTION_LABELS: Record<string,string> = { CAMBIO_PERFIL:'Cambio de perfil', CAMBIO_PIN:'Cambio de PIN', CUENTA_BANCARIA_AGREGADA:'Cuenta añadida', CUENTA_BANCARIA_ELIMINADA:'Cuenta eliminada' };

export default function AuditoriaUsuariosPage() {
  const { data, isLoading, refetch } = useQuery({
    queryKey: ['audit-users'],
    queryFn: () => api.get('/user-audit/admin?limit=100'),
    select: d => d.data,
    refetchInterval: 15000,
  });

  const logs: any[] = data?.logs || [];
  const needsMigration = data?._info;

  return (
    <Panel>
      <PanelHeader title={`${logs.length} cambios registrados`} icon="◉"
        actions={
          <>
            <span style={{ fontSize:11, color:'rgba(255,255,255,.35)' }}>Actualización automática cada 15s</span>
            <Btn variant="ghost" onClick={() => refetch()}>↺ Actualizar</Btn>
            <Btn variant="ghost">⬇ CSV</Btn>
          </>
        }
      />

      {needsMigration && (
        <div style={{ margin:'12px 16px', background:'rgba(212,160,23,.08)', border:'1px solid rgba(212,160,23,.25)', borderRadius:10, padding:'14px 18px', color:'#d4a017', fontSize:13 }}>
          ⚠ La tabla de auditoría no existe aún. Ejecuta: <code style={{ background:'rgba(0,0,0,.3)', padding:'2px 8px', borderRadius:6, fontFamily:'monospace' }}>npm run migrate-v2</code>
        </div>
      )}

      <div style={{ padding:'0 16px 10px', fontSize:11, color:'rgba(255,255,255,.35)' }}>
        Registra cambios en perfiles, PINs y cuentas bancarias. Las fotos de perfil no se registran.
      </div>

      <Table headers={['Acción','Campo','Valor anterior','Valor nuevo','Usuario','Cédula','Fecha y hora']}>
        {isLoading ? (
          <TR><TD style={{ textAlign:'center', padding:32, color:'rgba(255,255,255,.3)' }} colSpan={7 as any}>Cargando...</TD></TR>
        ) : logs.length === 0 ? (
          <TR><TD style={{ textAlign:'center', padding:36, color:'rgba(255,255,255,.3)' }} colSpan={7 as any}>
            Sin cambios registrados aún.<br />
            <span style={{ fontSize:12, opacity:.7 }}>Edita el perfil de un usuario para ver los cambios aquí.</span>
          </TD></TR>
        ) : logs.map((l:any) => {
          const ac = ACTION_COLORS[l.accion] || { c:'#AE93AA', bg:'rgba(174,147,170,.15)' };
          const isPIN = l.campo === 'pin';
          return (
            <TR key={l.id}>
              <TD><span style={{ background:ac.bg, color:ac.c, padding:'3px 8px', borderRadius:6, fontSize:11, fontWeight:600, whiteSpace:'nowrap' }}>{ACTION_LABELS[l.accion]||l.accion}</span></TD>
              <TD style={{ fontSize:12, fontWeight:600, color:'rgba(255,255,255,.7)' }}>{CAMPO_LABELS[l.campo]||l.campo||'—'}</TD>
              <TD style={{ fontSize:12, color:'rgba(255,255,255,.4)', fontFamily:isPIN?'inherit':'monospace' }}>{isPIN?'••••':(l.valorAntes||l.valor_antes||'—')}</TD>
              <TD style={{ fontSize:12, color:'rgba(255,255,255,.8)', fontFamily:isPIN?'inherit':'monospace' }}>{isPIN?'••••':(l.valorDespues||l.valor_despues||'—')}</TD>
              <TD style={{ fontSize:12, fontWeight:600, color:'#fff' }}>{l.usuario_nombre||'—'}</TD>
              <TD style={{ fontFamily:'monospace', fontSize:11, color:'rgba(255,255,255,.4)' }}>{l.usuario_cedula||'—'}</TD>
              <TD style={{ fontSize:11, color:'rgba(255,255,255,.35)', whiteSpace:'nowrap' }}>{fmtDate(l.createdAt||l.created_at)}</TD>
            </TR>
          );
        })}
      </Table>
    </Panel>
  );
}
