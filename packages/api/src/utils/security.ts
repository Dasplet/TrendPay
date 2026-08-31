import crypto from 'node:crypto';

const ALGORITHM = 'aes-256-gcm';
const KEY = Buffer.from(process.env.ENCRYPTION_KEY || 'change-this-32-char-key-in-prod!!', 'utf8').subarray(0, 32);

export function encrypt(text: string): string {
  const iv  = crypto.randomBytes(16);
  const cipher = crypto.createCipheriv(ALGORITHM, KEY, iv);
  const encrypted = Buffer.concat([cipher.update(text, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `${iv.toString('hex')}:${tag.toString('hex')}:${encrypted.toString('hex')}`;
}

export function decrypt(data: string): string {
  try {
    const [ivHex, tagHex, encHex] = data.split(':');
    const decipher = crypto.createDecipheriv(ALGORITHM, KEY, Buffer.from(ivHex, 'hex'));
    decipher.setAuthTag(Buffer.from(tagHex, 'hex'));
    return Buffer.concat([decipher.update(Buffer.from(encHex, 'hex')), decipher.final()]).toString('utf8');
  } catch {
    return '****';
  }
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
