import { createHash, randomBytes } from 'node:crypto';
import { DOCUMENTOS_VINCULACION } from './vinculacionDocs';

export const DIAS_VIGENCIA_ENLACE = 30;

export function generarToken(): { token: string; tokenHash: string } {
  const token = randomBytes(32).toString('base64url');
  return { token, tokenHash: hashToken(token) };
}

export function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

export function enlaceVinculacion(token: string): string {
  // En producción se ignora una FRONTEND_URL de desarrollo (localhost) para no enviar enlaces rotos al cliente
  const configurada = process.env.FRONTEND_URL?.trim();
  const esLocal = !!configurada && /^https?:\/\/(localhost|127\.0\.0\.1)/i.test(configurada);
  const base = (!configurada || (esLocal && process.env.NODE_ENV === 'production') ? 'https://trendpay.com.co' : configurada).replace(/\/+$/, '');
  return `${base}/vinculacion/${token}`;
}

export function fechaEnDias(dias: number): Date {
  return new Date(Date.now() + dias * 24 * 60 * 60 * 1000);
}

interface DocumentoGuardado {
  tipo: string;
  nombreOriginal: string;
  mime: string;
  tamano: number;
  fechaExpedicion: Date | null;
  estado: string;
  motivo: string | null;
  updatedAt: Date;
}

// Catálogo de documentos combinado con lo que el cliente ya subió.
export function documentosConEstado(guardados: DocumentoGuardado[]) {
  return DOCUMENTOS_VINCULACION.map(def => {
    const doc = guardados.find(g => g.tipo === def.tipo);
    return {
      tipo: def.tipo,
      nombre: def.nombre,
      descripcion: def.descripcion,
      vigencia: def.vigencia,
      requerido: def.requerido,
      pedirFecha: def.fecha.tipo !== 'ninguna',
      etiquetaFecha: def.etiquetaFecha ?? null,
      subido: !!doc,
      nombreOriginal: doc?.nombreOriginal ?? null,
      mime: doc?.mime ?? null,
      tamano: doc?.tamano ?? null,
      fechaExpedicion: doc?.fechaExpedicion ? doc.fechaExpedicion.toISOString().slice(0, 10) : null,
      estado: doc ? doc.estado : 'pendiente_de_subir',
      motivo: doc?.motivo ?? null,
      subidoEn: doc?.updatedAt ?? null,
    };
  });
}
