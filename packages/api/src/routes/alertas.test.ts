import fs from 'node:fs';
import path from 'node:path';
import request from 'supertest';
import app, { prisma } from '../index';
import { limpiarBaseDeDatos, crearUsuarioDePrueba, tokenPara } from '../tests/testUtils';

describe('Alertas de riesgo (Admin) con datos reales', () => {
  afterAll(async () => { await limpiarBaseDeDatos(); await prisma.$disconnect(); });
  beforeEach(async () => { await limpiarBaseDeDatos(); });

  const ver = (u: { id: string; cedula: string; nombre: string; rol: string }) =>
    request(app).get('/api/admin/alertas').set('Authorization', `Bearer ${tokenPara(u)}`);
  const hace = (min: number) => new Date(Date.now() - min * 60_000);
  const retiro = (userId: string, monto: number, status: string, minutos: number) =>
    prisma.withdrawal.create({ data: { userId, bancoNombre: 'B', tipoCuenta: 'a', nombreTitular: 'n', numeroCuenta: 'c', cedulaTitular: 'd', monto, montoNeto: monto, status, createdAt: hace(minutos) } });

  it('sin nada que atender no hay alertas (nunca se muestran ejemplos)', async () => {
    const a = await crearUsuarioDePrueba({ rol: 'admin' });
    await crearUsuarioDePrueba({ saldo: 1000 });
    const res = await ver(a);
    expect(res.status).toBe(200);
    expect(res.body.alertas).toEqual([]);
    expect(res.body.reglas).toEqual({ umbralRetiro: 2000000, intentosPin: 5, bloqueoMinutos: 30 });
  });

  it('solo un administrador las ve', async () => {
    const u = await crearUsuarioDePrueba({ saldo: 0 });
    expect((await ver(u)).status).toBe(403);
  });

  it('genera alertas reales de retiros, bloqueos, pagos, datáfonos y saldos negativos, las graves primero', async () => {
    const a = await crearUsuarioDePrueba({ rol: 'admin' });
    const cliente = await crearUsuarioDePrueba({ saldo: 0, nombre: 'Marta Gómez' });

    await retiro(cliente.id, 3_000_000, 'pendiente', 5);        // monto alto, recién llegado
    await retiro(cliente.id, 50_000, 'pendiente', 30 * 60);     // 30 h: medio
    await retiro(cliente.id, 40_000, 'en_proceso', 50 * 60);    // 50 h: alto
    await retiro(cliente.id, 9_000_000, 'procesado', 70 * 60);  // ya resuelto: no cuenta
    await prisma.user.update({ where: { id: cliente.id }, data: { bloqueado: true, bloqueadoHasta: new Date(Date.now() + 20 * 60_000) } });
    await prisma.kushkiPayment.create({ data: { userId: cliente.id, reference: 'REF-VIEJO', metodo: 'pse', monto: 20000, createdAt: hace(45) } });
    await prisma.kushkiPayment.create({ data: { userId: cliente.id, reference: 'REF-NUEVO', metodo: 'pse', monto: 20000, createdAt: hace(5) } }); // reciente: no cuenta
    const terminal = await prisma.terminalKushki.create({ data: { serial: 'SN-ALERTA-01', alias: 'Caja 1', titularId: cliente.id } });
    await prisma.cobroDatafono.create({ data: { terminalId: terminal.id, userId: cliente.id, clientTransactionId: crypto.randomUUID(), monto: 50000, estado: 'revision', detalle: 'Kushki aprobó 30000 y se pidió 50000' } });
    const otro = await crearUsuarioDePrueba({ saldo: -2500, nombre: 'Pedro Ruiz' });

    const res = await ver(a);
    const titulos = res.body.alertas.map((x: { titulo: string }) => x.titulo);
    expect(titulos.filter((t: string) => t === 'Retiro de monto alto')).toHaveLength(1);
    expect(titulos).toContain('Retiro esperando hace más de un día');
    expect(titulos).toContain('Cuenta bloqueada por intentos fallidos de PIN');
    expect(titulos.filter((t: string) => t === 'Consignación sin confirmar')).toHaveLength(1);
    expect(titulos).toContain('Cobro de datáfono en revisión');
    expect(titulos).toContain('Billetera con saldo negativo');
    expect(res.body.alertas.filter((x: { titulo: string }) => x.titulo === 'Retiro esperando hace más de un día')).toHaveLength(2);

    // las graves van primero
    const niveles = res.body.alertas.map((x: { nivel: string }) => x.nivel);
    expect(niveles).toEqual([...niveles].sort((x: string, y: string) => ['alto', 'medio', 'info'].indexOf(x) - ['alto', 'medio', 'info'].indexOf(y)));
    expect(res.body.alertas[0].nivel).toBe('alto');

    // el detalle nombra a la persona real, no a datos de ejemplo
    const texto = JSON.stringify(res.body.alertas);
    expect(texto).toContain('Marta Gómez');
    expect(texto).toContain(otro.cedula);
    expect(texto).not.toContain('1023456789');
    expect(texto).not.toContain('Samsung');
  });

  it('las cuentas eliminadas no generan alertas', async () => {
    const a = await crearUsuarioDePrueba({ rol: 'admin' });
    const u = await crearUsuarioDePrueba({ saldo: -100 });
    await prisma.user.update({ where: { id: u.id }, data: { eliminadoAt: new Date(), bloqueado: true, bloqueadoHasta: new Date(Date.now() + 60_000) } });
    expect((await ver(a)).body.alertas).toEqual([]);
  });

  it('un reembolso de datáfono sin respuesta por más de media hora y una eliminación vencida también avisan', async () => {
    const a = await crearUsuarioDePrueba({ rol: 'admin' });
    const u = await crearUsuarioDePrueba({ saldo: 5000, nombre: 'Cool Company' });
    const terminal = await prisma.terminalKushki.create({ data: { serial: 'SN-ALERTA-02', alias: 'Caja 2', titularId: u.id } });
    const cobro = await prisma.cobroDatafono.create({ data: { terminalId: terminal.id, userId: u.id, clientTransactionId: crypto.randomUUID(), monto: 10000, estado: 'reembolsando' } });
    await prisma.$executeRaw`UPDATE cobros_datafono SET updated_at = NOW() - INTERVAL '40 minutes' WHERE id = ${cobro.id}`;
    await prisma.user.update({ where: { id: u.id }, data: { eliminacionProgramadaAt: hace(60) } });

    const titulos = (await ver(a)).body.alertas.map((x: { titulo: string }) => x.titulo);
    expect(titulos).toContain('Reembolso de datáfono sin confirmar');
    expect(titulos).toContain('Cuenta con plazo de eliminación vencido');
  });
});

