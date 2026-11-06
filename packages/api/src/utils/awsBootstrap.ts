import { SecretsManagerClient, GetSecretValueCommand } from '@aws-sdk/client-secrets-manager';
import { KMSClient, DecryptCommand } from '@aws-sdk/client-kms';

// Arranque seguro: antes de cargar la aplicación se traen de AWS
//  1. los secretos (AWS Secrets Manager → variables de entorno en memoria), y
//  2. la llave de cifrado de datos (AWS KMS descifra la llave guardada "envuelta"; el valor envuelto no sirve sin KMS).
// Si NO están configuradas AWS_SECRETS_ID ni KMS_WRAPPED_KEY no hace nada y todo funciona como siempre.
// Si están configuradas y AWS falla, el arranque se detiene: es preferible que Railway conserve la versión
// anterior a levantar un servidor con secretos equivocados o cifrando con la llave equivocada.

// Esto nunca se puede sobrescribir desde Secrets Manager (credenciales de acceso a AWS y datos del hosting).
const PROTEGIDAS = /^(AWS_.*|NODE_ENV|PORT|PATH|HOME|NODE_OPTIONS|RAILWAY_.*|TP_.*)$/;
const NOMBRE_VALIDO = /^[A-Z][A-Z0-9_]*$/;

export const CONTEXTO_LLAVE = { app: 'trendpay', uso: 'cifrado-de-datos' };

type Env = NodeJS.ProcessEnv;

async function conReintentos<T>(operacion: () => Promise<T>, intentos = 3): Promise<T> {
  let ultimo: unknown;
  for (let i = 1; i <= intentos; i++) {
    try {
      return await operacion();
    } catch (err) {
      ultimo = err;
      if (i < intentos) await new Promise((r) => setTimeout(r, 400 * i));
    }
  }
  throw ultimo;
}

export interface ResultadoArranque {
  secretos: number;
  llaveKms: boolean;
}

export async function cargarSecretosAws(env: Env = process.env): Promise<ResultadoArranque> {
  const region = env.AWS_REGION || 'us-east-1';
  const resultado: ResultadoArranque = { secretos: 0, llaveKms: false };

  if (env.AWS_SECRETS_ID) {
    const cliente = new SecretsManagerClient({ region });
    const respuesta = await conReintentos(() => cliente.send(new GetSecretValueCommand({ SecretId: env.AWS_SECRETS_ID })));
    if (!respuesta.SecretString) throw new Error('El secreto de AWS no tiene contenido de texto (SecretString)');

    let contenido: unknown;
    try {
      contenido = JSON.parse(respuesta.SecretString);
    } catch {
      throw new Error('El secreto de AWS no es un JSON válido (se espera {"NOMBRE": "valor", ...})');
    }
    if (typeof contenido !== 'object' || contenido === null || Array.isArray(contenido)) {
      throw new Error('El secreto de AWS debe ser un objeto JSON plano {"NOMBRE": "valor", ...}');
    }
    for (const [nombre, valor] of Object.entries(contenido as Record<string, unknown>)) {
      if (!NOMBRE_VALIDO.test(nombre) || PROTEGIDAS.test(nombre)) continue;
      if (typeof valor !== 'string' && typeof valor !== 'number' && typeof valor !== 'boolean') continue;
      env[nombre] = String(valor);
      resultado.secretos += 1;
    }
    env.TP_SECRETOS_AWS = String(resultado.secretos);
  }

  if (env.KMS_WRAPPED_KEY) {
    const cliente = new KMSClient({ region });
    const respuesta = await conReintentos(() => cliente.send(new DecryptCommand({
      CiphertextBlob: Buffer.from(env.KMS_WRAPPED_KEY as string, 'base64'),
      EncryptionContext: CONTEXTO_LLAVE,
    })));
    const llave = respuesta.Plaintext ? Buffer.from(respuesta.Plaintext) : null;
    if (llave?.length !== 32) throw new Error('KMS devolvió una llave inválida (se esperaban 32 bytes)');
    env.ENCRYPTION_KEY_V2 = llave.toString('hex');
    // La versión "envuelta" ya no se necesita en memoria
    delete env.KMS_WRAPPED_KEY;
    env.TP_LLAVE_KMS = 'true';
    resultado.llaveKms = true;
  }

  return resultado;
}
