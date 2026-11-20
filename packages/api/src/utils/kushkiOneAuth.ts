import { createCipheriv, createHash, randomBytes } from 'node:crypto';

// Autenticación y cifrado de Kushki One (guía "Authentication and Request Encryption"). Cada mensaje lleva dos cabeceras y un
// cuerpo cifrado:
//   Authorization: Basic <SHA-512 de la firma>     timestamp: <segundos UTC>     Body: { "data": "<iv_hex>:<cifrado_hex>" }
// Todo parte de tres valores: el Business-Code de la empresa (su Private Merchant ID de card present), el serial del terminal y
// la hora. La contraseña temporal cambia cada minuto, así que un mensaje firmado caduca solo.

export interface SolicitudKushkiOne {
  headers: Record<string, string>;
  body: { data: string };
}

const md5 = (texto: string) => createHash('md5').update(texto, 'utf8').digest('hex');
const base64 = (texto: string) => Buffer.from(texto, 'utf8').toString('base64');

// Paso 2: la fecha en UTC (nunca la hora local) con el formato AAAA:MM:DD:HH:MM
export function fechaFormateada(timestampSeg: number): string {
  const d = new Date(timestampSeg * 1000);
  const dos = (n: number) => String(n).padStart(2, '0');
  return [d.getUTCFullYear(), dos(d.getUTCMonth() + 1), dos(d.getUTCDate()), dos(d.getUTCHours()), dos(d.getUTCMinutes())].join(':');
}

// Paso 3: contraseña temporal = MD5 de (businessCode + serial + fecha) rellenado con ceros hasta 32 caracteres
export function contrasenaTemporal(businessCode: string, serial: string, timestampSeg: number): string {
  return md5((businessCode + serial + fechaFormateada(timestampSeg)).padEnd(32, '0'));
}

// Arma las cabeceras y el cuerpo cifrado de un mensaje. Se calcula UNA sola marca de tiempo por mensaje (si la firma, el cifrado
// y la cabecera usaran horas distintas, Kushki lo rechazaría) y el contenido se convierte a texto una sola vez.
export function prepararSolicitud(serial: string, payload: unknown, businessCode: string, ahoraMs: number = Date.now()): SolicitudKushkiOne {
  const timestamp = Math.floor(ahoraMs / 1000); // segundos, no milisegundos
  const password = contrasenaTemporal(businessCode, serial, timestamp);

  // Contenido original: nunca lleva el campo "key". Las operaciones sin contenido firman el objeto vacío {}, no un texto vacío.
  const datos: Record<string, unknown> = { ...(typeof payload === 'object' && payload !== null ? (payload as Record<string, unknown>) : {}) };
  delete datos.key;
  const texto = JSON.stringify(datos);

  // Pasos 4 y 5: la firma se calcula sobre una copia con el campo "key" (que no se envía ni se cifra)
  const llave = base64(password + timestamp);
  const hash = createHash('sha512').update(base64(JSON.stringify({ ...datos, key: llave })), 'utf8').digest('hex');

  // Paso 6: AES-256-CBC con relleno PKCS7; la llave son los primeros 32 caracteres de "timestamp___contraseña"
  const aesKey = Buffer.from(`${timestamp}___${password}`.substring(0, 32), 'utf8');
  const iv = randomBytes(16);
  const cifrador = createCipheriv('aes-256-cbc', aesKey, iv);
  const cifrado = Buffer.concat([cifrador.update(texto, 'utf8'), cifrador.final()]);

  return {
    headers: { Authorization: `Basic ${hash}`, timestamp: String(timestamp) },
    body: { data: `${iv.toString('hex')}:${cifrado.toString('hex')}` },
  };
}
