import request from 'supertest';
import app, { prisma } from '../index';
import { limpiarBaseDeDatos, crearUsuarioDePrueba, tokenPara } from '../tests/testUtils';

const datosRetiro = {
  bancoNombre: 'Bancolombia',
  tipoCuenta: 'ahorros',
  numeroCuenta: '04512345678',
  cedulaTitular: '1023456789',
  nombreTitular: 'Usuario de Prueba',
};

describe('Withdrawals API', () => {
  afterAll(async () => {
    await limpiarBaseDeDatos();
    await prisma.$disconnect();
  });

  beforeEach(async () => {
    await limpiarBaseDeDatos();
  });

  describe('POST /api/withdrawals', () => {
    it('crea la solicitud, debita el saldo de inmediato y queda pendiente', async () => {
      const user = await crearUsuarioDePrueba({ saldo: 100000 });

      const res = await request(app)
        .post('/api/withdrawals')
        .set('Authorization', `Bearer ${tokenPara(user)}`)
        .send({ ...datosRetiro, monto: 50000 });

      expect(res.status).toBe(201);
      expect(res.body.saldo).toBe(50000);

      const wallet = await prisma.wallet.findUnique({ where: { userId: user.id } });
      expect(Number(wallet!.saldo)).toBe(50000);

      const withdrawal = await prisma.withdrawal.findFirst({ where: { userId: user.id } });
      expect(withdrawal?.status).toBe('pendiente');
      expect(withdrawal?.numeroCuenta).not.toBe(datosRetiro.numeroCuenta); // debe quedar cifrado, no en texto plano
    });

    it('rechaza montos por debajo del mínimo (fallback $10.000 si no hay Config)', async () => {
      const user = await crearUsuarioDePrueba({ saldo: 100000 });
      const res = await request(app)
        .post('/api/withdrawals')
        .set('Authorization', `Bearer ${tokenPara(user)}`)
        .send({ ...datosRetiro, monto: 5000 });
      expect(res.status).toBe(400);

      const wallet = await prisma.wallet.findUnique({ where: { userId: user.id } });
      expect(Number(wallet!.saldo)).toBe(100000); // sin cambios
    });

    it('rechaza si el saldo es insuficiente', async () => {
      const user = await crearUsuarioDePrueba({ saldo: 10000 });
      const res = await request(app)
        .post('/api/withdrawals')
        .set('Authorization', `Bearer ${tokenPara(user)}`)
        .send({ ...datosRetiro, monto: 50000 });
      expect(res.status).toBe(400);
    });
  });

  describe('GET /api/withdrawals/me', () => {
    it('devuelve los propios retiros con el número de cuenta enmascarado', async () => {
      const user = await crearUsuarioDePrueba({ saldo: 100000 });
      await request(app).post('/api/withdrawals').set('Authorization', `Bearer ${tokenPara(user)}`).send({ ...datosRetiro, monto: 20000 });

      const res = await request(app).get('/api/withdrawals/me').set('Authorization', `Bearer ${tokenPara(user)}`);
      expect(res.status).toBe(200);
      expect(res.body.retiros).toHaveLength(1);
      expect(res.body.retiros[0].numero_cuenta_masked).toBe('*******5678');
      expect(res.body.retiros[0].numero_cuenta).toBeUndefined();
    });
  });

  describe('Cola de administración', () => {
    it('un usuario normal no puede ver ni aprobar retiros pendientes', async () => {
      const user = await crearUsuarioDePrueba({ saldo: 100000 });
      const pend = await request(app).get('/api/withdrawals/pending').set('Authorization', `Bearer ${tokenPara(user)}`);
      expect(pend.status).toBe(403);
    });

    it('el admin aprueba un retiro y este pasa a procesado', async () => {
      const user = await crearUsuarioDePrueba({ saldo: 100000 });
      const admin = await crearUsuarioDePrueba({ saldo: 0, rol: 'admin' });

      const crear = await request(app).post('/api/withdrawals').set('Authorization', `Bearer ${tokenPara(user)}`).send({ ...datosRetiro, monto: 30000 });
      const withdrawalId = (await prisma.withdrawal.findFirst({ where: { userId: user.id } }))!.id;
      expect(crear.status).toBe(201);

      const pend = await request(app).get('/api/withdrawals/pending').set('Authorization', `Bearer ${tokenPara(admin)}`);
      expect(pend.body.retiros).toHaveLength(1);
      expect(pend.body.retiros[0].numero_cuenta).toBe(datosRetiro.numeroCuenta); // admin ve el número completo para poder transferir

      const aprobar = await request(app).put(`/api/withdrawals/${withdrawalId}/approve`).set('Authorization', `Bearer ${tokenPara(admin)}`);
      expect(aprobar.status).toBe(200);

      const withdrawal = await prisma.withdrawal.findUnique({ where: { id: withdrawalId } });
      expect(withdrawal?.status).toBe('procesado');

      // el saldo del usuario no cambia al aprobar (ya se había debitado al crear la solicitud)
      const wallet = await prisma.wallet.findUnique({ where: { userId: user.id } });
      expect(Number(wallet!.saldo)).toBe(70000);
    });

    it('el admin rechaza un retiro y el saldo se revierte por completo', async () => {
      const user = await crearUsuarioDePrueba({ saldo: 100000 });
      const admin = await crearUsuarioDePrueba({ saldo: 0, rol: 'admin' });

      await request(app).post('/api/withdrawals').set('Authorization', `Bearer ${tokenPara(user)}`).send({ ...datosRetiro, monto: 30000 });
      const withdrawalId = (await prisma.withdrawal.findFirst({ where: { userId: user.id } }))!.id;

      const rechazar = await request(app)
        .put(`/api/withdrawals/${withdrawalId}/reject`)
        .set('Authorization', `Bearer ${tokenPara(admin)}`)
        .send({ motivo: 'Datos bancarios incorrectos' });
      expect(rechazar.status).toBe(200);

      const withdrawal = await prisma.withdrawal.findUnique({ where: { id: withdrawalId } });
      expect(withdrawal?.status).toBe('rechazado');
      expect(withdrawal?.notasAdmin).toBe('Datos bancarios incorrectos');

      const wallet = await prisma.wallet.findUnique({ where: { userId: user.id } });
      expect(Number(wallet!.saldo)).toBe(100000); // saldo íntegramente devuelto
    });

    it('no permite aprobar dos veces el mismo retiro', async () => {
      const user = await crearUsuarioDePrueba({ saldo: 100000 });
      const admin = await crearUsuarioDePrueba({ saldo: 0, rol: 'admin' });

      await request(app).post('/api/withdrawals').set('Authorization', `Bearer ${tokenPara(user)}`).send({ ...datosRetiro, monto: 30000 });
      const withdrawalId = (await prisma.withdrawal.findFirst({ where: { userId: user.id } }))!.id;

      await request(app).put(`/api/withdrawals/${withdrawalId}/approve`).set('Authorization', `Bearer ${tokenPara(admin)}`);
      const segundaVez = await request(app).put(`/api/withdrawals/${withdrawalId}/approve`).set('Authorization', `Bearer ${tokenPara(admin)}`);
      expect(segundaVez.status).toBe(400);
    });
  });
});
