'use client';
import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { adminApi } from '@/lib/api';
import { Panel, Table, Tr, Td, StatusBadge, fmt, fmtDate } from '@/components/admin/ui';
import {
  ACCENT, ACCENT_L, AlertItem, AMBER, BarRow, BLUE, clamp, GREEN, KpiRing, LinkPill, PanelTitle, RED, StatStrip,
  type NivelAlerta,
} from '@/components/admin/dash';
import { AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer } from 'recharts';

// Periodos que se pueden ver (los mismos que entiende el servidor)
const PERIODOS = [
  { clave: 'hoy', label: 'Hoy' }, { clave: 'ayer', label: 'Ayer' }, { clave: '7d', label: 'Últimos 7 días' }, { clave: '15d', label: 'Últimos 15 días' },
  { clave: '1m', label: 'Último mes' }, { clave: '3m', label: 'Últimos 3 meses' }, { clave: '6m', label: 'Últimos 6 meses' },
  { clave: '12m', label: 'Últimos 12 meses (año)' }, { clave: 'todo', label: 'Todas las operaciones' },
] as const;

const TIPOS = [
  { clave: 'consigna', label: 'Consignaciones', color: ACCENT_L },
  { clave: 'cobro', label: 'Cobros QR', color: GREEN },
  { clave: 'envio', label: 'Envíos', color: BLUE },
  { clave: 'retiro', label: 'Retiros', color: RED },
  { clave: 'datafono', label: 'Datáfonos', color: AMBER },
  { clave: 'web', label: 'Página web', color: ACCENT },
] as const;

// Todas las consultas del dashboard se refrescan solas (tiempo real) y al volver a la pestaña
const VIVO = { refetchInterval: 15_000, refetchOnWindowFocus: true } as const;
const num = (v: any) => Number.parseFloat(v) || 0;
const pct = (a: number, b: number) => (b > 0 ? (a / b) * 100 : 0);

function fmtAxis(v: number) {
  if (v >= 1000000) return `$${(v / 1000000).toFixed(1)}M`;
  if (v >= 1000) return `$${Math.round(v / 1000)}k`;
  return '$0';
}

function ChartTooltip({ active, payload, label }: any) {
  if (!active || !payload?.length) return null;
  return (
    <div style={{ background: 'rgba(20,10,50,.97)', border: '1px solid rgba(133,46,199,.35)', borderRadius: 10, padding: '10px 14px', fontSize: 12 }}>
      <div style={{ color: 'var(--adm-muted)', marginBottom: 6 }}>{label}</div>
      {payload.map((p: any) => <div key={p.name} style={{ color: p.color, fontWeight: 600 }}>{p.name}: {fmt(p.value || 0)}</div>)}
    </div>
  );
}

function diasDesde(fecha: string) {
  return Math.floor((Date.now() - new Date(fecha).getTime()) / 86_400_000);
}

