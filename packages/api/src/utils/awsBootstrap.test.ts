const enviarSecretos = jest.fn();
const enviarKms = jest.fn();

jest.mock('@aws-sdk/client-secrets-manager', () => ({
  SecretsManagerClient: jest.fn().mockImplementation(() => ({ send: enviarSecretos })),
  GetSecretValueCommand: jest.fn().mockImplementation((entrada) => ({ entrada })),
}));
jest.mock('@aws-sdk/client-kms', () => ({
  KMSClient: jest.fn().mockImplementation(() => ({ send: enviarKms })),
  DecryptCommand: jest.fn().mockImplementation((entrada) => ({ entrada })),
}));

import { cargarSecretosAws, CONTEXTO_LLAVE } from './awsBootstrap';

describe('Arranque seguro con AWS (Secrets Manager + KMS)', () => {
  beforeEach(() => { jest.useFakeTimers({ doNotFake: ['nextTick'] }); });
  afterEach(() => { jest.useRealTimers(); });

  it('sin configuración de AWS no hace nada ni llama a AWS', async () => {
    const env: NodeJS.ProcessEnv = { JWT_SECRET: 'local' };
    expect(await cargarSecretosAws(env)).toEqual({ secretos: 0, llaveKms: false });
    expect(enviarSecretos).not.toHaveBeenCalled();
    expect(enviarKms).not.toHaveBeenCalled();
    expect(env).toEqual({ JWT_SECRET: 'local' });
  });

  it('carga los secretos en el entorno y respeta las variables protegidas', async () => {
    enviarSecretos.mockResolvedValue({ SecretString: JSON.stringify({
      JWT_SECRET: 'desde-aws', KUSHKI_PRIVATE_MERCHANT_ID: 'priv', KUSHKI_PAYOUTS_ENABLED: true,
      AWS_ACCESS_KEY_ID: 'no-debe-cambiar', NODE_ENV: 'development', PORT: '1', 'nombre malo': 'x', ANIDADO: { a: 1 },
    }) });
    const env: NodeJS.ProcessEnv = { AWS_SECRETS_ID: 'trendpay/prod', AWS_REGION: 'us-east-1', AWS_ACCESS_KEY_ID: 'real', NODE_ENV: 'production', PORT: '8080', JWT_SECRET: 'viejo' };
    const r = await cargarSecretosAws(env);
    expect(r).toEqual({ secretos: 3, llaveKms: false });
    expect(env.JWT_SECRET).toBe('desde-aws');
    expect(env.KUSHKI_PAYOUTS_ENABLED).toBe('true');
    expect(env.AWS_ACCESS_KEY_ID).toBe('real');
    expect(env.NODE_ENV).toBe('production');
    expect(env.PORT).toBe('8080');
    expect(env.ANIDADO).toBeUndefined();
  });

  it('descifra la llave de datos con KMS (con su contexto) y la deja en memoria', async () => {
    const llave = Buffer.alloc(32, 7);
    enviarKms.mockResolvedValue({ Plaintext: new Uint8Array(llave) });
    const env: NodeJS.ProcessEnv = { KMS_WRAPPED_KEY: Buffer.from('envuelta').toString('base64') };
    const r = await cargarSecretosAws(env);
    expect(r.llaveKms).toBe(true);
    expect(env.ENCRYPTION_KEY_V2).toBe(llave.toString('hex'));
    expect(env.KMS_WRAPPED_KEY).toBeUndefined();
    expect(enviarKms.mock.calls[0][0].entrada.EncryptionContext).toEqual(CONTEXTO_LLAVE);
  });

  it('la llave envuelta puede venir dentro del propio secreto de AWS', async () => {
    enviarSecretos.mockResolvedValue({ SecretString: JSON.stringify({ KMS_WRAPPED_KEY: Buffer.from('x').toString('base64') }) });
    enviarKms.mockResolvedValue({ Plaintext: new Uint8Array(Buffer.alloc(32, 1)) });
    const env: NodeJS.ProcessEnv = { AWS_SECRETS_ID: 'trendpay/prod' };
    const r = await cargarSecretosAws(env);
    expect(r).toEqual({ secretos: 1, llaveKms: true });
    expect(env.ENCRYPTION_KEY_V2).toHaveLength(64);
  });

  it('falla cerrado: si KMS devuelve una llave de tamaño incorrecto, lanza', async () => {
    enviarKms.mockResolvedValue({ Plaintext: new Uint8Array(16) });
    await expect(cargarSecretosAws({ KMS_WRAPPED_KEY: 'eA==' })).rejects.toThrow(/llave inválida/);
  });

  it('falla cerrado: un secreto que no es JSON, o AWS caído, detienen el arranque', async () => {
    enviarSecretos.mockResolvedValueOnce({ SecretString: 'no es json' });
    await expect(cargarSecretosAws({ AWS_SECRETS_ID: 'x' })).rejects.toThrow(/JSON/);

    enviarSecretos.mockRejectedValue(new Error('AccessDenied'));
    const intento = cargarSecretosAws({ AWS_SECRETS_ID: 'x' });
    const esperado = expect(intento).rejects.toThrow('AccessDenied');
    await jest.advanceTimersByTimeAsync(2000);
    await esperado;
    expect(enviarSecretos).toHaveBeenCalledTimes(1 + 3); // 1 del caso anterior + 3 reintentos
  });
});
