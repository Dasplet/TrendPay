import request from 'supertest';
import app, { prisma } from '../index';
import { limpiarBaseDeDatos, crearUsuarioDePrueba, tokenPara } from '../tests/testUtils';

jest.mock('../utils/kushki', () => {
  const actual = jest.requireActual('../utils/kushki');
  return { ...actual, getConfigTransferencias: jest.fn() };
});
import { getConfigTransferencias, KushkiError } from '../utils/kushki';

describe('GET /api/admin/kushki/config-transferencias', () => {
  const original = process.env.KUSHKI_PUBLIC_MERCHANT_ID;
  afterAll(async () => {
    if (original === undefined) delete process.env.KUSHKI_PUBLIC_MERCHANT_ID; else process.env.KUSHKI_PUBLIC_MERCHANT_ID = original;
    await limpiarBaseDeDatos();
    await prisma.$disconnect();
  });
  beforeEach(async () => { await limpiarBaseDeDatos(); jest.clearAllMocks(); });

  it('solo el admin puede consultarla', async () => {
    const user = await crearUsuarioDePrueba();
    const res = await request(app).get('/api/admin/kushki/config-transferencias').set('Authorization', `Bearer ${tokenPara(user)}`);
    expect(res.status).toBe(403);
  });

  it('devuelve los procesadores, la respuesta cruda y con qué comercio se consultó (solo el final de la llave)', async () => {
    process.env.KUSHKI_PUBLIC_MERCHANT_ID = '20432ef8ccd94r51b36e5b738a81f511';
    (getConfigTransferencias as jest.Mock).mockResolvedValue({ procesadores: [], respuesta: { processors: [] } });
    const admin = await crearUsuarioDePrueba({ rol: 'admin' });
    const res = await request(app).get('/api/admin/kushki/config-transferencias').set('Authorization', `Bearer ${tokenPara(admin)}`);
    expect(res.status).toBe(200);
    expect(res.body.procesadores).toEqual([]);
    expect(res.body.respuesta).toEqual({ processors: [] });
    expect(res.body.entorno.llavePublicaTermina).toBe('…f511');
    expect(res.body.entorno.llavePublicaConfigurada).toBe(true);
    expect(JSON.stringify(res.body)).not.toContain('20432ef8ccd94r51b36e5b738a81f511');
  });

  it('si Kushki rechaza la consulta muestra su motivo', async () => {
    (getConfigTransferencias as jest.Mock).mockRejectedValue(new KushkiError('Unauthorized', 401, { respuesta: { message: 'Unauthorized' } }));
    const admin = await crearUsuarioDePrueba({ rol: 'admin' });
    const res = await request(app).get('/api/admin/kushki/config-transferencias').set('Authorization', `Bearer ${tokenPara(admin)}`);
    expect(res.status).toBe(401);
    expect(res.body).toMatchObject({ ok: false, mensaje: 'Unauthorized', respuesta: { message: 'Unauthorized' } });
  });
});
