import request from 'supertest';
import app, { prisma } from '../index';
import { limpiarBaseDeDatos, crearUsuarioDePrueba, crearSubcuentaDePrueba, tokenPara } from '../tests/testUtils';
import { normalizarLlave, MAX_LLAVES } from './llavesBreb';

describe('Llaves Bre-B', () => {
  afterAll(async () => { await limpiarBaseDeDatos(); await prisma.$disconnect(); });
  beforeEach(async () => { await limpiarBaseDeDatos(); });

  const auth = (u: any) => ({ Authorization: `Bearer ${tokenPara(u)}` });
  const crear = (u: any, cuerpo: object) => request(app).post('/api/llaves-breb').set(auth(u)).send(cuerpo);
  const listar = (u: any) => request(app).get('/api/llaves-breb').set(auth(u));

  it('normaliza cada tipo de llave y rechaza lo que no tiene el formato', () => {
    expect(normalizarLlave('celular', '300 123 4567')).toBe('3001234567');
    expect(normalizarLlave('celular', '+57 300-123-4567')).toBe('3001234567');
    expect(normalizarLlave('celular', '2001234567')).toBeNull();   // no empieza por 3
    expect(normalizarLlave('celular', '300123456')).toBeNull();    // 9 dígitos
    expect(normalizarLlave('correo', 'Pago@Mi-Negocio.CO')).toBe('pago@mi-negocio.co');
    expect(normalizarLlave('correo', 'no-es-correo')).toBeNull();
    expect(normalizarLlave('documento', '1.023.456.789')).toBe('1023456789');
    expect(normalizarLlave('documento', '12ab')).toBeNull();
    expect(normalizarLlave('alfanumerica', '@MiComercio1')).toBe('@MiComercio1');
    expect(normalizarLlave('alfanumerica', 'sinarroba')).toBeNull();
    expect(normalizarLlave('alfanumerica', '@a')).toBeNull();
  });

  it('el cliente guarda, lista y quita sus llaves', async () => {
    const u = await crearUsuarioDePrueba();
    expect((await listar(u)).body).toMatchObject({ ok: true, llaves: [], maximo: MAX_LLAVES, puedeEditar: true });

    const c = await crear(u, { tipo: 'celular', valor: '300 123 4567', alias: 'Caja principal' });
    expect(c.status).toBe(201);
    expect(c.body.llave).toMatchObject({ tipo: 'celular', valor: '3001234567', alias: 'Caja principal', estado: 'guardada' });
    expect((await crear(u, { tipo: 'correo', valor: 'Cobros@Empresa.co' })).status).toBe(201);

    const lista = (await listar(u)).body.llaves;
    expect(lista.map((l: any) => l.valor)).toEqual(['3001234567', 'cobros@empresa.co']);

    expect((await request(app).delete(`/api/llaves-breb/${lista[0].id}`).set(auth(u))).status).toBe(200);
    expect((await listar(u)).body.llaves).toHaveLength(1);
    expect((await request(app).delete(`/api/llaves-breb/${lista[0].id}`).set(auth(u))).status).toBe(404);
    expect(await prisma.userAuditLog.count({ where: { userId: u.id, accion: { in: ['AGREGAR_LLAVE_BREB', 'QUITAR_LLAVE_BREB'] } } })).toBe(3);
  });

  it('valida el formato, no repite llaves y tiene un máximo', async () => {
    const u = await crearUsuarioDePrueba();
    const mal = await crear(u, { tipo: 'celular', valor: '12345' });
    expect(mal.status).toBe(400);
    expect(mal.body.mensaje).toMatch(/celular/i);
    expect((await crear(u, { tipo: 'otro', valor: 'x' })).status).toBe(400);

    expect((await crear(u, { tipo: 'documento', valor: '1023456789' })).status).toBe(201);
    expect((await crear(u, { tipo: 'documento', valor: '1.023.456.789' })).status).toBe(409);

    for (const n of [1, 2, 3, 4]) await crear(u, { tipo: 'alfanumerica', valor: `@comercio${n}` });
    const demas = await crear(u, { tipo: 'alfanumerica', valor: '@comercio9' });
    expect(demas.status).toBe(400);
    expect(demas.body.mensaje).toMatch(/hasta 5/);
  });

  it('cada cuenta ve solo las suyas, y una sede las ve pero no las cambia', async () => {
    const empresa = await crearUsuarioDePrueba();
    const otra = await crearUsuarioDePrueba();
    const sede = await crearSubcuentaDePrueba(empresa.id, {});
    const g = await crear(empresa, { tipo: 'celular', valor: '3001234567' });
    expect(g.status).toBe(201);

    expect((await listar(otra)).body.llaves).toHaveLength(0);
    const vistaSede = await listar(sede);
    expect(vistaSede.body.llaves).toHaveLength(1);
    expect(vistaSede.body.puedeEditar).toBe(false);

    expect((await crear(sede, { tipo: 'correo', valor: 'sede@empresa.co' })).status).toBe(403);
    expect((await request(app).delete(`/api/llaves-breb/${g.body.llave.id}`).set(auth(sede))).status).toBe(403);
    // otra cuenta no puede borrar la llave de la empresa
    expect((await request(app).delete(`/api/llaves-breb/${g.body.llave.id}`).set(auth(otra))).status).toBe(404);
    expect(await prisma.llaveBreb.count()).toBe(1);
  });

  it('exige estar autenticado', async () => {
    expect((await request(app).get('/api/llaves-breb')).status).toBe(401);
    expect((await request(app).post('/api/llaves-breb').send({ tipo: 'celular', valor: '3001234567' })).status).toBe(401);
  });
});
