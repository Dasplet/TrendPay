import crypto from 'node:crypto';

const ALGORITHM = 'aes-256-gcm';

// Llave v1 (histórica): viene de ENCRYPTION_KEY y descifra todo lo guardado hasta ahora.
const KEY = Buffer.from(process.env.ENCRYPTION_KEY || 'change-this-32-char-key-in-prod!!', 'utf8').subarray(0, 32);

// Llave v2: la entrega AWS KMS al arrancar (ver awsBootstrap.ts). Nunca está escrita en una variable de
// Railway ni en la base de datos: solo vive en la memoria del servidor. Si existe, TODO lo nuevo se cifra con
// ella y lo antiguo (v1) se sigue pudiendo leer hasta que se re-cifre con el script de migración.
const KEY_V2 = leerLlaveV2(process.env.ENCRYPTION_KEY_V2);

function leerLlaveV2(hex: string | undefined): Buffer | null {
  if (!hex) return null;
  if (!/^[0-9a-f]{64}$/i.test(hex)) throw new Error('ENCRYPTION_KEY_V2 inválida: deben ser 64 caracteres hexadecimales');
  return Buffer.from(hex, 'hex');
}

const PREFIJO_TEXTO_V2 = 'v2:';
const MAGIA_BUFFER_V2 = Buffer.from('TPCRYPT2', 'utf8'); // 8 bytes al inicio de los archivos cifrados con la llave v2

export function cifradoV2Activo(): boolean {
  return KEY_V2 !== null;
}

// true si el valor ya está cifrado con la llave v2 (lo usa el script de migración y el panel de seguridad)
export function esCifradoV2(valor: string | Uint8Array): boolean {
  if (typeof valor === 'string') return valor.startsWith(PREFIJO_TEXTO_V2);
  return Buffer.from(valor.subarray(0, MAGIA_BUFFER_V2.length)).equals(MAGIA_BUFFER_V2);
}

export function encrypt(text: string): string {
  const key = KEY_V2 ?? KEY;
  const iv  = crypto.randomBytes(16);
  const cipher = crypto.createCipheriv(ALGORITHM, key, iv);
  const encrypted = Buffer.concat([cipher.update(text, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `${KEY_V2 ? PREFIJO_TEXTO_V2 : ''}${iv.toString('hex')}:${tag.toString('hex')}:${encrypted.toString('hex')}`;
}

export function decrypt(data: string): string {
  try {
    const esV2 = data.startsWith(PREFIJO_TEXTO_V2);
    const key = esV2 ? KEY_V2 : KEY;
    if (!key) return '****';
    const [ivHex, tagHex, encHex] = (esV2 ? data.slice(PREFIJO_TEXTO_V2.length) : data).split(':');
    const decipher = crypto.createDecipheriv(ALGORITHM, key, Buffer.from(ivHex, 'hex'));
    decipher.setAuthTag(Buffer.from(tagHex, 'hex'));
    return Buffer.concat([decipher.update(Buffer.from(encHex, 'hex')), decipher.final()]).toString('utf8');
  } catch {
    return '****';
  }
}

// Cifrado de archivos completos. v1: iv 16 B | tag 16 B | contenido. v2: "TPCRYPT2" | iv | tag | contenido.
export function encryptBuffer(data: Buffer): Buffer {
  const iv = crypto.randomBytes(16);
  const cipher = crypto.createCipheriv(ALGORITHM, KEY_V2 ?? KEY, iv);
  const encrypted = Buffer.concat([cipher.update(data), cipher.final()]);
  const cuerpo = Buffer.concat([iv, cipher.getAuthTag(), encrypted]);
  return KEY_V2 ? Buffer.concat([MAGIA_BUFFER_V2, cuerpo]) : cuerpo;
}

// Lanza si el contenido fue alterado o la llave no corresponde.
export function decryptBuffer(data: Buffer): Buffer {
  const esV2 = esCifradoV2(data);
  if (esV2 && !KEY_V2) throw new Error('El archivo está cifrado con la llave v2 y esta instancia no la tiene cargada');
  const cuerpo = esV2 ? data.subarray(MAGIA_BUFFER_V2.length) : data;
  const decipher = crypto.createDecipheriv(ALGORITHM, esV2 ? (KEY_V2 as Buffer) : KEY, cuerpo.subarray(0, 16));
  decipher.setAuthTag(cuerpo.subarray(16, 32));
  return Buffer.concat([decipher.update(cuerpo.subarray(32)), decipher.final()]);
}

export function maskAccount(num: string): string {
  if (num.length <= 4) return '****';
  return '*'.repeat(num.length - 4) + num.slice(-4);
}

export function maskEmail(correo: string): string {
  const at = correo.indexOf('@');
  if (at < 0) return correo;
  return `${correo.slice(0, 2)}***${correo.slice(at)}`;
}

export function genCodigo(prefix: string): string {
  const numero = crypto.randomInt(100000, 1000000);
  return `${prefix}-${numero}`;
}

export function genQrToken(): string {
  return crypto.randomBytes(32).toString('hex');
}
