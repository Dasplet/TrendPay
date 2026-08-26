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

  describe('POST /api/auth/login', () => {
    it('inicia sesión con cédula y PIN correctos', async () => {
      const user = await crearUsuarioDePrueba({ saldo: 15000 }); // PIN de prueba: 1234

      const res = await request(app).post('/api/auth/login').send({ cedula: user.cedula, pin: '1234' });

      expect(res.status).toBe(200);
      expect(res.body.accessToken).toBeDefined();
      expect(res.body.usuario.saldo).toBe(15000);
      expect(res.body.usuario.cedula).toBe(user.cedula);
    });

    it('rechaza un PIN incorrecto', async () => {
      const user = await crearUsuarioDePrueba();
      const res = await request(app).post('/api/auth/login').send({ cedula: user.cedula, pin: '0000' });
      expect(res.status).toBe(401);
    });

    it('pide verificación en dos pasos y completa el login con el código correcto', async () => {
      const user = await crearUsuarioDePrueba();
      await prisma.user.update({ where: { id: user.id }, data: { requiere2fa: true } });

      const login = await request(app).post('/api/auth/login').send({ cedula: user.cedula, pin: '1234' });
      expect(login.status).toBe(200);
      expect(login.body.requiere2fa).toBe(true);
      expect(login.body.otp_debug).toBeDefined();

      const verify = await request(app)
        .post('/api/auth/login/verify-2fa')
        .send({ cedula: user.cedula, otp: login.body.otp_debug });

      expect(verify.status).toBe(200);
      expect(verify.body.accessToken).toBeDefined();
    });
  });

  describe('GET /api/auth/me', () => {
    it('devuelve el usuario autenticado con su saldo', async () => {
      const user = await crearUsuarioDePrueba({ saldo: 7000 });
      const res = await request(app).get('/api/auth/me').set('Authorization', `Bearer ${tokenPara(user)}`);
      expect(res.status).toBe(200);
      expect(res.body.usuario.saldo).toBe(7000);
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
