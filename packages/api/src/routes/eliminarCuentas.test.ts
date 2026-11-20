import request from 'supertest';
import app, { prisma } from '../index';
import { limpiarBaseDeDatos, crearUsuarioDePrueba, crearSubcuentaDePrueba, tokenPara } from '../tests/testUtils';
import { eliminarCuentasVencidas, PLAZO_ELIMINACION_DIAS } from '../utils/eliminarCuentas';

const DIA = 24 * 3_600_000;

describe('Eliminación de cuentas', () => {
  afterAll(async () => { await limpiarBaseDeDatos(); await prisma.$disconnect(); });
  beforeEach(async () => { await limpiarBaseDeDatos(); });

  const eliminar = (admin: { id: string; cedula: string; nombre: string; rol: string }, id: string) =>
    request(app).delete(`/api/admin/users/${id}`).set('Authorization', `Bearer ${tokenPara(admin)}`);
  const admin = () => crearUsuarioDePrueba({ rol: 'admin' });

  // Una persona con historial completo: movimientos, retiro, cuenta bancaria, sesión, notificación y auditoría propia
  async function personaConHistorial(saldo: number) {
    const u = await crearUsuarioDePrueba({ saldo, nombre: 'Marta Gómez' });
    await prisma.user.update({ where: { id: u.id }, data: { celular: '3001234567', ciudad: 'Medellín' } });
    await prisma.transaction.create({ data: { walletId: u.wallet!.id, userId: u.id, codigo: `TX-${u.id.slice(0, 8)}`, categoria: 'consigna', descripcion: 'Consignación PSE', montoBruto: 50000, montoNeto: 50000, saldoAntes: 0, saldoDespues: 50000, metadata: { pagador: 'Marta Gómez' } } });
    await prisma.withdrawal.create({ data: { userId: u.id, bancoNombre: 'Bancolombia', tipoCuenta: 'ahorros', nombreTitular: 'Marta Gómez', numeroCuenta: 'cifrado-1', cedulaTitular: 'cifrado-2', monto: 20000, montoNeto: 19000, status: 'procesado', payoutTicket: 'tk-9' } });
    await prisma.bankAccount.create({ data: { userId: u.id, bancoNombre: 'Bancolombia', tipoCuenta: 'ahorros', numeroCuenta: 'cifrado-3', cedulaTitular: 'cifrado-4', nombreTitular: 'Marta Gómez' } });
    await prisma.session.create({ data: { userId: u.id, refreshToken: `rt-${u.id}`, expiresAt: new Date(Date.now() + DIA) } });
    await prisma.notification.create({ data: { userId: u.id, titulo: 'Hola', mensaje: 'Marta' } });
    await prisma.userAuditLog.create({ data: { userId: u.id, accion: 'EDITAR', campo: 'correo', valorAntes: 'a@x.co', valorDespues: 'b@x.co' } });
    return u;
  }

  describe('eliminación inmediata (sin saldo ni operaciones en curso)', () => {
    it('una sede sin movimientos desaparece por completo y no queda rastro de ella', async () => {
      const a = await admin();
      const empresa = await crearUsuarioDePrueba({ saldo: 80000 });
      const sede = await crearSubcuentaDePrueba(empresa.id, {});

      const res = await eliminar(a, sede.id);
      expect(res.status).toBe(200);
      expect(res.body.estado).toBe('eliminada');

      expect(await prisma.user.findUnique({ where: { id: sede.id } })).toBeNull();
      expect(await prisma.auditLog.count({ where: { registroId: sede.id } })).toBe(0);
      // el saldo de la empresa no se toca
      expect(Number((await prisma.wallet.findUnique({ where: { userId: empresa.id } }))!.saldo)).toBe(80000);
      // la única constancia: quién eliminó, sin datos de la cuenta eliminada
      const constancia = await prisma.auditLog.findFirstOrThrow({ where: { accion: 'ELIMINAR_CUENTA' } });
      expect(constancia.userId).toBe(a.id);
      expect(JSON.stringify(constancia)).not.toContain(sede.cedula);
      expect(JSON.stringify(constancia)).not.toContain(sede.id);
    });

    it('una cuenta con historial y saldo en cero queda sin ningún dato personal y fuera de todos los listados', async () => {
      const a = await admin();
      const u = await personaConHistorial(0);
      const cedula = u.cedula;

      expect((await eliminar(a, u.id)).body.estado).toBe('eliminada');

      const fila = await prisma.user.findUniqueOrThrow({ where: { id: u.id } });
      expect(fila).toMatchObject({ nombre: 'Cuenta eliminada', celular: null, ciudad: null, bloqueado: true, pinHash: '!eliminado', cuentaPadreId: null });
      expect(fila.eliminadoAt).toBeInstanceOf(Date);
      expect(fila.cedula).not.toContain(cedula.replace('T', ''));
      expect(fila.correo).toBe(`${u.id}@eliminado.local`);

      // datos personales y lo que cuelga solo de la persona: borrado
      expect(await prisma.bankAccount.count({ where: { userId: u.id } })).toBe(0);
      expect(await prisma.session.count({ where: { userId: u.id } })).toBe(0);
      expect(await prisma.notification.count({ where: { userId: u.id } })).toBe(0);
      expect(await prisma.userAuditLog.count({ where: { userId: u.id } })).toBe(0);
      expect(await prisma.auditLog.count({ where: { tabla: 'users', registroId: u.id } })).toBe(0);

      // el historial financiero se conserva pero sin identidad
      const tx = await prisma.transaction.findFirstOrThrow({ where: { userId: u.id } });
      expect(tx.metadata).toBeNull();
      expect(Number(tx.montoBruto)).toBe(50000);
      const w = await prisma.withdrawal.findFirstOrThrow({ where: { userId: u.id } });
      expect(w).toMatchObject({ nombreTitular: '[eliminado]', bancoNombre: '[eliminado]', payoutTicket: 'tk-9' });
      expect(Number(w.monto)).toBe(20000);

      // ya no existe para el sistema
      const lista = await request(app).get('/api/admin/users').set('Authorization', `Bearer ${tokenPara(a)}`);
      expect(lista.body.usuarios.map((x: { id: string }) => x.id)).not.toContain(u.id);
      const comercios = await request(app).get('/api/admin/kushki/comercios').set('Authorization', `Bearer ${tokenPara(a)}`);
      expect(comercios.body.cuentas.map((x: { userId: string }) => x.userId)).not.toContain(u.id);
      const metricas = await request(app).get('/api/admin/metrics').set('Authorization', `Bearer ${tokenPara(a)}`);
      expect(metricas.body.metricas.total_usuarios).toBe(1); // solo el admin

      // y no puede volver a entrar
      expect((await request(app).post('/api/auth/login').send({ cedula, pin: '1234' })).status).toBeGreaterThanOrEqual(400);
      expect(await prisma.user.count({ where: { cedula } })).toBe(0);
    });
  });

  describe('cuenta con saldo: plazo de 7 días para retirar', () => {
    it('queda programada a 7 días, sigue existiendo y solo puede ver su saldo y retirar', async () => {
      const a = await admin();
      const u = await crearUsuarioDePrueba({ saldo: 120000 });

      const antes = Date.now();
      const res = await eliminar(a, u.id);
      expect(res.status).toBe(200);
      expect(res.body.estado).toBe('programada');
      expect(res.body.motivos[0]).toContain('saldo');
      const fecha = new Date(res.body.fecha).getTime();
      expect(fecha).toBeGreaterThanOrEqual(antes + PLAZO_ELIMINACION_DIAS * DIA - 5000);
      expect(fecha).toBeLessThanOrEqual(Date.now() + PLAZO_ELIMINACION_DIAS * DIA + 5000);

      const fila = await prisma.user.findUniqueOrThrow({ where: { id: u.id } });
      expect(fila.eliminadoAt).toBeNull();
      expect(fila.nombre).toBe(u.nombre); // todavía no se borra nada
      expect(Number((await prisma.wallet.findUnique({ where: { userId: u.id } }))!.saldo)).toBe(120000);

      const token = tokenPara(u);
      // puede ver el saldo
      expect((await request(app).get('/api/wallet/balance').set('Authorization', `Bearer ${token}`)).status).toBe(200);
      // no puede recargar/cobrar (el mensaje explica el plazo) ni enviar
      const bloqueada = await request(app).get('/api/datafonos/cobros').set('Authorization', `Bearer ${token}`);
      expect(bloqueada.status).toBe(403);
      expect(bloqueada.body.code).toBe('CUENTA_EN_ELIMINACION');
      expect(bloqueada.body.mensaje).toContain('retirar');
      // retirar sí pasa el permiso (puede fallar por otros datos, pero no por 403)
      const retiro = await request(app).post('/api/withdrawals').set('Authorization', `Bearer ${token}`).send({});
      expect(retiro.status).not.toBe(403);

      // el aviso al cliente y el estado en /me
      expect(await prisma.notification.count({ where: { userId: u.id, titulo: 'Tu cuenta será eliminada' } })).toBe(1);
      const me = await request(app).get('/api/auth/me').set('Authorization', `Bearer ${token}`);
      expect(me.body.usuario.eliminacionProgramadaAt).toBeTruthy();
      expect(me.body.usuario.permisos).toEqual({ verSaldo: true, recargar: false, enviar: false, retirar: true });
    });

    it('pedirlo otra vez no reinicia el plazo', async () => {
      const a = await admin();
      const u = await crearUsuarioDePrueba({ saldo: 5000 });
      const primera = (await eliminar(a, u.id)).body.fecha;
      const segunda = (await eliminar(a, u.id)).body.fecha;
      expect(segunda).toBe(primera);
      expect(await prisma.notification.count({ where: { userId: u.id, titulo: 'Tu cuenta será eliminada' } })).toBe(1);
    });

    it('un retiro en curso también retrasa la eliminación aunque el saldo sea cero', async () => {
      const a = await admin();
      const u = await crearUsuarioDePrueba({ saldo: 0 });
      await prisma.withdrawal.create({ data: { userId: u.id, bancoNombre: 'B', tipoCuenta: 'ahorros', nombreTitular: 'X', numeroCuenta: 'c1', cedulaTitular: 'c2', monto: 10000, montoNeto: 9000, status: 'en_proceso' } });
      const res = await eliminar(a, u.id);
      expect(res.body.estado).toBe('programada');
      expect(res.body.motivos.join()).toContain('retiro');
    });

    it('vencido el plazo: con saldo NO se elimina y se avisa al administrador; con saldo en cero se elimina sola', async () => {
      const a = await admin();
      const u = await personaConHistorial(40000);
      await eliminar(a, u.id);
      await prisma.user.update({ where: { id: u.id }, data: { eliminacionProgramadaAt: new Date(Date.now() - 1000) } });

      expect(await eliminarCuentasVencidas()).toEqual({ eliminadas: 0, esperando: 1 });
      expect((await prisma.user.findUniqueOrThrow({ where: { id: u.id } })).eliminadoAt).toBeNull();
      expect(Number((await prisma.wallet.findUnique({ where: { userId: u.id } }))!.saldo)).toBe(40000);
      expect(await prisma.notification.count({ where: { userId: a.id, titulo: 'Eliminación pendiente de una cuenta' } })).toBe(1);
      // un segundo repaso el mismo día no vuelve a avisar
      await eliminarCuentasVencidas();
      expect(await prisma.notification.count({ where: { userId: a.id, titulo: 'Eliminación pendiente de una cuenta' } })).toBe(1);

      // el cliente retira todo
      await prisma.wallet.update({ where: { userId: u.id }, data: { saldo: 0 } });
      expect(await eliminarCuentasVencidas()).toEqual({ eliminadas: 1, esperando: 0 });
      const fila = await prisma.user.findUniqueOrThrow({ where: { id: u.id } });
      expect(fila).toMatchObject({ nombre: 'Cuenta eliminada', celular: null });
      expect(fila.eliminadoAt).toBeInstanceOf(Date);
      expect(fila.eliminacionProgramadaAt).toBeNull();
      // sin administrador que la ejecute no se deja ni constancia de quién la eliminó
      expect(await prisma.auditLog.count({ where: { accion: 'ELIMINAR_CUENTA' } })).toBe(0);
    });

    it('antes de vencer el plazo no se elimina nada', async () => {
      const a = await admin();
      const u = await crearUsuarioDePrueba({ saldo: 0 });
      await prisma.withdrawal.create({ data: { userId: u.id, bancoNombre: 'B', tipoCuenta: 'ahorros', nombreTitular: 'X', numeroCuenta: 'c1', cedulaTitular: 'c2', monto: 10000, montoNeto: 9000, status: 'pendiente' } });
      await eliminar(a, u.id);
      expect(await eliminarCuentasVencidas()).toEqual({ eliminadas: 0, esperando: 0 });
      expect((await prisma.user.findUniqueOrThrow({ where: { id: u.id } })).nombre).toBe(u.nombre);
    });

    it('el administrador puede cancelar la eliminación y la cuenta recupera sus permisos', async () => {
      const a = await admin();
      const u = await crearUsuarioDePrueba({ saldo: 30000 });
      await eliminar(a, u.id);

      const cancelar = await request(app).post(`/api/admin/users/${u.id}/cancelar-eliminacion`).set('Authorization', `Bearer ${tokenPara(a)}`);
      expect(cancelar.status).toBe(200);
      expect((await prisma.user.findUniqueOrThrow({ where: { id: u.id } })).eliminacionProgramadaAt).toBeNull();
      const me = await request(app).get('/api/auth/me').set('Authorization', `Bearer ${tokenPara(u)}`);
      expect(me.body.usuario.permisos).toEqual({ verSaldo: true, recargar: true, enviar: true, retirar: true });
      // cancelar algo que no está programado es un error claro
      expect((await request(app).post(`/api/admin/users/${u.id}/cancelar-eliminacion`).set('Authorization', `Bearer ${tokenPara(a)}`)).status).toBe(400);
    });
  });

  describe('restricciones', () => {
    it('no se puede eliminar a un administrador, a uno mismo ni una cuenta que no existe', async () => {
      const a = await admin();
      const otroAdmin = await admin();
      expect((await eliminar(a, otroAdmin.id)).status).toBe(400);
      expect((await eliminar(a, a.id)).status).toBe(400);
      expect((await eliminar(a, '00000000-0000-4000-8000-000000000000')).status).toBe(404);
      expect(await prisma.user.count({ where: { id: { in: [a.id, otroAdmin.id] } } })).toBe(2);
    });

    it('una empresa con sedes no se elimina hasta eliminar sus sedes', async () => {
      const a = await admin();
      const empresa = await crearUsuarioDePrueba({ saldo: 0 });
      const sede = await crearSubcuentaDePrueba(empresa.id, {});
      const res = await eliminar(a, empresa.id);
      expect(res.status).toBe(409);
      expect(res.body.mensaje).toContain('sede');

      expect((await eliminar(a, sede.id)).body.estado).toBe('eliminada');
      expect((await eliminar(a, empresa.id)).body.estado).toBe('eliminada');
    });

    it('un usuario normal no puede eliminar cuentas', async () => {
      const u = await crearUsuarioDePrueba({ saldo: 0 });
      const otro = await crearUsuarioDePrueba({ saldo: 0 });
      expect((await eliminar(u, otro.id)).status).toBe(403);
    });

    it('al eliminar una sede, los datáfonos que tenía asignados quedan libres para toda la empresa', async () => {
      const a = await admin();
      const empresa = await crearUsuarioDePrueba({ saldo: 0 });
      const sede = await crearSubcuentaDePrueba(empresa.id, {});
      const t = await prisma.terminalKushki.create({ data: { serial: 'SN-ELIM-0001', alias: 'Caja 1', titularId: empresa.id, sedeId: sede.id } });
      await eliminar(a, sede.id);
      expect((await prisma.terminalKushki.findUniqueOrThrow({ where: { id: t.id } })).sedeId).toBeNull();
    });
  });
});
