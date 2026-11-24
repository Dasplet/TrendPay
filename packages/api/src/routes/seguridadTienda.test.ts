import request from 'supertest';
import app, { prisma } from '../index';
import { limpiarBaseDeDatos, crearUsuarioDePrueba, crearSubcuentaDePrueba, tokenPara } from '../tests/testUtils';

describe('El PIN, la verificación en dos pasos y las sesiones son solo de la cuenta principal', () => {
  afterAll(async () => { await limpiarBaseDeDatos(); await prisma.$disconnect(); });
  beforeEach(async () => { await limpiarBaseDeDatos(); });

  async function cuentas() {
    const principal = await crearUsuarioDePrueba({ saldo: 0 });
    const tienda = await crearSubcuentaDePrueba(principal.id, {});
    return { principal, tienda };
  }
  const auth = (u: any) => ({ Authorization: `Bearer ${tokenPara(u)}` });
  const cambioPin = { pin_actual: '1234', pin_nuevo: '4321', pin_confirmar: '4321' };

  it('una tienda no puede cambiar el PIN, ni tocar la verificación en dos pasos, ni ver o cerrar sesiones', async () => {
    const { tienda } = await cuentas();
    const rutas: [string, string, object?][] = [
      ['put', '/api/auth/change-pin', cambioPin],
      ['post', '/api/auth/2fa/solicitar', { proposito: 'activar', pin: '1234' }],
      ['post', '/api/auth/2fa/activar', { codigo: '123456' }],
      ['post', '/api/auth/2fa/desactivar', { pin: '1234', codigo: '123456' }],
      ['get', '/api/auth/sessions'],
      ['delete', '/api/auth/sessions/00000000-0000-4000-8000-000000000000'],
      ['post', '/api/auth/sessions/revoke-others', {}],
    ];
    for (const [metodo, ruta, cuerpo] of rutas) {
      const r = await (request(app) as any)[metodo](ruta).set(auth(tienda)).send(cuerpo ?? {});
      expect([metodo, ruta, r.status]).toEqual([metodo, ruta, 403]);
      expect(r.body.mensaje).toMatch(/cuenta principal/);
    }
    // el PIN de la tienda sigue siendo el mismo
    const login = await request(app).post('/api/auth/login').send({ cedula: tienda.cedula, pin: '1234' });
    expect(login.status).toBe(200);
  });

  it('la cuenta principal sí puede, y la tienda sigue pudiendo entrar, ver su cuenta y cerrar sesión', async () => {
    const { principal, tienda } = await cuentas();
    expect((await request(app).put('/api/auth/change-pin').set(auth(principal)).send(cambioPin)).status).toBe(200);
    expect((await request(app).get('/api/auth/sessions').set(auth(principal))).status).toBe(200);
    expect((await request(app).get('/api/auth/2fa/estado').set(auth(tienda))).status).toBe(200);
    expect((await request(app).get('/api/auth/me').set(auth(tienda))).status).toBe(200);
    expect((await request(app).post('/api/auth/logout').set(auth(tienda))).status).toBe(200);
  });

  it('una cuenta sin empresa (usuario normal) tampoco se ve afectada', async () => {
    const solo = await crearUsuarioDePrueba({ saldo: 0 });
    expect((await request(app).put('/api/auth/change-pin').set(auth(solo)).send(cambioPin)).status).toBe(200);
  });
});
