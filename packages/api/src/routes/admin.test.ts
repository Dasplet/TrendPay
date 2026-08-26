import request from 'supertest';
import app, { prisma } from '../index';
import { limpiarBaseDeDatos, crearUsuarioDePrueba, tokenPara } from '../tests/testUtils';

const nuevoUsuario = {
  cedula: '9988776655',
  nombre: 'Usuario Nuevo Admin',
  correo: 'nuevo.admin.test@trendpay.test',
  pin: '4321',
};

describe('Admin API', () => {
  afterAll(async () => {
    await limpiarBaseDeDatos();
    await prisma.$disconnect();
  });

  beforeEach(async () => {
    await limpiarBaseDeDatos();
  });

  describe('POST /api/admin/users', () => {
    it('un usuario normal no puede crear usuarios', async () => {
      const user = await crearUsuarioDePrueba();
      const res = await request(app)
        .post('/api/admin/users')
        .set('Authorization', `Bearer ${tokenPara(user)}`)
        .send(nuevoUsuario);
      expect(res.status).toBe(403);
    });

    it('el admin crea un usuario con billetera en cero y queda auditado', async () => {
      const admin = await crearUsuarioDePrueba({ rol: 'admin' });
      const res = await request(app)
        .post('/api/admin/users')
        .set('Authorization', `Bearer ${tokenPara(admin)}`)
        .send(nuevoUsuario);

      expect(res.status).toBe(201);
      expect(res.body.usuario.cedula).toBe(nuevoUsuario.cedula);
      expect(res.body.usuario.rol).toBe('usuario');
      expect(res.body.usuario.saldo).toBe(0);

      const creado = await prisma.user.findUnique({ where: { cedula: nuevoUsuario.cedula }, include: { wallet: true } });
      expect(creado).not.toBeNull();
      expect(Number(creado!.wallet!.saldo)).toBe(0);
      expect(creado!.pinHash).not.toBe(nuevoUsuario.pin); // el PIN debe quedar hasheado

      const auditLog = await prisma.auditLog.findFirst({ where: { accion: 'CREAR_USUARIO', registroId: creado!.id } });
      expect(auditLog).not.toBeNull();
      expect((auditLog!.datos as any).despues.cedula).toBe(nuevoUsuario.cedula);
    });

    it('rechaza una cédula ya registrada', async () => {
      const admin = await crearUsuarioDePrueba({ rol: 'admin' });
      const existente = await crearUsuarioDePrueba();
      const res = await request(app)
        .post('/api/admin/users')
        .set('Authorization', `Bearer ${tokenPara(admin)}`)
        .send({ ...nuevoUsuario, cedula: existente.cedula });
      expect(res.status).toBe(400);
      expect(res.body.mensaje).toMatch(/cédula/i);
    });

    it('rechaza un PIN que no tenga 4 dígitos', async () => {
      const admin = await crearUsuarioDePrueba({ rol: 'admin' });
      const res = await request(app)
        .post('/api/admin/users')
        .set('Authorization', `Bearer ${tokenPara(admin)}`)
        .send({ ...nuevoUsuario, pin: '12' });
      expect(res.status).toBe(400);
    });
  });

  describe('PUT /api/admin/users/:id', () => {
    it('actualiza los campos enviados y registra el antes/después en la auditoría', async () => {
      const admin = await crearUsuarioDePrueba({ rol: 'admin' });
      const target = await crearUsuarioDePrueba({ nombre: 'Nombre Original' });

      const res = await request(app)
        .put(`/api/admin/users/${target.id}`)
        .set('Authorization', `Bearer ${tokenPara(admin)}`)
        .send({ nombre: 'Nombre Actualizado', bloqueado: true });

      expect(res.status).toBe(200);
      expect(res.body.usuario.nombre).toBe('Nombre Actualizado');
      expect(res.body.usuario.bloqueado).toBe(true);

      const auditLog = await prisma.auditLog.findFirst({ where: { accion: 'EDITAR_USUARIO', registroId: target.id } });
      expect(auditLog).not.toBeNull();
      const datos = auditLog!.datos as any;
      expect(datos.antes.nombre).toBe('Nombre Original');
      expect(datos.despues.nombre).toBe('Nombre Actualizado');
      expect(datos.antes.bloqueado).toBe(false);
      expect(datos.despues.bloqueado).toBe(true);
    });

    it('no registra auditoría cuando ningún campo cambia realmente', async () => {
      const admin = await crearUsuarioDePrueba({ rol: 'admin' });
      const target = await crearUsuarioDePrueba({ nombre: 'Nombre Igual' });

      await request(app)
        .put(`/api/admin/users/${target.id}`)
        .set('Authorization', `Bearer ${tokenPara(admin)}`)
        .send({ nombre: 'Nombre Igual' });

      const auditLog = await prisma.auditLog.findFirst({ where: { accion: 'EDITAR_USUARIO', registroId: target.id } });
      expect(auditLog).not.toBeNull();
      const datos = auditLog!.datos as any;
      expect(datos.antes).toEqual({});
      expect(datos.despues).toEqual({});
    });

    it('devuelve 404 si el usuario no existe', async () => {
      const admin = await crearUsuarioDePrueba({ rol: 'admin' });
      const res = await request(app)
        .put('/api/admin/users/00000000-0000-0000-0000-000000000000')
        .set('Authorization', `Bearer ${tokenPara(admin)}`)
        .send({ nombre: 'X' });
      expect(res.status).toBe(404);
    });
  });

  describe('DELETE /api/admin/users/:id', () => {
    it('elimina (soft-delete) al usuario y guarda sus datos previos en la auditoría', async () => {
      const admin = await crearUsuarioDePrueba({ rol: 'admin' });
      const target = await crearUsuarioDePrueba({ nombre: 'Por Eliminar' });

      const res = await request(app)
        .delete(`/api/admin/users/${target.id}`)
        .set('Authorization', `Bearer ${tokenPara(admin)}`);
      expect(res.status).toBe(200);

      const eliminado = await prisma.user.findUnique({ where: { id: target.id } });
      expect(eliminado!.bloqueado).toBe(true);
      expect(eliminado!.nombre).toBe('Usuario eliminado');

      const auditLog = await prisma.auditLog.findFirst({ where: { accion: 'ELIMINAR_USUARIO', registroId: target.id } });
      expect((auditLog!.datos as any).antes.nombre).toBe('Por Eliminar');
    });
  });

  describe('GET /api/admin/audit', () => {
    it('incluye el nombre y la cédula de quien realizó cada acción', async () => {
      const admin = await crearUsuarioDePrueba({ rol: 'admin', nombre: 'Admin Auditor' });
      const target = await crearUsuarioDePrueba();

      await request(app)
        .put(`/api/admin/users/${target.id}`)
        .set('Authorization', `Bearer ${tokenPara(admin)}`)
        .send({ ciudad: 'Medellín' });

      const res = await request(app)
        .get('/api/admin/audit')
        .set('Authorization', `Bearer ${tokenPara(admin)}`);

      expect(res.status).toBe(200);
      const log = res.body.logs.find((l: any) => l.accion === 'EDITAR_USUARIO' && l.registroId === target.id);
      expect(log.user.nombre).toBe('Admin Auditor');
      expect(log.user.cedula).toBe(admin.cedula);
    });
  });
});
