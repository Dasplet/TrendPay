import { createHmac, timingSafeEqual } from 'node:crypto';

// Kushki firma cada webhook con HMAC SHA256 usando el "webhook signature ID" de
// la consola (Desarrolladores > Webhooks). Manda dos cabeceras y basta con que
// una coincida:
//   X-Kushki-Signature:       HMAC(secreto, `${cuerpo}.${X-Kushki-Id}`)
//   X-Kushki-SimpleSignature: HMAC(secreto, X-Kushki-Id)
// La documentación no dice si la firma va en hex o base64, así que se acepta
// cualquiera de las dos.
function hmac(secreto: string, datos: string | Buffer): Buffer {
  return createHmac('sha256', secreto).update(datos).digest();
}

function coincide(esperado: Buffer, recibido: string | undefined): boolean {
  if (!recibido) return false;
  const candidatos = [Buffer.from(recibido, 'hex'), Buffer.from(recibido, 'base64')];
  return candidatos.some((c) => c.length === esperado.length && timingSafeEqual(c, esperado));
}

export function firmaKushkiValida(
  cuerpo: Buffer,
  cabeceras: { id?: string; firma?: string; firmaSimple?: string },
  secreto: string
): boolean {
  const { id, firma, firmaSimple } = cabeceras;
  if (!id || !secreto) return false;
  const completa = hmac(secreto, Buffer.concat([cuerpo, Buffer.from(`.${id}`)]));
  return coincide(completa, firma) || coincide(hmac(secreto, id), firmaSimple);
}

// El aviso trae datos bancarios del titular que no deben quedar en texto plano.
const CAMPOS_SENSIBLES = ['accountNumber', 'documentNumber', 'documentType', 'token'];

export function sanitizarWebhook(cuerpo: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(Object.entries(cuerpo).filter(([clave]) => !CAMPOS_SENSIBLES.includes(clave)));
}
