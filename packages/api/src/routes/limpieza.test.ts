import request from 'supertest';
import app, { prisma } from '../index';
import { limpiarBaseDeDatos, crearUsuarioDePrueba, tokenPara } from '../tests/testUtils';

describe('Limpieza de datos de prueba (Admin)', () => {
  afterAll(async () => { delete process.env.PERMITIR_LIMPIEZA; await limpiarBaseDeDatos(); await prisma.$disconnect(); });
  beforeEach(async () => { delete process.env.PERMITIR_LIMPIEZA; await limpiarBaseDeDatos(); });

  const limpiar = (u: { id: string; cedula: string; nombre: string; rol: string }, frase?: string) =>
    request(app).post('/api/admin/limpieza').set('Authorization', `Bearer ${tokenPara(u)}`).send({ frase });
  const ver = (u: { id: string; cedula: string; nombre: string; rol: string }) =>
    request(app).get('/api/admin/limpieza').set('Authorization', `Bearer ${tokenPara(u)}`);

  // Una cuenta con historial, saldo y de todo un poco
  async function conDatos(saldo = 50000) {
    const u = await crearUsuarioDePrueba({ saldo, nombre: 'Cliente de prueba' });
    await prisma.transaction.create({ data: { walletId: u.wallet!.id, userId: u.id, codigo: `TX-${u.id.slice(0, 8)}`, categoria: 'consigna', descripcion: 'x', montoBruto: saldo, montoNeto: saldo, saldoAntes: 0, saldoDespues: saldo } });
    await prisma.withdrawal.create({ data: { userId: u.id, bancoNombre: 'B', tipoCuenta: 'a', nombreTitular: 'n', numeroCuenta: 'c', cedulaTitular: 'd', monto: 1000, montoNeto: 900 } });
    await prisma.kushkiPayment.create({ data: { userId: u.id, reference: `REF-${u.id}`, metodo: 'pse', monto: 1000 } });
    await prisma.notification.create({ data: { userId: u.id, titulo: 't', mensaje: 'm' } });
    await prisma.qrCode.create({ data: { walletId: u.wallet!.id, token: `QR-T-${u.id}`, expiresAt: new Date(), permanente: false } });
    await prisma.qrCode.create({ data: { walletId: u.wallet!.id, token: `QR-P-${u.id}`, expiresAt: new Date(), permanente: true } });
    await prisma.bank.upsert({ where: { id: 'limp-banco' }, update: {}, create: { id: 'limp-banco', nombre: 'Banco de prueba' } });
    return u;
  }

  it('por defecto está desactivada: no borra nada aunque se escriba la frase', async () => {
    const a = await crearUsuarioDePrueba({ rol: 'admin' });
    const u = await conDatos();
    const res = await limpiar(a, 'BORRAR TODO');
    expect(res.status).toBe(403);
    expect(await prisma.transaction.count()).toBe(1);
    expect(Number((await prisma.wallet.findUnique({ where: { userId: u.id } }))!.saldo)).toBe(50000);
    expect((await ver(a)).body.habilitada).toBe(false);
  });

  it('el administrador ve qué se borraría sin tocar nada', async () => {
    const a = await crearUsuarioDePrueba({ rol: 'admin' });
    await conDatos(50000);
    const res = await ver(a);
    expect(res.status).toBe(200);
    expect(res.body.saldoTotal).toBe(50000);
    expect(res.body.walletsConSaldo).toBe(1);
    expect(res.body.filas.find((f: { nombre: string }) => f.nombre === 'Movimientos').cantidad).toBe(1);
    expect(await prisma.transaction.count()).toBe(1);
  });

  it('activada, exige la frase exacta y solo la ejecuta un administrador', async () => {
    process.env.PERMITIR_LIMPIEZA = '1';
    const a = await crearUsuarioDePrueba({ rol: 'admin' });
    const u = await conDatos();
    expect((await limpiar(a)).status).toBe(400);
    expect((await limpiar(a, 'borrar todo')).status).toBe(400);
    expect((await limpiar(u, 'BORRAR TODO')).status).toBe(403);
    expect(await prisma.transaction.count()).toBe(1);
  });

  it('con la frase borra el historial y deja las billeteras en $0, conservando cuentas, bancos y QR permanentes', async () => {
    process.env.PERMITIR_LIMPIEZA = '1';
    const a = await crearUsuarioDePrueba({ rol: 'admin' });
    const u = await conDatos();

    const res = await limpiar(a, 'BORRAR TODO');
    expect(res.status).toBe(200);
    expect(res.body.antes.saldoTotal).toBe(50000);
    expect(res.body.despues.saldoTotal).toBe(0);

    expect(await prisma.transaction.count()).toBe(0);
    expect(await prisma.withdrawal.count()).toBe(0);
    expect(await prisma.kushkiPayment.count()).toBe(0);
    expect(await prisma.notification.count()).toBe(0);
    expect(Number((await prisma.wallet.findUnique({ where: { userId: u.id } }))!.saldo)).toBe(0);
    // se conserva
    expect(await prisma.user.count({ where: { id: { in: [a.id, u.id] } } })).toBe(2);
    expect((await prisma.qrCode.findMany()).map((q) => q.permanente)).toEqual([true]);
    expect(await prisma.bank.count({ where: { id: 'limp-banco' } })).toBe(1);
    // la auditoría queda vacía (la constancia de quién la ejecutó queda en el registro del servidor)
    expect(await prisma.auditLog.count()).toBe(0);
    await prisma.bank.deleteMany({ where: { id: 'limp-banco' } });
  });

  describe('vinculaciones (opcionales)', () => {
    async function conVinculacion(admin: { id: string }) {
      const v = await prisma.vinculacion.create({ data: { tokenHash: `h-${Math.random()}`, razonSocial: 'Cliente de prueba SAS', contactoNombre: 'Ana', contactoCorreo: 'a@x.test', expiraAt: new Date(Date.now() + 86_400_000), creadaPor: admin.id } });
      await prisma.vinculacionDocumento.create({ data: { vinculacionId: v.id, tipo: 'rut', storageKey: 'bd:doc-1', nombreOriginal: 'rut.pdf', mime: 'application/pdf', tamano: 3, sha256: 'x' } });
      await prisma.vinculacionArchivo.create({ data: { key: 'bd:doc-1', contenido: Buffer.from('abc') } });
    }

    it('por defecto NO se tocan: pueden ser reales aunque el resto sea de prueba', async () => {
      process.env.PERMITIR_LIMPIEZA = '1';
      const a = await crearUsuarioDePrueba({ rol: 'admin' });
      await conVinculacion(a);
      expect((await ver(a)).body.vinculaciones).toBe(1);
      expect((await limpiar(a, 'BORRAR TODO')).status).toBe(200);
      expect(await prisma.vinculacion.count()).toBe(1);
      expect(await prisma.vinculacionDocumento.count()).toBe(1);
      expect(await prisma.vinculacionArchivo.count()).toBe(1);
    });

    it('si se pide, se borran las vinculaciones con sus documentos y archivos', async () => {
      process.env.PERMITIR_LIMPIEZA = '1';
      const a = await crearUsuarioDePrueba({ rol: 'admin' });
      await conVinculacion(a);
      const res = await request(app).post('/api/admin/limpieza').set('Authorization', `Bearer ${tokenPara(a)}`).send({ frase: 'BORRAR TODO', incluirVinculaciones: true });
      expect(res.status).toBe(200);
      expect(res.body.despues.vinculaciones).toBe(0);
      expect(await prisma.vinculacion.count()).toBe(0);
      expect(await prisma.vinculacionDocumento.count()).toBe(0);
      expect(await prisma.vinculacionArchivo.count()).toBe(0);
    });
  });
});
