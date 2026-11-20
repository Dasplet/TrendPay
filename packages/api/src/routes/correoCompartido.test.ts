import request from 'supertest';
import app, { prisma } from '../index';
import { limpiarBaseDeDatos, crearUsuarioDePrueba, crearSubcuentaDePrueba, tokenPara } from '../tests/testUtils';

describe('Varias cuentas con el mismo correo', () => {
  afterAll(async () => { await limpiarBaseDeDatos(); await prisma.$disconnect(); });
  beforeEach(async () => { await limpiarBaseDeDatos(); });

  const crear = (admin: { id: string; cedula: string; nombre: string; rol: string }, cuerpo: object) =>
    request(app).post('/api/admin/users').set('Authorization', `Bearer ${tokenPara(admin)}`).send(cuerpo);
  const nuevo = (extra: object = {}) => ({ cedula: '9001112223', nombre: 'Cool Company SAS', correo: 'cool@trendpay.test', pin: '1234', ...extra });
  const enviar = (u: { id: string; cedula: string; nombre: string; rol: string }, destino: string) =>
    request(app).post('/api/wallet/enviar').set('Authorization', `Bearer ${tokenPara(u)}`).send({ destino, monto: 10000 });
  const saldoDe = async (userId: string) => Number((await prisma.wallet.findUnique({ where: { userId } }))!.saldo);

  it('el administrador crea varias cuentas con el mismo correo y distinta cédula', async () => {
    const a = await crearUsuarioDePrueba({ rol: 'admin' });
    expect((await crear(a, nuevo())).status).toBe(201);
    const segunda = await crear(a, nuevo({ cedula: '9001112224', nombre: 'Cool Company Norte' }));
    expect(segunda.status).toBe(201);
    expect(await prisma.user.count({ where: { correo: 'cool@trendpay.test' } })).toBe(2);
  });

  it('la cédula sigue siendo única', async () => {
    const a = await crearUsuarioDePrueba({ rol: 'admin' });
    await crear(a, nuevo());
    const repetida = await crear(a, nuevo({ correo: 'otro@trendpay.test' }));
    expect(repetida.status).toBe(400);
    expect(repetida.body.mensaje).toContain('cédula');
  });

  it('cada cuenta con el mismo correo inicia sesión con su propia cédula', async () => {
    const a = await crearUsuarioDePrueba({ rol: 'admin' });
    await crear(a, nuevo());
    await crear(a, nuevo({ cedula: '9001112224', nombre: 'Cool Company Norte' }));
    for (const cedula of ['9001112223', '9001112224']) {
      const res = await request(app).post('/api/auth/login').send({ cedula, pin: '1234' });
      expect(res.status).toBe(200);
      expect(res.body.usuario.cedula).toBe(cedula);
    }
  });

  it('el registro público sigue sin dejar usar el correo de otra persona', async () => {
    const a = await crearUsuarioDePrueba({ rol: 'admin' });
    await crear(a, nuevo());
    const check = await request(app).post('/api/auth/validate-email').send({ correo: 'cool@trendpay.test' });
    expect(check.body.ok).toBe(false);
  });

  describe('enviar dinero por correo', () => {
    it('si el correo es de cuentas de titulares distintos no adivina: pide la cédula y no mueve dinero', async () => {
      const emisor = await crearUsuarioDePrueba({ saldo: 100000 });
      const a = await crearUsuarioDePrueba({ saldo: 0 });
      const b = await crearUsuarioDePrueba({ saldo: 0 });
      await prisma.user.updateMany({ where: { id: { in: [a.id, b.id] } }, data: { correo: 'compartido@trendpay.test' } });

      const res = await enviar(emisor, 'compartido@trendpay.test');
      expect(res.status).toBe(409);
      expect(res.body.mensaje).toContain('cédula');
      expect(await saldoDe(emisor.id)).toBe(100000);
      expect(await saldoDe(a.id) + await saldoDe(b.id)).toBe(0);
    });

    it('con la cédula llega a la cuenta correcta aunque el correo se repita', async () => {
      const emisor = await crearUsuarioDePrueba({ saldo: 100000 });
      const a = await crearUsuarioDePrueba({ saldo: 0 });
      const b = await crearUsuarioDePrueba({ saldo: 0 });
      await prisma.user.updateMany({ where: { id: { in: [a.id, b.id] } }, data: { correo: 'compartido@trendpay.test' } });

      expect((await enviar(emisor, b.cedula)).status).toBe(200);
      expect(await saldoDe(b.id)).toBe(10000);
      expect(await saldoDe(a.id)).toBe(0);
    });

    it('una empresa y sus sedes con el mismo correo no son ambiguas: el dinero va a la billetera de la empresa', async () => {
      const emisor = await crearUsuarioDePrueba({ saldo: 100000 });
      const empresa = await crearUsuarioDePrueba({ saldo: 0 });
      const sede = await crearSubcuentaDePrueba(empresa.id, {});
      await prisma.user.updateMany({ where: { id: { in: [empresa.id, sede.id] } }, data: { correo: 'empresa@trendpay.test' } });

      expect((await enviar(emisor, 'empresa@trendpay.test')).status).toBe(200);
      expect(await saldoDe(empresa.id)).toBe(10000);
    });
  });
});
