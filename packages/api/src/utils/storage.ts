import { S3Client, PutObjectCommand, DeleteObjectCommand, GetObjectCommand } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import jwt from 'jsonwebtoken';
import { prisma } from '../index';
import { encryptBuffer, decryptBuffer } from './security';

// Almacenamiento privado de los documentos de vinculación. Hay dos modos:
//  - "s3": un bucket compatible con S3 (Cloudflare R2, AWS S3, MinIO) cuando están las variables S3_*.
//  - "bd": sin configurar nada, los archivos se guardan CIFRADOS (AES-256-GCM) en la base de datos.
// En ambos los archivos nunca son públicos: el panel admin los abre con enlaces que caducan en minutos.
let client: S3Client | null = null;

export type ModoAlmacenamiento = 's3' | 'bd';

export function modoAlmacenamiento(): ModoAlmacenamiento {
  return process.env.S3_BUCKET && process.env.S3_ACCESS_KEY_ID && process.env.S3_SECRET_ACCESS_KEY ? 's3' : 'bd';
}

function getClient(): S3Client {
  client ??= new S3Client({
    region: process.env.S3_REGION || 'auto',
    endpoint: process.env.S3_ENDPOINT || undefined,
    credentials: {
      accessKeyId: process.env.S3_ACCESS_KEY_ID as string,
      secretAccessKey: process.env.S3_SECRET_ACCESS_KEY as string,
    },
  });
  return client;
}

// Las claves de la base de datos llevan este prefijo para distinguirlas de las de S3.
const PREFIJO_BD = 'bd:';

// Devuelve la clave con la que quedó guardado el archivo; esa es la que hay que recordar en el documento.
export async function guardarObjeto(key: string, cuerpo: Buffer, mime: string): Promise<string> {
  if (modoAlmacenamiento() === 'bd') {
    const claveBd = PREFIJO_BD + key;
    await prisma.vinculacionArchivo.create({ data: { key: claveBd, contenido: encryptBuffer(cuerpo) } });
    return claveBd;
  }
  await getClient().send(new PutObjectCommand({
    Bucket: process.env.S3_BUCKET,
    Key: key,
    Body: cuerpo,
    ContentType: mime,
    ServerSideEncryption: process.env.S3_SSE === 'true' ? 'AES256' : undefined,
  }));
  return key;
}

// La clave guardada en el documento dice dónde vive el archivo, aunque después cambie el modo configurado.
export function claveEnBd(key: string): boolean {
  return key.startsWith(PREFIJO_BD);
}

export async function borrarObjeto(key: string): Promise<void> {
  if (claveEnBd(key)) {
    await prisma.vinculacionArchivo.deleteMany({ where: { key } });
    return;
  }
  await getClient().send(new DeleteObjectCommand({ Bucket: process.env.S3_BUCKET, Key: key }));
}

export async function leerArchivoBd(key: string): Promise<Buffer | null> {
  const fila = await prisma.vinculacionArchivo.findUnique({ where: { key } });
  return fila ? decryptBuffer(Buffer.from(fila.contenido)) : null;
}

// Devuelve una dirección temporal. En modo S3 es un enlace firmado del bucket; en modo bd es una ruta
// relativa del propio API con un token firmado de pocos minutos (el navegador no puede mandar el
// encabezado de sesión al abrir el archivo en otra pestaña).
export async function urlTemporal(key: string, nombreArchivo: string, segundos = 120): Promise<string> {
  const seguro = nombreArchivo.replace(/[^\w.\- ]/g, '_');
  if (claveEnBd(key)) {
    const token = jwt.sign({ k: key, n: seguro, p: 'vinculacion-archivo' }, process.env.JWT_SECRET as string, { expiresIn: segundos });
    return `/api/vinculacion/archivo/${token}`;
  }
  return getSignedUrl(
    getClient(),
    new GetObjectCommand({
      Bucket: process.env.S3_BUCKET,
      Key: key,
      ResponseContentDisposition: `inline; filename="${seguro}"`,
    }),
    { expiresIn: segundos },
  );
}

export function leerTokenArchivo(token: string): { key: string; nombre: string } | null {
  try {
    const p = jwt.verify(token, process.env.JWT_SECRET as string) as { k?: string; n?: string; p?: string };
    return p.p === 'vinculacion-archivo' && p.k && p.n ? { key: p.k, nombre: p.n } : null;
  } catch {
    return null;
  }
}
