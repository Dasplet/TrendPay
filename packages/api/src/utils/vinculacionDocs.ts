// Documentos que TrendPay exige a un cliente empresarial para vincularlo, y sus reglas de vigencia.
// Es la única fuente de verdad: la usan el API (validación) y la página pública (lo que se muestra).

export type TipoDocumento =
  | 'cedula_rep_legal'
  | 'rut'
  | 'camara_comercio'
  | 'cert_bancaria'
  | 'composicion_accionaria';

export type ReglaFecha =
  | { tipo: 'ninguna' }
  | { tipo: 'anio_actual' }
  | { tipo: 'max_dias'; dias: number };

export interface DocumentoRequerido {
  tipo: TipoDocumento;
  nombre: string;
  descripcion: string;
  vigencia: string;
  requerido: boolean;
  fecha: ReglaFecha;
  etiquetaFecha?: string;
}

export const DOCUMENTOS_VINCULACION: DocumentoRequerido[] = [
  {
    tipo: 'cedula_rep_legal',
    nombre: 'Documento de identidad del representante legal',
    descripcion: 'Cédula de ciudadanía o de extranjería, por ambas caras.',
    vigencia: 'Debe estar vigente a la fecha.',
    requerido: true,
    fecha: { tipo: 'ninguna' },
  },
  {
    tipo: 'rut',
    nombre: 'Registro Único Tributario (RUT)',
    descripcion: 'Copia actualizada, con la actividad económica correcta.',
    vigencia: 'Generado en el año en curso.',
    requerido: true,
    fecha: { tipo: 'anio_actual' },
    etiquetaFecha: 'Fecha de generación',
  },
  {
    tipo: 'camara_comercio',
    nombre: 'Certificado de Cámara de Comercio',
    descripcion: 'Certificado de existencia y representación legal.',
    vigencia: 'Expedido hace máximo 90 días.',
    requerido: true,
    fecha: { tipo: 'max_dias', dias: 90 },
    etiquetaFecha: 'Fecha de expedición',
  },
  {
    tipo: 'cert_bancaria',
    nombre: 'Certificación de cuenta bancaria',
    descripcion: 'Documento oficial del banco de la cuenta donde la empresa recibirá sus dispersiones.',
    vigencia: 'Expedida hace máximo 90 días.',
    requerido: true,
    fecha: { tipo: 'max_dias', dias: 90 },
    etiquetaFecha: 'Fecha de expedición',
  },
  {
    tipo: 'composicion_accionaria',
    nombre: 'Certificación de composición accionaria',
    descripcion: 'Firmada por el contador o el revisor fiscal.',
    vigencia: 'Expedida hace máximo 90 días.',
    requerido: true,
    fecha: { tipo: 'max_dias', dias: 90 },
    etiquetaFecha: 'Fecha de expedición',
  },
];

export function buscarDocumento(tipo: string): DocumentoRequerido | undefined {
  return DOCUMENTOS_VINCULACION.find(d => d.tipo === tipo);
}

const MS_DIA = 24 * 60 * 60 * 1000;

// "YYYY-MM-DD" -> Date a medianoche UTC; null si no es una fecha real.
export function parsearFecha(valor: unknown): Date | null {
  if (typeof valor !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(valor)) return null;
  const fecha = new Date(`${valor}T00:00:00.000Z`);
  return Number.isNaN(fecha.getTime()) || fecha.toISOString().slice(0, 10) !== valor ? null : fecha;
}

// Devuelve el mensaje de error para el cliente, o null si la fecha cumple la regla del documento.
export function validarVigencia(doc: DocumentoRequerido, fecha: Date | null, hoy = new Date()): string | null {
  if (doc.fecha.tipo === 'ninguna') return null;
  if (!fecha) return `Indica la ${doc.etiquetaFecha?.toLowerCase() ?? 'fecha'} del documento`;

  const hoyUtc = Date.UTC(hoy.getUTCFullYear(), hoy.getUTCMonth(), hoy.getUTCDate());
  if (fecha.getTime() > hoyUtc) return 'La fecha no puede ser futura';

  if (doc.fecha.tipo === 'anio_actual') {
    return fecha.getUTCFullYear() === hoy.getUTCFullYear() ? null : 'El RUT debe haberse generado en el año en curso';
  }
  const dias = Math.floor((hoyUtc - fecha.getTime()) / MS_DIA);
  return dias <= doc.fecha.dias ? null : `Tiene ${dias} días de expedido y el máximo permitido es ${doc.fecha.dias}`;
}

// Los archivos se identifican por su contenido real, no por la extensión ni el tipo que declara el navegador.
export function detectarTipoArchivo(buf: Buffer): { mime: string; ext: string } | null {
  if (buf.length >= 5 && buf.subarray(0, 5).toString('latin1') === '%PDF-') return { mime: 'application/pdf', ext: 'pdf' };
  if (buf.length >= 3 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return { mime: 'image/jpeg', ext: 'jpg' };
  if (buf.length >= 8 && buf.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return { mime: 'image/png', ext: 'png' };
  return null;
}
