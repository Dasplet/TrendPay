import { createDecipheriv, createHash } from 'node:crypto';
import { prepararSolicitud, fechaFormateada, contrasenaTemporal } from './kushkiOneAuth';

// Valores de referencia calculados con el script oficial de Kushki (Postman, con CryptoJS) para estas mismas entradas.
// Si esta implementación coincide con ellos, Kushki aceptará la firma.
const BUSINESS_CODE = 'a1b2c3d4e5f60718293a4b5c6d7e8f90';
const SERIAL = 'P3F6P624J0101';
const TS = 1795207388;
const REF = {
  fecha: '2026:11:20:20:43',
  password: '163f045a6e3d5c8846b00fb52776b961',
  hash: '53b28014a91e3ee640d7da4b73fa954cfc2dd203b32de845553ea93e63cbd266f9520cf64ca8b37ec7bc2a607e4ef87ed7f355545ad7f5e583c4f71afae00c6f',
  aesKey: '1795207388___163f045a6e3d5c8846b',
};
const PAYLOAD = {
  events_webhook_url: 'https://api.negocio.co/webhook/terminal-events',
  amount: { subtotal_iva0: 12000, subtotal_iva: 0, iva: 0, tip: 0 },
  client_transaction_id: 'c5a3f3be-9d6f-4d39-8af5-58dbb589af79',
  cashback_amount: 0,
  metadata: { reference: 'ORD-1', device: 'TrendPay' },
};

function descifrar(data: string, aesKey: string): string {
  const [iv, cifrado] = data.split(':');
  const d = createDecipheriv('aes-256-cbc', Buffer.from(aesKey, 'utf8'), Buffer.from(iv, 'hex'));
  return Buffer.concat([d.update(Buffer.from(cifrado, 'hex')), d.final()]).toString('utf8');
}

describe('Autenticación y cifrado de Kushki One', () => {
  it('la fecha va en UTC con el formato AAAA:MM:DD:HH:MM (nunca en hora local)', () => {
    expect(fechaFormateada(TS)).toBe(REF.fecha);
    // 23:59 UTC del 31 de dic sigue siendo ese minuto, sin importar la zona horaria de la máquina
    expect(fechaFormateada(Date.UTC(2026, 11, 31, 23, 59, 30) / 1000)).toBe('2026:12:31:23:59');
    expect(fechaFormateada(Date.UTC(2027, 0, 1, 0, 0, 0) / 1000)).toBe('2027:01:01:00:00');
  });

  it('la contraseña temporal coincide con la del script de referencia de Kushki', () => {
    expect(contrasenaTemporal(BUSINESS_CODE, SERIAL, TS)).toBe(REF.password);
  });

  it('la contraseña cambia cada minuto y por terminal (por eso un mensaje firmado caduca solo)', () => {
    const base = contrasenaTemporal(BUSINESS_CODE, SERIAL, TS);
    expect(contrasenaTemporal(BUSINESS_CODE, SERIAL, TS + 10)).toBe(base);      // mismo minuto
    expect(contrasenaTemporal(BUSINESS_CODE, SERIAL, TS + 120)).not.toBe(base); // otro minuto
    expect(contrasenaTemporal(BUSINESS_CODE, 'OTRO-SERIAL-1', TS)).not.toBe(base);
    expect(contrasenaTemporal('otro-business-code-1234', SERIAL, TS)).not.toBe(base);
  });

  it('un texto corto se rellena con ceros hasta 32 caracteres antes del MD5', () => {
    // Sin código ni serial queda solo la fecha ('1970:01:01:00:00', 16 caracteres): se completa con 16 ceros
    expect(contrasenaTemporal('', '', 0)).toBe(createHash('md5').update('1970:01:01:00:000000000000000000'.slice(0, 32)).digest('hex'));
    expect(contrasenaTemporal('', '', 0)).toBe(createHash('md5').update('1970:01:01:00:00'.padEnd(32, '0')).digest('hex'));
  });

  it('la firma (Authorization) coincide exactamente con la del script de referencia de Kushki', () => {
    const { headers } = prepararSolicitud(SERIAL, PAYLOAD, BUSINESS_CODE, TS * 1000);
    expect(headers.Authorization).toBe(`Basic ${REF.hash}`);
    expect(headers.timestamp).toBe(String(TS));
  });

  it('la marca de tiempo va en segundos (10 dígitos), no en milisegundos', () => {
    const { headers } = prepararSolicitud(SERIAL, PAYLOAD, BUSINESS_CODE, TS * 1000 + 999);
    expect(headers.timestamp).toHaveLength(10);
    expect(headers.timestamp).toBe(String(TS));
  });

  it('el cuerpo cifrado se descifra con la llave de referencia y trae el contenido original, sin el campo "key"', () => {
    const { body } = prepararSolicitud(SERIAL, { ...PAYLOAD, key: 'no-debe-viajar' }, BUSINESS_CODE, TS * 1000);
    expect(Object.keys(body)).toEqual(['data']);
    const plano = descifrar(body.data, REF.aesKey);
    expect(plano).toBe(JSON.stringify(PAYLOAD));
    expect(plano).not.toContain('key');
    expect(plano).not.toContain(BUSINESS_CODE);
  });

  it('cada mensaje usa un vector de inicialización nuevo (el mismo contenido nunca se cifra igual dos veces)', () => {
    const a = prepararSolicitud(SERIAL, PAYLOAD, BUSINESS_CODE, TS * 1000).body.data;
    const b = prepararSolicitud(SERIAL, PAYLOAD, BUSINESS_CODE, TS * 1000).body.data;
    expect(a).not.toBe(b);
    expect(a.split(':')[0]).toMatch(/^[0-9a-f]{32}$/); // 16 bytes en hexadecimal
    expect(descifrar(a, REF.aesKey)).toBe(descifrar(b, REF.aesKey));
  });

  it('la firma no depende del orden en que llegue el contenido ni del cifrado: sí cambia si cambia el contenido', () => {
    const base = prepararSolicitud(SERIAL, PAYLOAD, BUSINESS_CODE, TS * 1000).headers.Authorization;
    const otro = prepararSolicitud(SERIAL, { ...PAYLOAD, amount: { ...PAYLOAD.amount, subtotal_iva0: 12001 } }, BUSINESS_CODE, TS * 1000).headers.Authorization;
    expect(otro).not.toBe(base);
  });

  it('una operación sin contenido firma y cifra el objeto vacío {}, no un texto vacío', () => {
    const { body } = prepararSolicitud(SERIAL, undefined, BUSINESS_CODE, TS * 1000);
    expect(descifrar(body.data, REF.aesKey)).toBe('{}');
    expect(prepararSolicitud(SERIAL, {}, BUSINESS_CODE, TS * 1000).headers.Authorization).toBe(prepararSolicitud(SERIAL, undefined, BUSINESS_CODE, TS * 1000).headers.Authorization);
  });

  it('el mensaje de un terminal no sirve para otro: la llave depende del serial', () => {
    const a = prepararSolicitud(SERIAL, PAYLOAD, BUSINESS_CODE, TS * 1000);
    const b = prepararSolicitud('P3F6P624J0354', PAYLOAD, BUSINESS_CODE, TS * 1000);
    expect(a.headers.Authorization).not.toBe(b.headers.Authorization);
    expect(() => descifrar(b.body.data, REF.aesKey)).toThrow();
  });
});
