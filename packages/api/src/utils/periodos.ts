// Periodos del dashboard del administrador. Todo se calcula en hora de Colombia (UTC−5, sin horario de verano):
// "hoy" empieza a las 00:00 de Bogotá, no del servidor.

export const PERIODOS = ['hoy', 'ayer', '7d', '15d', '1m', '3m', '6m', '12m', 'todo'] as const;
export type Periodo = (typeof PERIODOS)[number];

export const ETIQUETA_PERIODO: Record<Periodo, string> = {
  hoy: 'Hoy', ayer: 'Ayer', '7d': 'Últimos 7 días', '15d': 'Últimos 15 días', '1m': 'Último mes',
  '3m': 'Últimos 3 meses', '6m': 'Últimos 6 meses', '12m': 'Últimos 12 meses (año)', todo: 'Todas las operaciones',
};

const OFFSET_MS = 5 * 3_600_000;
const HORA = 3_600_000;
const DIA = 86_400_000;
const MESES = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic'];

export const esPeriodo = (v: unknown): v is Periodo => typeof v === 'string' && (PERIODOS as readonly string[]).includes(v);

// Lo que llegue mal escrito (o nada) se trata como "todas las operaciones", que es lo que mostraba el panel antes de los filtros
export const periodoDe = (v: unknown): Periodo => (esPeriodo(v) ? v : 'todo');

// Medianoche (hora de Colombia) del día de `t`, como instante real
const inicioDeDia = (t: number) => Math.floor((t - OFFSET_MS) / DIA) * DIA + OFFSET_MS;

function mesesAtras(inicioHoy: number, meses: number): number {
  const local = new Date(inicioHoy - OFFSET_MS); // la "hora de pared" de Colombia leída en UTC
  const dia = local.getUTCDate();
  const objetivo = new Date(Date.UTC(local.getUTCFullYear(), local.getUTCMonth() - meses, 1));
  const ultimoDelMes = new Date(Date.UTC(objetivo.getUTCFullYear(), objetivo.getUTCMonth() + 1, 0)).getUTCDate();
  objetivo.setUTCDate(Math.min(dia, ultimoDelMes));
  return objetivo.getTime() + OFFSET_MS;
}

export interface Rango { periodo: Periodo; desde: Date | null; hasta: Date; etiqueta: string }

export function rangoDelPeriodo(periodo: Periodo, ahora: Date = new Date()): Rango {
  const t = ahora.getTime();
  const hoy = inicioDeDia(t);
  let desde: number | null;
  let hasta = t;
  switch (periodo) {
    case 'hoy': desde = hoy; break;
    case 'ayer': desde = hoy - DIA; hasta = hoy; break;
    case '7d': desde = hoy - 6 * DIA; break;
    case '15d': desde = hoy - 14 * DIA; break;
    case '1m': desde = mesesAtras(hoy, 1); break;
    case '3m': desde = mesesAtras(hoy, 3); break;
    case '6m': desde = mesesAtras(hoy, 6); break;
    case '12m': desde = mesesAtras(hoy, 12); break;
    default: desde = null;
  }
  return { periodo, desde: desde === null ? null : new Date(desde), hasta: new Date(hasta), etiqueta: ETIQUETA_PERIODO[periodo] };
}

// Filtro de Prisma para un campo de fecha: `hasta` es exclusivo cuando el periodo ya terminó (ayer) y "ahora" en los demás
export function filtroDeFecha(rango: Rango): { gte?: Date; lt?: Date; lte?: Date } {
  return { ...(rango.desde ? { gte: rango.desde } : {}), ...(rango.periodo === 'ayer' ? { lt: rango.hasta } : { lte: rango.hasta }) };
}

// ── Serie de la gráfica ──
export type Granularidad = 'hora' | 'dia' | 'semana' | 'mes';
export interface Punto { clave: number; etiqueta: string; volumen: number; comisiones: number }

export function granularidadPara(dias: number): Granularidad {
  if (dias <= 2.01) return 'hora';
  if (dias <= 40) return 'dia';
  if (dias <= 100) return 'semana';
  return 'mes';
}

export function construirSerie(
  rango: Rango, filas: { createdAt: Date; volumen: number; comisiones: number }[],
): { granularidad: Granularidad; datos: Punto[] } {
  const fin = rango.hasta.getTime();
  const primera = filas.length ? Math.min(...filas.map((f) => f.createdAt.getTime())) : fin;
  const inicio = rango.desde ? rango.desde.getTime() : inicioDeDia(primera);
  const granularidad = granularidadPara((fin - inicio) / DIA);

  const dia = (t: number) => Math.floor((t - OFFSET_MS) / DIA);
  const claveDe = (t: number): number => {
    if (granularidad === 'hora') return Math.floor((t - OFFSET_MS) / HORA);
    if (granularidad === 'dia') return dia(t);
    if (granularidad === 'semana') { const d = dia(t); return d - ((d + 3) % 7); } // lunes de esa semana (el día 0, 1970-01-01, fue jueves)
    const f = new Date(t - OFFSET_MS);
    return f.getUTCFullYear() * 12 + f.getUTCMonth();
  };
  const siguiente = (c: number) => c + (granularidad === 'semana' ? 7 : 1);
  const etiquetaDe = (c: number): string => {
    if (granularidad === 'hora') return `${String(((c % 24) + 24) % 24).padStart(2, '0')}:00`;
    if (granularidad === 'mes') return `${MESES[c % 12]} ${String(Math.floor(c / 12)).slice(2)}`;
    const f = new Date(c * DIA);
    return `${f.getUTCDate()} ${MESES[f.getUTCMonth()]}`;
  };

  const puntos = new Map<number, Punto>();
  // El último periodo se corta en "ahora": no se dibujan horas/días que todavía no llegan
  for (let c = claveDe(inicio), ultima = claveDe(Math.max(inicio, fin - 1)); c <= ultima; c = siguiente(c)) {
    puntos.set(c, { clave: c, etiqueta: etiquetaDe(c), volumen: 0, comisiones: 0 });
  }
  for (const f of filas) {
    const p = puntos.get(claveDe(f.createdAt.getTime()));
    if (p) { p.volumen += f.volumen; p.comisiones += f.comisiones; }
  }
  return { granularidad, datos: [...puntos.values()] };
}

// Clasifica la categoría de una transacción en uno de los tipos que muestra el dashboard
export function tipoDeCategoria(categoria?: string | null): 'consigna' | 'cobro' | 'envio' | 'retiro' | 'datafono' | 'otros' {
  const c = (categoria || '').toLowerCase();
  if (c.includes('consign')) return 'consigna';
  if (c.includes('datafono')) return 'datafono';
  if (c.includes('cobro')) return 'cobro';
  if (c.includes('envi')) return 'envio';
  if (c.includes('retiro')) return 'retiro';
  return 'otros';
}
