import request from 'supertest';
import app, { prisma } from '../index';
import { limpiarBaseDeDatos, crearUsuarioDePrueba, tokenPara } from '../tests/testUtils';

describe('Bank accounts API', () => {
  afterAll(async () => {
    await limpiarBaseDeDatos();
    await prisma.$disconnect();
  });

  beforeEach(async () => {
    await limpiarBaseDeDatos();
  });

  describe('GET /api/bank-accounts', () => {
    it('devuelve una lista vacía cuando el usuario no tiene bancos vinculados', async () => {
      const user = await crearUsuarioDePrueba();
      const res = await request(app).get('/api/bank-accounts').set('Authorization', `Bearer ${tokenPara(user)}`);
      expect(res.status).toBe(200);
      expect(res.body.cuentas).toEqual([]);
    });
  });

  describe('POST /api/bank-accounts', () => {
    it('vincula un banco y cifra el número de cuenta y la cédula en la base de datos', async () => {
      const user = await crearUsuarioDePrueba();
      const res = await request(app)
        .post('/api/bank-accounts')
        .set('Authorization', `Bearer ${tokenPara(user)}`)
        .send({
          bancoNombre: 'Bancolombia',
          tipoCuenta: 'ahorros',
          numeroCuenta: '1234567890',
          cedulaTitular: '1023456789',
          nombreTitular: user.nombre,
        });

      expect(res.status).toBe(201);
      expect(res.body.cuenta.numeroCuentaMasked).toMatch(/7890$/);

      const guardada = await prisma.bankAccount.findFirst({ where: { userId: user.id } });
      expect(guardada!.numeroCuenta).not.toBe('1234567890');
      expect(guardada!.cedulaTitular).not.toBe('1023456789');
    });

    it('rechaza datos incompletos', async () => {
      const user = await crearUsuarioDePrueba();
      const res = await request(app)
        .post('/api/bank-accounts')
        .set('Authorization', `Bearer ${tokenPara(user)}`)
        .send({ bancoNombre: 'Bancolombia' });
      expect(res.status).toBe(400);
    });
  });

  describe('DELETE /api/bank-accounts/:id', () => {
    it('elimina una cuenta bancaria propia', async () => {
      const user = await crearUsuarioDePrueba();
      const cuenta = await prisma.bankAccount.create({
        data: {
          userId: user.id,
          bancoNombre: 'Nequi',
          tipoCuenta: 'ahorros',
          numeroCuenta: 'cifrado',
          cedulaTitular: 'cifrado',
          nombreTitular: user.nombre,
        },
      });

      const res = await request(app)
        .delete(`/api/bank-accounts/${cuenta.id}`)
        .set('Authorization', `Bearer ${tokenPara(user)}`);

      expect(res.status).toBe(200);
      const eliminada = await prisma.bankAccount.findUnique({ where: { id: cuenta.id } });
      expect(eliminada).toBeNull();
    });

    it('rechaza eliminar la cuenta bancaria de otro usuario', async () => {
      const user = await crearUsuarioDePrueba();
      const otro = await crearUsuarioDePrueba();
      const cuentaDeOtro = await prisma.bankAccount.create({
        data: {
          userId: otro.id,
          bancoNombre: 'Nequi',
          tipoCuenta: 'ahorros',
          numeroCuenta: 'cifrado',
          cedulaTitular: 'cifrado',
          nombreTitular: otro.nombre,
        },
      });

      const res = await request(app)
        .delete(`/api/bank-accounts/${cuentaDeOtro.id}`)
        .set('Authorization', `Bearer ${tokenPara(user)}`);

      expect(res.status).toBe(404);
      const sigueExistiendo = await prisma.bankAccount.findUnique({ where: { id: cuentaDeOtro.id } });
      expect(sigueExistiendo).not.toBeNull();
    });

    it('devuelve 404 si la cuenta no existe', async () => {
      const user = await crearUsuarioDePrueba();
      const res = await request(app)
        .delete('/api/bank-accounts/no-existe')
        .set('Authorization', `Bearer ${tokenPara(user)}`);
      expect(res.status).toBe(404);
    });
  });
});
