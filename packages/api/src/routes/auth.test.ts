import request from 'supertest';
import app, { prisma } from '../index';
import { limpiarBaseDeDatos, crearUsuarioDePrueba, tokenPara } from '../tests/testUtils';

describe('Auth API', () => {
  afterAll(async () => {
    await limpiarBaseDeDatos();
    await prisma.$disconnect();
  });

  beforeEach(async () => {
    await limpiarBaseDeDatos();
  });

  describe('POST /api/auth/register', () => {
    it('crea la cuenta con billetera en cero y devuelve tokens', async () => {
      const res = await request(app).post('/api/auth/register').send({
        cedula: '5551112233',
        nombre: 'Nuevo Usuario Registro',
        correo: 'registro.test@trendpay.test',
        pin: '1357',
      });

      expect(res.status).toBe(201);
      expect(res.body.accessToken).toBeDefined();
      expect(res.body.usuario.saldo).toBe(0);

      const creado = await prisma.user.findUnique({ where: { cedula: '5551112233' } });
      expect(creado).not.toBeNull();
      expect(creado!.pinHash).not.toBe('1357');
    });
  });

  describe('PUT /api/auth/change-pin', () => {
    it('cambia el PIN cuando el actual es correcto', async () => {
      const user = await crearUsuarioDePrueba(); // PIN de prueba: 1234

      const res = await request(app)
        .put('/api/auth/change-pin')
        .set('Authorization', `Bearer ${tokenPara(user)}`)
        .send({ pin_actual: '1234', pin_nuevo: '5678', pin_confirmar: '5678' });

      expect(res.status).toBe(200);

      const actualizado = await prisma.user.findUnique({ where: { id: user.id } });
      expect(actualizado!.pinHash).not.toBe(user.pinHash);
    });

    it('rechaza el cambio si el PIN actual no coincide', async () => {
      const user = await crearUsuarioDePrueba();
      const res = await request(app)
        .put('/api/auth/change-pin')
        .set('Authorization', `Bearer ${tokenPara(user)}`)
        .send({ pin_actual: '0000', pin_nuevo: '5678', pin_confirmar: '5678' });
      expect(res.status).toBe(400);
    });
  });
});
