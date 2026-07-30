import { encrypt, decrypt, maskAccount, genCodigo, genQrToken } from './security';

describe('encrypt/decrypt', () => {
  it('recupera el texto original tras cifrar y descifrar', () => {
    const original = '04512345678';
    const cifrado = encrypt(original);
    expect(cifrado).not.toBe(original);
    expect(decrypt(cifrado)).toBe(original);
  });

  it('produce un cifrado distinto cada vez (IV aleatorio)', () => {
    const a = encrypt('mismo-valor');
    const b = encrypt('mismo-valor');
    expect(a).not.toBe(b);
  });

  it('decrypt() no lanza excepción con datos corruptos, devuelve un valor de fallback', () => {
    expect(decrypt('esto-no-es-un-cifrado-valido')).toBe('****');
  });

  it('detecta manipulación del texto cifrado (auth tag de GCM)', () => {
    const cifrado = encrypt('1023456789');
    const [iv, tag, data] = cifrado.split(':');
    const manipulado = [iv, tag, data.slice(0, -2) + '00'].join(':');
    expect(decrypt(manipulado)).toBe('****');
  });
});

describe('maskAccount', () => {
  it('deja visibles solo los últimos 4 dígitos', () => {
    expect(maskAccount('04512345678')).toBe('*******5678');
  });

  it('enmascara por completo números de 4 caracteres o menos', () => {
    expect(maskAccount('123')).toBe('****');
    expect(maskAccount('1234')).toBe('****');
  });
});

describe('genCodigo', () => {
  it('tiene el formato PREFIJO-NNNNNN', () => {
    expect(genCodigo('ENV')).toMatch(/^ENV-\d{6}$/);
  });
});

describe('genQrToken', () => {
  it('genera un token hexadecimal de 64 caracteres y distinto en cada llamada', () => {
    const a = genQrToken();
    const b = genQrToken();
    expect(a).toMatch(/^[0-9a-f]{64}$/);
    expect(a).not.toBe(b);
  });
});