export default function AdminDashboard() {
  const [period, setPeriod] = useState('todo');
  const periodoLabel = PERIODOS.find((p) => p.clave === period)?.label ?? '';
  const { data: metricsData } = useQuery({ queryKey: ['admin-metrics', period], queryFn: () => adminApi.metrics(period), select: (d) => d.data, ...VIVO });
  const { data: txData } = useQuery({ queryKey: ['admin-tx', period], queryFn: () => adminApi.transactions({ limit: 7, periodo: period }), select: (d) => d.data, ...VIVO });
  const { data: usersData } = useQuery({ queryKey: ['admin-users'], queryFn: () => adminApi.users({ limit: 200 }), select: (d) => d.data, ...VIVO });
  const { data: chartData } = useQuery({ queryKey: ['admin-chart', period], queryFn: () => adminApi.chart(period), select: (d) => d.data, ...VIVO });
  const { data: pendData } = useQuery({ queryKey: ['admin-pending'], queryFn: () => adminApi.pending(), select: (d) => d.data, ...VIVO });
  const { data: retirosData } = useQuery({ queryKey: ['admin-retiros-all'], queryFn: () => adminApi.withdrawalsAll(), select: (d) => d.data, ...VIVO });
  const { data: kushkiData } = useQuery({ queryKey: ['admin-kushki-pagos', '', period], queryFn: () => adminApi.kushkiPagos({ periodo: period }), select: (d) => d.data, ...VIVO });

  const m = metricsData?.metricas || {};
  const txs: any[] = txData?.transacciones || [];
  const users: any[] = usersData?.usuarios || [];
  const pendientes: any[] = pendData?.retiros || [];
  const retiros: any[] = retirosData?.retiros || [];
  const pagos: any[] = kushkiData?.pagos || [];
  const totalesKushki: Array<{ estado: string; cantidad: number; monto: number }> = kushkiData?.totales || [];

  // ── KPIs ──
  const operaciones = num(m.operaciones);
  const exitosas = num(m.operaciones_exitosas);
  const volumen = num(m.total_volumen);
  const comisiones = num(m.total_comisiones);
  const comisionPct = num(m.comision_pct) || 3;
  const tasaEfectiva = pct(comisiones, volumen);
  const verificados = users.filter((u) => u.rol !== 'admin' && u.kycVerificado).length;
  const kushkiEstado = (e: string) => totalesKushki.find((t) => t.estado === e) || { estado: e, cantidad: 0, monto: 0 };
  const kOk = kushkiEstado('completado');
  const kPend = kushkiEstado('pendiente');
  const kRech = kushkiEstado('rechazado');

  // Las subcuentas muestran el saldo de su padre: contar solo titulares evita sumar la misma billetera varias veces.
  const clientes = users.filter((u) => u.rol !== 'admin');
  const titulares = clientes.filter((u) => !u.cuentaPadre);
  // El saldo y el número de billeteras vienen del servidor (suma real de todas las billeteras)
  const totalSaldo = m.saldo_plataforma === undefined ? titulares.reduce((s, u) => s + num(u.saldo), 0) : num(m.saldo_plataforma);
  const numBilleteras = m.billeteras ?? titulares.length;
  const subcuentas = clientes.length - titulares.length;

  // ── Operaciones por tipo ──
  const porTipo = TIPOS.map((t) => ({ ...t, cantidad: num(m.por_tipo?.[t.clave]?.cantidad), monto: num(m.por_tipo?.[t.clave]?.monto) }));
  const maxTipo = Math.max(...porTipo.map((t) => t.monto), 1);
  const topTipo = [...porTipo].sort((a, b) => b.monto - a.monto)[0];
  const consignado = porTipo.find((t) => t.clave === 'consigna')?.monto ?? 0;

  // ── Serie de la gráfica (la agrupa el servidor por hora, día, semana o mes según el periodo) ──
  const serie: { name: string; vol: number; com: number }[] = (chartData?.datos || []).map((d: any) => ({ name: d.etiqueta, vol: d.volumen, com: d.comisiones }));
  const stepX = Math.max(0, Math.ceil(serie.length / 10) - 1);
  const agrupadoPor: Record<string, string> = { hora: 'hora', dia: 'día', semana: 'semana', mes: 'mes' };

  // ── Consignaciones Kushki por canal ──
  const canales = (['tarjeta', 'pse'] as const).map((metodo) => {
    const lista = pagos.filter((p) => p.metodo === metodo);
    const ok = lista.filter((p) => p.estado === 'completado');
    const resueltos = lista.filter((p) => p.estado !== 'pendiente').length;
    return {
      metodo, total: lista.length, monto: ok.reduce((s, p) => s + num(p.monto), 0),
      aprobacion: pct(ok.length, resueltos), color: metodo === 'tarjeta' ? ACCENT_L : BLUE,
    };
  });
  const maxCanal = Math.max(...canales.map((c) => c.monto), 1);
  const totalKushki = kOk.cantidad + kPend.cantidad + kRech.cantidad;

  // ── Alertas calculadas con datos reales ──
  const alertas: Array<{ nivel: NivelAlerta; titulo: string; detalle: string; href?: string }> = [];
  if (pendientes.length > 0) {
    const masVieja = Math.max(...pendientes.map((r) => diasDesde(r.created_at)));
    const monto = pendientes.reduce((s, r) => s + num(r.monto), 0);
    alertas.push({
      nivel: masVieja >= 2 ? 'danger' : 'warn', titulo: `${pendientes.length} retiro${pendientes.length > 1 ? 's' : ''} por aprobar`,
      detalle: `${fmt(monto)} en espera${masVieja >= 1 ? ` · el más antiguo lleva ${masVieja} día${masVieja > 1 ? 's' : ''}` : ''}.`, href: '/admin/retiros',
    });
  }
  if (kPend.cantidad > 0) {
    alertas.push({ nivel: 'info', titulo: `${kPend.cantidad} pago${kPend.cantidad > 1 ? 's' : ''} Kushki pendiente${kPend.cantidad > 1 ? 's' : ''}`, detalle: `${fmt(kPend.monto)} esperando confirmación del banco. La conciliación corre cada 5 minutos.`, href: '/admin/pagos-kushki' });
  }
  const resueltosK = kOk.cantidad + kRech.cantidad;
  if (resueltosK >= 5 && pct(kRech.cantidad, resueltosK) > 30) {
    alertas.push({ nivel: 'warn', titulo: 'Muchos pagos Kushki rechazados', detalle: `${Math.round(pct(kRech.cantidad, resueltosK))}% de los pagos resueltos fueron rechazados.`, href: '/admin/pagos-kushki' });
  }
  const bloqueados = users.filter((u) => u.bloqueado).length;
  if (bloqueados > 0) alertas.push({ nivel: 'warn', titulo: `${bloqueados} cuenta${bloqueados > 1 ? 's' : ''} bloqueada${bloqueados > 1 ? 's' : ''}`, detalle: 'Bloqueadas por intentos fallidos de PIN o por un administrador.', href: '/admin/usuarios' });
  if (alertas.length === 0) alertas.push({ nivel: 'ok', titulo: 'Todo al día', detalle: 'No hay retiros pendientes, pagos por confirmar ni cuentas bloqueadas.' });

  const nuevos7d = users.filter((u) => u.createdAt && Date.now() - new Date(u.createdAt).getTime() < 7 * 86_400_000).length;
  const ticket = operaciones ? volumen / operaciones : 0;

  const grid = (min: number) => ({ display: 'grid', gridTemplateColumns: `repeat(auto-fit, minmax(${min}px, 1fr))`, gap: 14 } as const);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 10 }}>
        <div style={{ fontSize: 12, color: 'var(--adm-muted)' }}>Resumen operativo · {periodoLabel} · se actualiza solo cada 15 segundos</div>
        <select value={period} onChange={(e) => setPeriod(e.target.value)} aria-label="Periodo a mostrar"
          style={{ width: 210, background: 'var(--adm-panel)', border: '1px solid rgba(133,46,199,.3)', borderRadius: 10, padding: '7px 12px', fontSize: 12, color: 'var(--adm-text)', cursor: 'pointer' }}>
          {PERIODOS.map((p) => <option key={p.clave} value={p.clave}>{p.label}</option>)}
        </select>
      </div>

      {/* KPIs */}
      <div className="adm-kpis">
        <KpiRing title="Volumen procesado" value={fmt(volumen)} ringPct={pct(exitosas, operaciones)} ringLabel={`${Math.round(pct(exitosas, operaciones))}%`}
          color={ACCENT_L} sub={`${exitosas} de ${operaciones} operaciones exitosas`} />
        <KpiRing title="Comisiones cobradas" value={fmt(comisiones)} ringPct={pct(tasaEfectiva, comisionPct)} ringLabel={`${tasaEfectiva.toFixed(1)}%`}
          color={GREEN} sub={`Tasa efectiva · general ${comisionPct}% · datáfonos ${m.comision_datafono_pct ?? 0}%`} />
        <KpiRing title="Clientes" value={String(clientes.length)} ringPct={pct(verificados, clientes.length)} ringLabel={`${Math.round(pct(verificados, clientes.length))}%`}
          color={BLUE} sub={`${verificados} verificados${subcuentas ? ` · ${subcuentas} sede${subcuentas > 1 ? 's' : ''}` : ''}`} />
        <KpiRing title="Retiros pendientes" value={String(m.retiros_pendientes ?? pendientes.length)} ringPct={pct(m.retiros_pendientes ?? pendientes.length, retiros.length)} ringLabel={String(m.retiros_pendientes ?? pendientes.length)}
          color={AMBER} sub={(m.retiros_pendientes ?? pendientes.length) ? 'Esperan aprobación' : 'Al día'} subColor={(m.retiros_pendientes ?? pendientes.length) ? AMBER : GREEN} />
        <KpiRing title="Pagos Kushki" value={fmt(kOk.monto)} ringPct={pct(kOk.cantidad, resueltosK)} ringLabel={`${Math.round(pct(kOk.cantidad, resueltosK))}%`}
          color={ACCENT} sub={`Aprobación · ${totalKushki} pagos`} />
        <KpiRing title="Saldo en plataforma" value={fmt(totalSaldo)} ringPct={pct(totalSaldo, consignado)} ringLabel={`${Math.round(clamp(pct(totalSaldo, consignado)))}%`}
          color={BLUE} sub={`${numBilleteras} billetera${numBilleteras === 1 ? '' : 's'} · del dinero consignado`} />
      </div>

      {/* Operaciones, gráfica y canales */}
      <div style={grid(320)}>
        <Panel>
          <PanelTitle title="Operaciones por tipo" sub={`Volumen de ${operaciones} transacciones · ${periodoLabel}`} />
          <div style={{ padding: '14px 20px 8px' }}>
            {porTipo.map((t) => (
              <BarRow key={t.clave} label={t.label} value={fmt(t.monto)} pct={pct(t.monto, maxTipo)} color={t.color}
                sub={`${t.cantidad} operaciones · ${Math.round(pct(t.monto, porTipo.reduce((s, x) => s + x.monto, 0)))}% del volumen`} />
            ))}
          </div>
        </Panel>

        <Panel style={{ gridColumn: 'span 2', minWidth: 0 }}>
          <PanelTitle title="Volumen vs comisiones" sub={`Dinero movido y comisiones cobradas · ${periodoLabel} · por ${agrupadoPor[chartData?.granularidad] ?? "día"}`} />
          <div style={{ padding: '8px 14px 10px', height: 300 }}>
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={serie} margin={{ top: 10, right: 16, left: 6, bottom: 4 }}>
                <defs>
                  <linearGradient id="gVol" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor={ACCENT_L} stopOpacity={0.55} /><stop offset="100%" stopColor={ACCENT_L} stopOpacity={0.02} /></linearGradient>
                  <linearGradient id="gCom" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor={GREEN} stopOpacity={0.5} /><stop offset="100%" stopColor={GREEN} stopOpacity={0.02} /></linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" stroke="rgba(var(--adm-fg-rgb),.06)" />
                <XAxis dataKey="name" tick={{ fill: 'rgba(var(--adm-muted-rgb),.7)', fontSize: 10 }} axisLine={false} tickLine={false} interval={stepX} />
                <YAxis tickFormatter={fmtAxis} tick={{ fill: 'rgba(var(--adm-muted-rgb),.7)', fontSize: 10 }} axisLine={false} tickLine={false} />
                <Tooltip content={<ChartTooltip />} />
                <Legend wrapperStyle={{ fontSize: 11, paddingTop: 6 }} />
                <Area type="monotone" dataKey="vol" name="Volumen" stroke={ACCENT_L} strokeWidth={2.5} fill="url(#gVol)" connectNulls={false} />
                <Area type="monotone" dataKey="com" name="Comisiones" stroke={GREEN} strokeWidth={2} fill="url(#gCom)" connectNulls={false} />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        </Panel>
      </div>

      <div style={grid(320)}>
        <Panel>
          <PanelTitle title="Consignaciones por canal" sub={`Tarjeta vs PSE · ${periodoLabel}`} action={<LinkPill href="/admin/pagos-kushki">Ver pagos →</LinkPill>} />
          <div style={{ padding: '14px 20px 8px' }}>
            {canales.map((c) => (
              <BarRow key={c.metodo} label={c.metodo === 'pse' ? 'PSE (débito bancario)' : 'Tarjeta'} value={fmt(c.monto)} pct={pct(c.monto, maxCanal)} color={c.color}
                sub={`${c.total} pagos · aprobación ${Math.round(c.aprobacion)}%`} />
            ))}
          </div>
        </Panel>

        <Panel>
          <PanelTitle title="Estado de los pagos" sub={`Distribución de los pagos Kushki · ${periodoLabel}`} />
          <div style={{ padding: '14px 20px 8px' }}>
            <BarRow label="Completados" value={`${Math.round(pct(kOk.cantidad, totalKushki))}%`} pct={pct(kOk.cantidad, totalKushki)} color={GREEN} sub={`${kOk.cantidad} pagos · ${fmt(kOk.monto)}`} />
            <BarRow label="Pendientes" value={`${Math.round(pct(kPend.cantidad, totalKushki))}%`} pct={pct(kPend.cantidad, totalKushki)} color={AMBER} sub={`${kPend.cantidad} pagos · ${fmt(kPend.monto)}`} />
            <BarRow label="Rechazados" value={`${Math.round(pct(kRech.cantidad, totalKushki))}%`} pct={pct(kRech.cantidad, totalKushki)} color={RED} sub={`${kRech.cantidad} pagos`} />
          </div>
        </Panel>

        <Panel>
          <PanelTitle title="Alertas" sub="Calculadas con los datos de ahora" />
          <div style={{ padding: '4px 20px 10px' }}>
            {alertas.map((a) => <AlertItem key={a.titulo} {...a} />)}
          </div>
        </Panel>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(340px, 1fr))', gap: 14 }}>
        <Panel style={{ gridColumn: 'span 2', minWidth: 0 }}>
          <PanelTitle title="Transacciones recientes" sub={`Los últimos movimientos de la plataforma · ${periodoLabel}`} action={<LinkPill href="/admin/transacciones">Ver todas →</LinkPill>} />
          <div style={{ paddingTop: 8 }}>
            <Table headers={['Referencia', 'Descripción', 'Usuario', 'Monto', 'Estado', 'Fecha']}>
              {txs.length === 0 ? (
                <Tr><Td style={{ textAlign: 'center', padding: 32, color: 'rgba(var(--adm-fg-rgb),.3)' }} colSpan={6 as any}>Sin transacciones en este periodo</Td></Tr>
              ) : txs.slice(0, 7).map((t) => (
                <Tr key={t.id}>
                  <Td style={{ fontFamily: 'monospace', fontSize: 11, color: 'rgba(var(--adm-fg-rgb),.4)' }}>{(t.codigo || '—').slice(0, 14)}</Td>
                  <Td style={{ fontSize: 12, maxWidth: 240, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{t.descripcion}</Td>
                  <Td style={{ fontSize: 12, color: 'rgba(var(--adm-fg-rgb),.65)' }}>{(t.usuario_nombre || '—').split(' ')[0]}</Td>
                  <Td style={{ fontWeight: 700, color: num(t.monto_neto) >= 0 ? GREEN : RED }}>{fmt(t.monto_neto || 0)}</Td>
                  <Td><StatusBadge status={t.status} /></Td>
                  <Td style={{ fontSize: 11, color: 'rgba(var(--adm-fg-rgb),.4)', whiteSpace: 'nowrap' }}>{fmtDate(t.created_at)}</Td>
                </Tr>
              ))}
            </Table>
          </div>
        </Panel>

        <Panel>
          <PanelTitle title="Saldos en plataforma" sub={`${titulares.length} billeteras · sin contar subcuentas dos veces`} />
          <div style={{ padding: '10px 20px 12px' }}>
            <div style={{ fontSize: 26, fontWeight: 900, color: 'var(--adm-text)', letterSpacing: '-.5px', marginBottom: 14 }}>{fmt(totalSaldo)}</div>
            {[...titulares].sort((a, b) => num(b.saldo) - num(a.saldo)).slice(0, 6).map((u, i) => (
              <BarRow key={u.id} label={u.nombre?.split(' ').slice(0, 2).join(' ') || '—'} value={fmt(num(u.saldo))} pct={pct(num(u.saldo), totalSaldo)}
                color={[ACCENT_L, GREEN, BLUE, AMBER, RED, ACCENT][i % 6]} />
            ))}
          </div>
        </Panel>
      </div>

      <StatStrip items={[
        { label: 'Saldo total en plataforma', value: fmt(totalSaldo) },
        { label: 'Ticket promedio', value: fmt(Math.round(ticket)) },
        { label: 'Tipo con más volumen', value: topTipo && topTipo.monto > 0 ? `${topTipo.label} (${fmt(topTipo.monto)})` : '—', color: ACCENT_L },
        { label: 'Usuarios nuevos · 7 días', value: String(nuevos7d), color: GREEN },
      ]} />
    </div>
  );
}
