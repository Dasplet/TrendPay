import request from 'supertest';
import app, { prisma } from '../index';
import { limpiarBaseDeDatos, crearUsuarioDePrueba, tokenPara } from '../tests/testUtils';

describe('User audit API', () => {
  afterAll(async () => {
    await limpiarBaseDeDatos();
    await prisma.$disconnect();
  });

  beforeEach(async () => {
    await limpiarBaseDeDatos();
  });

  describe('GET /api/user-audit/admin', () => {
    it('rechaza a un usuario que no es admin', async () => {
      const user = await crearUsuarioDePrueba();
      const res = await request(app).get('/api/user-audit/admin').set('Authorization', `Bearer ${tokenPara(user)}`);
      expect(res.status).toBe(403);
    });

    it('lista los cambios registrados con los datos del usuario afectado', async () => {
      const admin = await crearUsuarioDePrueba({ rol: 'admin' });
      const user = await crearUsuarioDePrueba({ nombre: 'Cliente De Prueba' });
      await prisma.userAuditLog.create({
        data: { userId: user.id, accion: 'CAMBIO_PIN', campo: 'pin', valorAntes: '****', valorDespues: '****' },
      });

      const res = await request(app).get('/api/user-audit/admin').set('Authorization', `Bearer ${tokenPara(admin)}`);

      expect(res.status).toBe(200);
      expect(res.body.logs).toHaveLength(1);
      expect(res.body.logs[0].accion).toBe('CAMBIO_PIN');
      expect(res.body.logs[0].usuario_nombre).toBe('Cliente De Prueba');
      expect(res.body.logs[0].usuario_cedula).toBe(user.cedula);
    });

    it('respeta el límite pedido por query string', async () => {
      const admin = await crearUsuarioDePrueba({ rol: 'admin' });
      const user = await crearUsuarioDePrueba();
      for (let i = 0; i < 3; i++) {
        await prisma.userAuditLog.create({ data: { userId: user.id, accion: 'CAMBIO_PERFIL', campo: 'nombre' } });
      }

      const res = await request(app)
        .get('/api/user-audit/admin?limit=2')
        .set('Authorization', `Bearer ${tokenPara(admin)}`);

      expect(res.status).toBe(200);
      expect(res.body.logs).toHaveLength(2);
    });
  });
});
