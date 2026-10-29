import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { prisma } from '../index';
import { logger } from './logger';
import { DOCUMENTOS_VINCULACION, detectarTipoArchivo } from './vinculacionDocs';
import { guardarObjeto, borrarObjeto } from './storage';

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

export type TipoArchivoContrato = 'contrato' | 'contrato_firmado';

// El contrato está pendiente de firma del cliente: ya se le envió (o se le devolvió para corregir) y aún no firma.
export function contratoPendiente(v: { estado: string; contratoEstado: string }): boolean {
  return v.estado === 'aprobada' && (v.contratoEstado === 'enviado' || v.contratoEstado === 'rechazado');
}

interface DocumentoContrato { tipo: string; nombreOriginal: string; tamano: number; updatedAt: Date }

export function resumenContrato(v: { contratoEstado: string; contratoMotivo: string | null; documentos: DocumentoContrato[] }) {
  const ficha = (tipo: TipoArchivoContrato) => {
    const d = v.documentos.find(x => x.tipo === tipo);
    return d ? { nombre: d.nombreOriginal, tamano: d.tamano, subidoEn: d.updatedAt } : null;
  };
  return { estado: v.contratoEstado, motivo: v.contratoMotivo, enviado: ficha('contrato'), firmado: ficha('contrato_firmado') };
}

// Guarda (o reemplaza) el contrato o el contrato firmado. El contrato que sube TrendPay debe ser PDF.
export async function guardarArchivoContrato(
  vinculacionId: string,
  tipo: TipoArchivoContrato,
  archivo: { buffer: Buffer; originalname: string; size: number },
): Promise<{ ok: true } | { ok: false; mensaje: string }> {
  const detectado = detectarTipoArchivo(archivo.buffer);
  if (!detectado) return { ok: false, mensaje: 'Solo se aceptan archivos PDF, JPG o PNG' };
  if (tipo === 'contrato' && detectado.mime !== 'application/pdf') return { ok: false, mensaje: 'El contrato debe ser un archivo PDF' };

  const previo = await prisma.vinculacionDocumento.findUnique({ where: { vinculacionId_tipo: { vinculacionId, tipo } } });
  const storageKey = await guardarObjeto(`vinculaciones/${vinculacionId}/${tipo}/${randomUUID()}.${detectado.ext}`, archivo.buffer, detectado.mime);
  const datos = {
    storageKey,
    nombreOriginal: archivo.originalname.slice(0, 200),
    mime: detectado.mime,
    tamano: archivo.size,
    sha256: createHash('sha256').update(archivo.buffer).digest('hex'),
    estado: 'pendiente',
    motivo: null,
  };
  await prisma.vinculacionDocumento.upsert({
    where: { vinculacionId_tipo: { vinculacionId, tipo } },
    create: { vinculacionId, tipo, ...datos },
    update: datos,
  });
  if (previo) await borrarObjeto(previo.storageKey).catch(e => logger.warn('Vinculación: no se pudo borrar el archivo anterior', { error: e.message }));
  return { ok: true };
}
