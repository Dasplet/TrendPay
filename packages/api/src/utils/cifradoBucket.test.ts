import { cifradoDelBucket } from './storage';

describe('Cifrado en reposo del bucket de documentos', () => {
  const original = { kms: process.env.S3_KMS_KEY_ID, sse: process.env.S3_SSE };
  afterEach(() => {
    if (original.kms === undefined) delete process.env.S3_KMS_KEY_ID; else process.env.S3_KMS_KEY_ID = original.kms;
    if (original.sse === undefined) delete process.env.S3_SSE; else process.env.S3_SSE = original.sse;
  });

  it('con S3_KMS_KEY_ID cifra cada archivo con la llave de KMS indicada', () => {
    process.env.S3_KMS_KEY_ID = '  alias/trendpay-archivos ';
    expect(cifradoDelBucket()).toEqual({ ServerSideEncryption: 'aws:kms', SSEKMSKeyId: 'alias/trendpay-archivos' });
  });

  it('con S3_SSE=true usa la llave gestionada por S3', () => {
    delete process.env.S3_KMS_KEY_ID;
    process.env.S3_SSE = 'true';
    expect(cifradoDelBucket()).toEqual({ ServerSideEncryption: 'AES256' });
  });

  it('sin nada configurado no fuerza cifrado en la petición', () => {
    delete process.env.S3_KMS_KEY_ID;
    delete process.env.S3_SSE;
    expect(cifradoDelBucket()).toEqual({});
  });
});
