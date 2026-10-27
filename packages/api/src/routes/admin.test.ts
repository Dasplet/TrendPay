import request from 'supertest';
import app, { prisma } from '../index';
import { limpiarBaseDeDatos, crearUsuarioDePrueba, crearSubcuentaDePrueba, tokenPara } from '../tests/testUtils';

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

    it('permite al admin resetear el PIN del usuario', async () => {
      const admin = await crearUsuarioDePrueba({ rol: 'admin' });
      const target = await crearUsuarioDePrueba();
      const hashAntes = target.pinHash;

      const res = await request(app)
        .put(`/api/admin/users/${target.id}`)
        .set('Authorization', `Bearer ${tokenPara(admin)}`)
        .send({ nuevo_pin: '9999' });

      expect(res.status).toBe(200);
      const actualizado = await prisma.user.findUnique({ where: { id: target.id } });
      expect(actualizado!.pinHash).not.toBe(hashAntes);
    });

    it('actualiza el nivel de KYC cuando cambia', async () => {
      const admin = await crearUsuarioDePrueba({ rol: 'admin' });
      const target = await crearUsuarioDePrueba();

      const res = await request(app)
        .put(`/api/admin/users/${target.id}`)
        .set('Authorization', `Bearer ${tokenPara(admin)}`)
        .send({ kycNivel: 2 });

      expect(res.status).toBe(200);
      expect(res.body.usuario.kycNivel).toBe(2);
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

  describe('POST /api/admin/users/:id/ajustar-saldo', () => {
    it('un usuario normal no puede ajustar saldos', async () => {
      const user = await crearUsuarioDePrueba();
      const res = await request(app)
        .post(`/api/admin/users/${user.id}/ajustar-saldo`)
        .set('Authorization', `Bearer ${tokenPara(user)}`)
        .send({ monto: 1000, motivo: 'Intento ajeno' });
      expect(res.status).toBe(403);
    });

    it('suma saldo y deja movimiento, notificación y auditoría', async () => {
      const admin = await crearUsuarioDePrueba({ rol: 'admin' });
      const target = await crearUsuarioDePrueba({ saldo: 1000 });

      const res = await request(app)
        .post(`/api/admin/users/${target.id}/ajustar-saldo`)
        .set('Authorization', `Bearer ${tokenPara(admin)}`)
        .send({ monto: 400000, motivo: 'Saldo de prueba' });
      expect(res.status).toBe(200);
      expect(res.body.saldo).toBe(401000);

      const wallet = await prisma.wallet.findUnique({ where: { userId: target.id } });
      expect(Number(wallet!.saldo)).toBe(401000);

      const tx = await prisma.transaction.findFirst({ where: { userId: target.id, categoria: 'ajuste' } });
      expect(Number(tx!.saldoAntes)).toBe(1000);
      expect(Number(tx!.saldoDespues)).toBe(401000);
      expect(tx!.codigo.startsWith('AJU')).toBe(true);

      expect(await prisma.notification.count({ where: { userId: target.id, titulo: 'Ajuste de saldo' } })).toBe(1);
      const log = await prisma.auditLog.findFirst({ where: { accion: 'AJUSTAR_SALDO', userId: admin.id } });
      expect((log!.datos as any).monto).toBe(400000);
    });

    it('descuenta saldo, pero no deja la billetera en negativo', async () => {
      const admin = await crearUsuarioDePrueba({ rol: 'admin' });
      const target = await crearUsuarioDePrueba({ saldo: 5000 });
      const auth = { Authorization: `Bearer ${tokenPara(admin)}` };

      const ok = await request(app).post(`/api/admin/users/${target.id}/ajustar-saldo`).set(auth).send({ monto: -3000, motivo: 'Corrección' });
      expect(ok.status).toBe(200);
      expect(ok.body.saldo).toBe(2000);

      const excede = await request(app).post(`/api/admin/users/${target.id}/ajustar-saldo`).set(auth).send({ monto: -3000, motivo: 'Corrección' });
      expect(excede.status).toBe(400);
      const wallet = await prisma.wallet.findUnique({ where: { userId: target.id } });
      expect(Number(wallet!.saldo)).toBe(2000);
    });

    it('rechaza monto cero, motivo vacío y montos exagerados', async () => {
      const admin = await crearUsuarioDePrueba({ rol: 'admin' });
      const target = await crearUsuarioDePrueba();
      const auth = { Authorization: `Bearer ${tokenPara(admin)}` };
      const url = `/api/admin/users/${target.id}/ajustar-saldo`;

      expect((await request(app).post(url).set(auth).send({ monto: 0, motivo: 'Sin monto' })).status).toBe(400);
      expect((await request(app).post(url).set(auth).send({ monto: 1000, motivo: '' })).status).toBe(400);
      expect((await request(app).post(url).set(auth).send({ monto: 99999999, motivo: 'Demasiado' })).status).toBe(400);
    });

    it('opera sobre la billetera del padre cuando es una subcuenta', async () => {
      const admin = await crearUsuarioDePrueba({ rol: 'admin' });
      const padre = await crearUsuarioDePrueba({ saldo: 0 });
      const sub = await crearSubcuentaDePrueba(padre.id);

      const res = await request(app)
        .post(`/api/admin/users/${sub.id}/ajustar-saldo`)
        .set('Authorization', `Bearer ${tokenPara(admin)}`)
        .send({ monto: 2000, motivo: 'Fondeo subcuenta' });
      expect(res.status).toBe(200);
      const wallet = await prisma.wallet.findUnique({ where: { userId: padre.id } });
      expect(Number(wallet!.saldo)).toBe(2000);
    });

    it('responde 404 si el usuario no existe', async () => {
      const admin = await crearUsuarioDePrueba({ rol: 'admin' });
      const res = await request(app)
        .post('/api/admin/users/no-existe/ajustar-saldo')
        .set('Authorization', `Bearer ${tokenPara(admin)}`)
        .send({ monto: 1000, motivo: 'Usuario fantasma' });
      expect(res.status).toBe(404);
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

  describe('GET /api/admin/metrics', () => {
    it('devuelve los totales convertidos a número', async () => {
      const admin = await crearUsuarioDePrueba({ rol: 'admin' });
      const res = await request(app).get('/api/admin/metrics').set('Authorization', `Bearer ${tokenPara(admin)}`);
      expect(res.status).toBe(200);
      expect(typeof res.body.metricas.total_volumen).toBe('number');
      expect(typeof res.body.metricas.comision_pct).toBe('number');
    });
  });

  describe('GET /api/admin/users', () => {
    it('devuelve el saldo de cada usuario a partir de su billetera', async () => {
      const admin = await crearUsuarioDePrueba({ rol: 'admin' });
      await crearUsuarioDePrueba({ saldo: 42000 });

      const res = await request(app).get('/api/admin/users').set('Authorization', `Bearer ${tokenPara(admin)}`);
      expect(res.status).toBe(200);
      expect(res.body.usuarios.some((u: any) => u.saldo === 42000)).toBe(true);
    });
  });

  describe('GET /api/admin/transactions y /dashboard-chart', () => {
    async function crearTransaccionDePrueba(userId: string) {
      const wallet = await prisma.wallet.findUnique({ where: { userId } });
      return prisma.transaction.create({
        data: {
          walletId: wallet!.id,
          userId,
          codigo: `TX-${Date.now()}`,
          categoria: 'consigna',
          descripcion: 'Transacción de prueba',
          montoBruto: 20000,
          comisionPct: 3,
          comisionValor: 600,
          montoNeto: 19400,
          saldoAntes: 0,
          saldoDespues: 19400,
          status: 'exitosa',
        },
      });
    }

    it('GET /transactions convierte los montos Decimal a número', async () => {
      const admin = await crearUsuarioDePrueba({ rol: 'admin' });
      const user = await crearUsuarioDePrueba();
      await crearTransaccionDePrueba(user.id);

      const res = await request(app).get('/api/admin/transactions').set('Authorization', `Bearer ${tokenPara(admin)}`);
      expect(res.status).toBe(200);
      expect(res.body.transacciones[0].monto_neto).toBe(19400);
      expect(res.body.transacciones[0].comision_valor).toBe(600);
    });

    it('GET /dashboard-chart agrupa el volumen y las comisiones por mes', async () => {
      const admin = await crearUsuarioDePrueba({ rol: 'admin' });
      const user = await crearUsuarioDePrueba();
      await crearTransaccionDePrueba(user.id);

      const res = await request(app).get('/api/admin/dashboard-chart').set('Authorization', `Bearer ${tokenPara(admin)}`);
      expect(res.status).toBe(200);
      const totalVolumen = res.body.datos.reduce((s: number, d: any) => s + d.volumen, 0);
      expect(totalVolumen).toBeGreaterThanOrEqual(20000);
    });
  });

  describe('PUT /api/admin/banks/:id', () => {
    it('actualiza el orden del banco', async () => {
      const admin = await crearUsuarioDePrueba({ rol: 'admin' });
      const crear = await request(app)
        .post('/api/admin/banks')
        .set('Authorization', `Bearer ${tokenPara(admin)}`)
        .send({ nombre: 'Banco De Prueba' });
      expect(crear.status).toBe(201);

      const res = await request(app)
        .put(`/api/admin/banks/${crear.body.banco.id}`)
        .set('Authorization', `Bearer ${tokenPara(admin)}`)
        .send({ orden: 5 });

      expect(res.status).toBe(200);
      expect(res.body.banco.orden).toBe(5);
    });
  });
});
