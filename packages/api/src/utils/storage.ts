import { S3Client, PutObjectCommand, DeleteObjectCommand, GetObjectCommand } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';

// Almacenamiento privado compatible con S3 (Cloudflare R2, AWS S3, MinIO...).
// Los archivos nunca son públicos: el panel admin los abre con enlaces que caducan en minutos.
let client: S3Client | null = null;

export function almacenamientoConfigurado(): boolean {
  return !!(process.env.S3_BUCKET && process.env.S3_ACCESS_KEY_ID && process.env.S3_SECRET_ACCESS_KEY);
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

export async function guardarObjeto(key: string, cuerpo: Buffer, mime: string): Promise<void> {
  await getClient().send(new PutObjectCommand({
    Bucket: process.env.S3_BUCKET,
    Key: key,
    Body: cuerpo,
    ContentType: mime,
    ServerSideEncryption: process.env.S3_SSE === 'true' ? 'AES256' : undefined,
  }));
}

export async function borrarObjeto(key: string): Promise<void> {
  await getClient().send(new DeleteObjectCommand({ Bucket: process.env.S3_BUCKET, Key: key }));
}

export async function urlTemporal(key: string, nombreArchivo: string, segundos = 120): Promise<string> {
  const seguro = nombreArchivo.replace(/[^\w.\- ]/g, '_');
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
