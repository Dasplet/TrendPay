import request from 'supertest';
import app, { prisma } from '../index';
import { limpiarBaseDeDatos, crearUsuarioDePrueba, tokenPara } from '../tests/testUtils';

describe('Users API', () => {
  afterAll(async () => {
    await limpiarBaseDeDatos();
    await prisma.$disconnect();
  });

  beforeEach(async () => {
    await limpiarBaseDeDatos();
  });

  describe('GET /api/users/profile', () => {
    it('devuelve el perfil con el saldo de la billetera', async () => {
      const user = await crearUsuarioDePrueba({ saldo: 33000 });
      const res = await request(app).get('/api/users/profile').set('Authorization', `Bearer ${tokenPara(user)}`);
      expect(res.status).toBe(200);
      expect(res.body.usuario.saldo).toBe(33000);
      expect(res.body.usuario.cedula).toBe(user.cedula);
    });
  });

  describe('PUT /api/users/profile', () => {
    it('actualiza los datos del perfil y deja registro en la auditoría', async () => {
      const user = await crearUsuarioDePrueba({ nombre: 'Nombre Viejo' });
      const res = await request(app)
        .put('/api/users/profile')
        .set('Authorization', `Bearer ${tokenPara(user)}`)
        .send({ nombre: 'Nombre Nuevo', ciudad: 'Bogotá' });

      expect(res.status).toBe(200);
      expect(res.body.usuario.nombre).toBe('Nombre Nuevo');
      expect(res.body.usuario.ciudad).toBe('Bogotá');

      const log = await prisma.userAuditLog.findFirst({ where: { userId: user.id, accion: 'ACTUALIZACION_PERFIL' } });
      expect(log).not.toBeNull();
    });

    it('rechaza un correo con formato inválido', async () => {
      const user = await crearUsuarioDePrueba();
      const res = await request(app)
        .put('/api/users/profile')
        .set('Authorization', `Bearer ${tokenPara(user)}`)
        .send({ correo: 'no-es-un-correo' });
      expect(res.status).toBe(400);
    });
  });
});