describe('Migración de cuentas eliminadas con el sistema anterior', () => {
  afterAll(async () => { await limpiarBaseDeDatos(); await prisma.$disconnect(); });
  beforeEach(async () => { await limpiarBaseDeDatos(); });

  it('las cuentas que solo se habían renombrado quedan eliminadas, sin datos personales y fuera de los listados', async () => {
    const heredada = await crearUsuarioDePrueba({ saldo: 12345 });
    await prisma.user.update({ where: { id: heredada.id }, data: { cedula: 'DEL-1000195267', correo: '1000195267@eliminado.local', nombre: 'Usuario eliminado', bloqueado: true, celular: '3001112233', ciudad: 'Cali' } });
    await prisma.session.create({ data: { userId: heredada.id, refreshToken: 'rt-heredada', expiresAt: new Date(Date.now() + 86_400_000) } });
    const normal = await crearUsuarioDePrueba({ saldo: 10 });
    const admin = await crearUsuarioDePrueba({ rol: 'admin' });

    const sql = fs.readFileSync(path.resolve(__dirname, '../../../database/prisma/migrations/20261124120000_cuentas_eliminadas_heredadas/migration.sql'), 'utf8');
    const sentencias = sql.split(/;\s*(?:\r?\n|$)/).map((s) => s.replace(/^\s*--.*$/gm, '').trim()).filter(Boolean);
    expect(sentencias).toHaveLength(2);
    for (const s of sentencias) await prisma.$executeRawUnsafe(s);

    const fila = await prisma.user.findUniqueOrThrow({ where: { id: heredada.id } });
    expect(fila.eliminadoAt).toBeInstanceOf(Date);
    expect(fila).toMatchObject({ celular: null, ciudad: null, pinHash: '!eliminado', bloqueado: true });
    expect(await prisma.session.count({ where: { userId: heredada.id } })).toBe(0);
    // las cuentas normales no se tocan
    expect((await prisma.user.findUniqueOrThrow({ where: { id: normal.id } })).eliminadoAt).toBeNull();

    const lista = await request(app).get('/api/admin/users').set('Authorization', `Bearer ${tokenPara(admin)}`);
    expect(lista.body.usuarios.map((u: { id: string }) => u.id)).not.toContain(heredada.id);
    const metricas = await request(app).get('/api/admin/metrics').set('Authorization', `Bearer ${tokenPara(admin)}`);
    expect(metricas.body.metricas.saldo_plataforma).toBe(10); // el saldo de la eliminada ya no suma
  });
});
