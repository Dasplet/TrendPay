'use client';
import { useState } from 'react';
import toast from 'react-hot-toast';
import { adminApi, api } from '@/lib/api';
import { downloadCsv } from '@/lib/exportCsv';
import { Panel, PanelHeader, Btn, fmtDate } from '@/components/admin/ui';
import {
  ArrowLeftRight, Users, CircleDollarSign, Share2, Banknote,
  FileWarning, FileText, Activity, Wallet, FileDown, ShieldCheck, FileSpreadsheet,
  type LucideIcon,
} from 'lucide-react';

const EXPORTS: { icon: LucideIcon; label: string; desc: string; period: string }[] = [
  { icon:ArrowLeftRight, label:'Transacciones — Mes actual',  desc:'Solo las TX del mes en curso',         period:'current' },
  { icon:ArrowLeftRight, label:'Transacciones — 6 meses',     desc:'Últimos 6 meses de operaciones',        period:'6m'     },
  { icon:ArrowLeftRight, label:'Transacciones — 12 meses',    desc:'Historial del último año',              period:'12m'    },
  { icon:Users,          label:'Lista de usuarios',            desc:'Datos, saldos y KYC de todos',          period:'users'  },
  { icon:CircleDollarSign, label:'Reporte de comisiones',      desc:'Comisiones generadas por período',      period:'com'    },
  { icon:Share2,         label:'Referidos',                    desc:'Relaciones de referido y comisiones',   period:'ref'    },
  { icon:Banknote,       label:'Cola de retiros',              desc:'Retiros pendientes y procesados',       period:'wd'     },
];

const REGULATORY: { icon: LucideIcon; label: string; desc: string; color: string; period: string }[] = [
  { icon:FileWarning, label:'Informe UIAF mensual',  desc:'Operaciones inusuales · Superfinanciera', color:'#C0392B', period:'uiaf' },
  { icon:FileText,     label:'Declaración DIAN',      desc:'Compatibilidad tributaria',               color:'#d4a017', period:'dian' },
  { icon:Activity,     label:'Informe de actividad',  desc:'Resumen operacional del período',         color:'#852EC7', period:'current' },
  { icon:Wallet,       label:'Reporte de saldos',     desc:'Saldos totales en plataforma',            color:'#6CC998', period:'saldos' },
];

