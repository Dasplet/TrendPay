import crypto from 'node:crypto';

const LLAVE_V1 = 'llave-antigua-de-32-caracteres!!';
const LLAVE_V2 = crypto.randomBytes(32).toString('hex');

// security.ts lee las llaves al cargarse: cada caso lo importa con su propio entorno
function cargarSecurity(env: Record<string, string | undefined>) {
  const antes = { v1: process.env.ENCRYPTION_KEY, v2: process.env.ENCRYPTION_KEY_V2 };
  process.env.ENCRYPTION_KEY = env.ENCRYPTION_KEY ?? LLAVE_V1;
  if (env.ENCRYPTION_KEY_V2 === undefined) delete process.env.ENCRYPTION_KEY_V2; else process.env.ENCRYPTION_KEY_V2 = env.ENCRYPTION_KEY_V2;
  let modulo!: typeof import('./security');
  jest.isolateModules(() => { modulo = require('./security'); });
  if (antes.v1 === undefined) delete process.env.ENCRYPTION_KEY; else process.env.ENCRYPTION_KEY = antes.v1;
  if (antes.v2 === undefined) delete process.env.ENCRYPTION_KEY_V2; else process.env.ENCRYPTION_KEY_V2 = antes.v2;
  return modulo;
}

describe('Cifrado con llave de KMS (v2) compatible con lo guardado (v1)', () => {
  const soloV1 = cargarSecurity({});
  const conV2 = cargarSecurity({ ENCRYPTION_KEY_V2: LLAVE_V2 });

  it('sin llave v2 todo sigue igual: formato antiguo, sin prefijo', () => {
    expect(soloV1.cifradoV2Activo()).toBe(false);
    const c = soloV1.encrypt('1234567890');
    expect(c.startsWith('v2:')).toBe(false);
    expect(soloV1.esCifradoV2(c)).toBe(false);
    expect(soloV1.decrypt(c)).toBe('1234567890');
  });

  it('con llave v2 lo nuevo se cifra en v2 y se lee de vuelta', () => {
    expect(conV2.cifradoV2Activo()).toBe(true);
    const c = conV2.encrypt('1234567890');
    expect(c.startsWith('v2:')).toBe(true);
    expect(conV2.esCifradoV2(c)).toBe(true);
    expect(conV2.decrypt(c)).toBe('1234567890');
  });

  it('con llave v2 todavía se lee lo guardado con la llave antigua', () => {
    const antiguo = soloV1.encrypt('cuenta-vieja');
    expect(conV2.decrypt(antiguo)).toBe('cuenta-vieja');
  });

  it('un valor v2 no se puede leer sin la llave v2 ni con otra llave', () => {
    const c = conV2.encrypt('secreto');
    expect(soloV1.decrypt(c)).toBe('****');
    const otra = cargarSecurity({ ENCRYPTION_KEY_V2: crypto.randomBytes(32).toString('hex') });
    expect(otra.decrypt(c)).toBe('****');
  });

  it('detecta manipulación de un valor v2', () => {
    const c = conV2.encrypt('1023456789');
    expect(conV2.decrypt(c.slice(0, -2) + '00')).toBe('****');
  });

  it('archivos: v2 lleva marca, ida y vuelta, y los antiguos siguen abriendo', () => {
    const contenido = Buffer.from('%PDF-1.4 contenido de prueba');
    const nuevo = conV2.encryptBuffer(contenido);
    expect(conV2.esCifradoV2(nuevo)).toBe(true);
    expect(nuevo.subarray(0, 8).toString()).toBe('TPCRYPT2');
    expect(conV2.decryptBuffer(nuevo).equals(contenido)).toBe(true);

    const antiguo = soloV1.encryptBuffer(contenido);
    expect(conV2.esCifradoV2(antiguo)).toBe(false);
    expect(conV2.decryptBuffer(antiguo).equals(contenido)).toBe(true);
  });

  it('archivos: un archivo v2 sin la llave v2 lanza error y uno alterado también', () => {
    const nuevo = conV2.encryptBuffer(Buffer.from('datos'));
    expect(() => soloV1.decryptBuffer(nuevo)).toThrow();
    const alterado = Buffer.from(nuevo);
    alterado[alterado.length - 1] ^= 0xff;
    expect(() => conV2.decryptBuffer(alterado)).toThrow();
  });

  it('rechaza una llave v2 mal formada al arrancar', () => {
    expect(() => cargarSecurity({ ENCRYPTION_KEY_V2: 'corta' })).toThrow(/ENCRYPTION_KEY_V2/);
  });
});