export default function ReportesPage() {
  const [loading, setLoading] = useState<string | null>(null);

  async function exportReport(period: string, label: string) {
    if (period === 'dian') {
      toast.error('La declaración DIAN requiere preparación contable manual — no se genera automáticamente');
      return;
    }
    if (period === 'uiaf') {
      toast.error('El informe UIAF requiere criterios de operación inusual definidos por tu oficial de cumplimiento — usa "Transacciones" como punto de partida');
      return;
    }

    setLoading(period + label);
    try {
      let headers: string[] = [];
      let rows: unknown[][] = [];

      if (period === 'current' || period === '6m' || period === '12m') {
        const { data } = await adminApi.transactions({ limit: 1000 });
        let txs: any[] = data?.transacciones || [];
        const now = new Date();
        if (period === 'current') {
          txs = txs.filter((t: any) => {
            const d = new Date(t.created_at);
            return d.getFullYear() === now.getFullYear() && d.getMonth() === now.getMonth();
          });
        } else {
          const months = period === '6m' ? 6 : 12;
          const cutoff = new Date(now.getFullYear(), now.getMonth() - months + 1, 1);
          txs = txs.filter((t: any) => new Date(t.created_at) >= cutoff);
        }
        headers = ['Referencia', 'Descripción', 'Usuario', 'Monto', 'Comisión', 'Estado', 'Fecha'];
        rows = txs.map((t: any) => [t.codigo || '', t.descripcion || '', t.usuario_nombre || '', t.monto_neto || 0, t.comision_valor || 0, t.status || '', fmtDate(t.created_at)]);
      } else if (period === 'users') {
        const { data } = await adminApi.users({ limit: 1000 });
        const users: any[] = data?.usuarios || [];
        headers = ['Nombre', 'Correo', 'Cédula', 'Rol', 'Saldo', 'KYC', 'Estado'];
        rows = users.map((u: any) => [u.nombre, u.correo, u.cedula, u.rol === 'admin' ? 'Admin' : 'Usuario', u.saldo || 0, u.kycNivel || u.kyc_nivel || 1, u.bloqueado ? 'Bloqueado' : 'Activo']);
      } else if (period === 'saldos') {
        const { data } = await adminApi.users({ limit: 1000 });
        const users: any[] = data?.usuarios || [];
        headers = ['Nombre', 'Cédula', 'Saldo'];
        rows = users.map((u: any) => [u.nombre, u.cedula, u.saldo || 0]);
      } else if (period === 'com') {
        const { data } = await adminApi.transactions({ limit: 1000 });
        const txs: any[] = data?.transacciones || [];
        const bycat: Record<string, number> = {};
        txs.forEach((t: any) => { const cat = t.categoria || 'otros'; bycat[cat] = (bycat[cat] || 0) + parseFloat(t.comision_valor || 0); });
        headers = ['Categoría', 'Comisión total'];
        rows = Object.entries(bycat).map(([cat, val]) => [cat, val]);
      } else if (period === 'ref') {
        const { data } = await api.get('/referrals/admin?limit=1000');
        const referidos: any[] = data?.referidos || [];
        headers = ['Referidor', 'Cédula referidor', 'Referido', 'Cédula referido', 'Comisión', 'Estado', 'Fecha'];
        rows = referidos.map((r: any) => [r.referidor_nombre || '', r.referidor_cedula || '', r.referido_nombre || '', r.referido_cedula || '', r.comision_valor || 1000, r.status || '', fmtDate(r.created_at)]);
      } else if (period === 'wd') {
        const { data } = await adminApi.withdrawalsAll();
        const retiros: any[] = data?.retiros || [];
        headers = ['Banco', 'Titular', 'Usuario', 'Monto', 'Estado', 'Fecha'];
        rows = retiros.map((w: any) => [w.banco_nombre || '', w.nombre_titular || '', w.usuario_nombre || '', w.monto || 0, w.status || '', fmtDate(w.created_at)]);
      }

      if (rows.length === 0) {
        toast.error('No hay datos para exportar en este período');
        return;
      }
      downloadCsv(label, headers, rows);
    } catch {
      toast.error('No se pudo generar el reporte');
    } finally {
      setLoading(null);
    }
  }

  return (
    <div style={{ display:'grid', gridTemplateColumns:'1.4fr 1fr', gap:16 }}>

      {/* Exports */}
      <Panel>
        <PanelHeader title="Exportación de datos" icon={<FileDown size={16} />} />
        <div style={{ padding:'8px 0' }}>
          {EXPORTS.map(e => (
            <div key={e.label} style={{ display:'flex', alignItems:'center', gap:14, padding:'14px 20px', borderBottom:'1px solid rgba(var(--adm-fg-rgb),.04)' }}>
              <div style={{ width:36, height:36, borderRadius:10, background:'rgba(133,46,199,.15)', display:'flex', alignItems:'center', justifyContent:'center', color:'#852EC7', flexShrink:0 }}>
                <e.icon size={18} />
              </div>
              <div style={{ flex:1 }}>
                <div style={{ fontSize:13, fontWeight:600, color:'var(--adm-text)', marginBottom:2 }}>{e.label}</div>
                <div style={{ fontSize:11, color:'var(--adm-muted)' }}>{e.desc}</div>
              </div>
              <div style={{ display:'flex', gap:6 }}>
                <Btn variant="ghost" disabled={loading === e.period + e.label} onClick={() => exportReport(e.period, e.label)} style={{ fontSize:11, padding:'5px 10px' }}><FileText size={12} /> CSV</Btn>
                <Btn variant="ghost" disabled={loading === e.period + e.label} onClick={() => exportReport(e.period, e.label)} style={{ fontSize:11, padding:'5px 10px' }}><FileSpreadsheet size={12} /> Excel</Btn>
              </div>
            </div>
          ))}
        </div>
      </Panel>

      {/* Regulatory */}
      <Panel>
        <PanelHeader title="Reportes regulatorios" icon={<ShieldCheck size={16} />} />
        <div style={{ padding:'8px 0' }}>
          {REGULATORY.map(r => (
            <div key={r.label} style={{ display:'flex', alignItems:'center', gap:12, padding:'14px 20px', borderBottom:'1px solid rgba(var(--adm-fg-rgb),.04)' }}>
              <div style={{ width:36, height:36, borderRadius:10, background:`${r.color}20`, display:'flex', alignItems:'center', justifyContent:'center', color:r.color, flexShrink:0 }}>
                <r.icon size={18} />
              </div>
              <div style={{ flex:1 }}>
                <div style={{ fontSize:13, fontWeight:600, color:'var(--adm-text)', marginBottom:2 }}>{r.label}</div>
                <div style={{ fontSize:11, color:'var(--adm-muted)' }}>{r.desc}</div>
              </div>
              <div style={{ display:'flex', gap:6 }}>
                <Btn variant="ghost" disabled={loading === r.period + r.label} onClick={() => exportReport(r.period, r.label)} style={{ fontSize:11, padding:'5px 10px' }}><FileText size={12} /> CSV</Btn>
                <Btn variant="ghost" disabled={loading === r.period + r.label} onClick={() => exportReport(r.period, r.label)} style={{ fontSize:11, padding:'5px 10px' }}><FileSpreadsheet size={12} /> Excel</Btn>
              </div>
            </div>
          ))}
        </div>
      </Panel>
    </div>
  );
}
