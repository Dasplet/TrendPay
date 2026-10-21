import request from 'supertest';
import app, { prisma } from '../index';
import { limpiarBaseDeDatos, crearUsuarioDePrueba, tokenPara } from '../tests/testUtils';
import { dispersionHabilitada, iniciarDispersion, getPayoutStatus, KushkiError } from '../utils/kushki';
import { conciliarRetirosEnProceso } from '../utils/retiros';

jest.mock('../utils/kushki', () => ({
  ...jest.requireActual('../utils/kushki'),
  dispersionHabilitada: jest.fn(() => false),
  iniciarDispersion: jest.fn(),
  getPayoutStatus: jest.fn(),
}));

const mockHabilitada = dispersionHabilitada as jest.Mock;
const mockIniciar = iniciarDispersion as jest.Mock;
const mockEstado = getPayoutStatus as jest.Mock;

const datosRetiro = {
  bancoNombre: 'Bancolombia',
  tipoCuenta: 'ahorros',
  numeroCuenta: '04512345678',
  cedulaTitular: '1023456789',
  nombreTitular: 'Usuario de Prueba',
};

describe('Withdrawals API', () => {
  afterAll(async () => {
    await limpiarBaseDeDatos();
    await prisma.$disconnect();
  });

  beforeEach(async () => {
    await limpiarBaseDeDatos();
  });

  describe('POST /api/withdrawals', () => {
    it('crea la solicitud, debita el saldo de inmediato y queda pendiente', async () => {
      const user = await crearUsuarioDePrueba({ saldo: 100000 });

      const res = await request(app)
        .post('/api/withdrawals')
        .set('Authorization', `Bearer ${tokenPara(user)}`)
        .send({ ...datosRetiro, monto: 50000 });

      expect(res.status).toBe(201);
      expect(res.body.saldo).toBe(50000);

      const wallet = await prisma.wallet.findUnique({ where: { userId: user.id } });
      expect(Number(wallet!.saldo)).toBe(50000);

      const withdrawal = await prisma.withdrawal.findFirst({ where: { userId: user.id } });
      expect(withdrawal?.status).toBe('pendiente');
      expect(withdrawal?.numeroCuenta).not.toBe(datosRetiro.numeroCuenta); // debe quedar cifrado, no en texto plano
    });

    it('rechaza montos por debajo del mínimo (fallback $10.000 si no hay Config)', async () => {
      const user = await crearUsuarioDePrueba({ saldo: 100000 });
      const res = await request(app)
        .post('/api/withdrawals')
        .set('Authorization', `Bearer ${tokenPara(user)}`)
        .send({ ...datosRetiro, monto: 5000 });
      expect(res.status).toBe(400);

      const wallet = await prisma.wallet.findUnique({ where: { userId: user.id } });
      expect(Number(wallet!.saldo)).toBe(100000); // sin cambios
    });

    it('rechaza si el saldo es insuficiente', async () => {
      const user = await crearUsuarioDePrueba({ saldo: 10000 });
      const res = await request(app)
        .post('/api/withdrawals')
        .set('Authorization', `Bearer ${tokenPara(user)}`)
        .send({ ...datosRetiro, monto: 50000 });
      expect(res.status).toBe(400);
    });
  });

  describe('GET /api/withdrawals/me', () => {
    it('devuelve los propios retiros con el número de cuenta enmascarado', async () => {
      const user = await crearUsuarioDePrueba({ saldo: 100000 });
      await request(app).post('/api/withdrawals').set('Authorization', `Bearer ${tokenPara(user)}`).send({ ...datosRetiro, monto: 20000 });

      const res = await request(app).get('/api/withdrawals/me').set('Authorization', `Bearer ${tokenPara(user)}`);
      expect(res.status).toBe(200);
      expect(res.body.retiros).toHaveLength(1);
      expect(res.body.retiros[0].numero_cuenta_masked).toBe('*******5678');
      expect(res.body.retiros[0].numero_cuenta).toBeUndefined();
    });
  });

  describe('Cola de administración', () => {
    it('un usuario normal no puede ver ni aprobar retiros pendientes', async () => {
      const user = await crearUsuarioDePrueba({ saldo: 100000 });
      const pend = await request(app).get('/api/withdrawals/pending').set('Authorization', `Bearer ${tokenPara(user)}`);
      expect(pend.status).toBe(403);
    });

    it('el admin aprueba un retiro y este pasa a procesado', async () => {
      const user = await crearUsuarioDePrueba({ saldo: 100000 });
      const admin = await crearUsuarioDePrueba({ saldo: 0, rol: 'admin' });

      const crear = await request(app).post('/api/withdrawals').set('Authorization', `Bearer ${tokenPara(user)}`).send({ ...datosRetiro, monto: 30000 });
      const withdrawalId = (await prisma.withdrawal.findFirst({ where: { userId: user.id } }))!.id;
      expect(crear.status).toBe(201);

      const pend = await request(app).get('/api/withdrawals/pending').set('Authorization', `Bearer ${tokenPara(admin)}`);
      expect(pend.body.retiros).toHaveLength(1);
      expect(pend.body.retiros[0].numero_cuenta).toBe(datosRetiro.numeroCuenta); // admin ve el número completo para poder transferir

      const aprobar = await request(app).put(`/api/withdrawals/${withdrawalId}/approve`).set('Authorization', `Bearer ${tokenPara(admin)}`);
      expect(aprobar.status).toBe(200);

      const withdrawal = await prisma.withdrawal.findUnique({ where: { id: withdrawalId } });
      expect(withdrawal?.status).toBe('procesado');

      // el saldo del usuario no cambia al aprobar (ya se había debitado al crear la solicitud)
      const wallet = await prisma.wallet.findUnique({ where: { userId: user.id } });
      expect(Number(wallet!.saldo)).toBe(70000);
    });

    it('el admin rechaza un retiro y el saldo se revierte por completo', async () => {
      const user = await crearUsuarioDePrueba({ saldo: 100000 });
      const admin = await crearUsuarioDePrueba({ saldo: 0, rol: 'admin' });

      await request(app).post('/api/withdrawals').set('Authorization', `Bearer ${tokenPara(user)}`).send({ ...datosRetiro, monto: 30000 });
      const withdrawalId = (await prisma.withdrawal.findFirst({ where: { userId: user.id } }))!.id;

      const rechazar = await request(app)
        .put(`/api/withdrawals/${withdrawalId}/reject`)
        .set('Authorization', `Bearer ${tokenPara(admin)}`)
        .send({ motivo: 'Datos bancarios incorrectos' });
      expect(rechazar.status).toBe(200);

      const withdrawal = await prisma.withdrawal.findUnique({ where: { id: withdrawalId } });
      expect(withdrawal?.status).toBe('rechazado');
      expect(withdrawal?.notasAdmin).toBe('Datos bancarios incorrectos');

      const wallet = await prisma.wallet.findUnique({ where: { userId: user.id } });
      expect(Number(wallet!.saldo)).toBe(100000); // saldo íntegramente devuelto
    });

    it('GET /api/withdrawals devuelve el historial completo con el número de cuenta enmascarado', async () => {
      const user = await crearUsuarioDePrueba({ saldo: 100000 });
      const admin = await crearUsuarioDePrueba({ saldo: 0, rol: 'admin' });
      await request(app).post('/api/withdrawals').set('Authorization', `Bearer ${tokenPara(user)}`).send({ ...datosRetiro, monto: 20000 });

      const res = await request(app).get('/api/withdrawals').set('Authorization', `Bearer ${tokenPara(admin)}`);
      expect(res.status).toBe(200);
      expect(res.body.retiros).toHaveLength(1);
      expect(res.body.retiros[0].numero_cuenta).toBeUndefined();
      expect(res.body.retiros[0].numero_cuenta_masked).toBe('*******5678');
    });

    it('no permite aprobar dos veces el mismo retiro', async () => {
      const user = await crearUsuarioDePrueba({ saldo: 100000 });
      const admin = await crearUsuarioDePrueba({ saldo: 0, rol: 'admin' });

      await request(app).post('/api/withdrawals').set('Authorization', `Bearer ${tokenPara(user)}`).send({ ...datosRetiro, monto: 30000 });
      const withdrawalId = (await prisma.withdrawal.findFirst({ where: { userId: user.id } }))!.id;

      await request(app).put(`/api/withdrawals/${withdrawalId}/approve`).set('Authorization', `Bearer ${tokenPara(admin)}`);
      const segundaVez = await request(app).put(`/api/withdrawals/${withdrawalId}/approve`).set('Authorization', `Bearer ${tokenPara(admin)}`);
      expect(segundaVez.status).toBe(400);
    });
  });

  describe('Dispersión con Kushki (KUSHKI_PAYOUTS_ENABLED)', () => {
    async function retiroPendiente(monto = 30000) {
      const user = await crearUsuarioDePrueba({ saldo: 100000 });
      const admin = await crearUsuarioDePrueba({ saldo: 0, rol: 'admin' });
      await request(app).post('/api/withdrawals').set('Authorization', `Bearer ${tokenPara(user)}`).send({ ...datosRetiro, monto });
      const withdrawal = (await prisma.withdrawal.findFirst({ where: { userId: user.id } }))!;
      return { user, admin, withdrawal };
    }
    const aprobar = (id: string, admin: any) => request(app).put(`/api/withdrawals/${id}/approve`).set('Authorization', `Bearer ${tokenPara(admin)}`);
    const saldoDe = async (userId: string) => Number((await prisma.wallet.findUnique({ where: { userId } }))!.saldo);

    beforeEach(() => {
      mockHabilitada.mockReturnValue(true);
      mockIniciar.mockReset().mockResolvedValue({ ticketNumber: 'T-1', transactionReference: 'R-1' });
      mockEstado.mockReset().mockResolvedValue('pendiente');
    });
    afterAll(() => mockHabilitada.mockReturnValue(false));

    it('envía la dispersión con los datos descifrados y deja el retiro en proceso', async () => {
      const { admin, withdrawal } = await retiroPendiente();
      const res = await aprobar(withdrawal.id, admin);

      expect(res.status).toBe(200);
      expect(res.body.estado).toBe('en_proceso');
      expect(mockIniciar).toHaveBeenCalledWith({ bancoNombre: 'Bancolombia', tipoCuenta: 'ahorros', numeroCuenta: datosRetiro.numeroCuenta, cedulaTitular: datosRetiro.cedulaTitular, monto: 30000 });

      const w = await prisma.withdrawal.findUnique({ where: { id: withdrawal.id } });
      expect(w?.status).toBe('en_proceso');
      expect(w?.payoutTicket).toBe('T-1');
    });

    it('si el banco ya aprobó, queda procesado y no se mueve el saldo', async () => {
      mockEstado.mockResolvedValue('aprobada');
      const { user, admin, withdrawal } = await retiroPendiente();
      const res = await aprobar(withdrawal.id, admin);

      expect(res.body.estado).toBe('procesado');
      expect((await prisma.withdrawal.findUnique({ where: { id: withdrawal.id } }))?.status).toBe('procesado');
      expect(await saldoDe(user.id)).toBe(70000);
    });

    it('si el banco rechaza, devuelve el saldo completo', async () => {
      mockEstado.mockResolvedValue('rechazada');
      const { user, admin, withdrawal } = await retiroPendiente();
      const res = await aprobar(withdrawal.id, admin);

      expect(res.body.estado).toBe('rechazado');
      expect((await prisma.withdrawal.findUnique({ where: { id: withdrawal.id } }))?.status).toBe('rechazado');
      expect(await saldoDe(user.id)).toBe(100000);
    });

    it('si Kushki rechaza la petición, el retiro vuelve a pendiente y no se toca el saldo', async () => {
      mockIniciar.mockRejectedValue(new KushkiError('Banco no soportado', 422));
      const { user, admin, withdrawal } = await retiroPendiente();
      const res = await aprobar(withdrawal.id, admin);

      expect(res.status).toBe(422);
      const w = await prisma.withdrawal.findUnique({ where: { id: withdrawal.id } });
      expect(w?.status).toBe('pendiente');
      expect(w?.aprobadoPor).toBeNull();
      expect(await saldoDe(user.id)).toBe(70000);
    });

    it('si no hay respuesta de Kushki lo deja en proceso sin ticket y el admin lo resuelve a mano', async () => {
      mockIniciar.mockRejectedValue(new KushkiError('timeout', 502));
      const { user, admin, withdrawal } = await retiroPendiente();
      const res = await aprobar(withdrawal.id, admin);

      expect(res.status).toBe(502);
      const w = await prisma.withdrawal.findUnique({ where: { id: withdrawal.id } });
      expect(w?.status).toBe('en_proceso');
      expect(w?.payoutTicket).toBeNull();

      mockIniciar.mockClear();
      const rechazar = await request(app).put(`/api/withdrawals/${withdrawal.id}/reject`).set('Authorization', `Bearer ${tokenPara(admin)}`).send({ motivo: 'No llegó' });
      expect(rechazar.status).toBe(200);
      expect(mockIniciar).not.toHaveBeenCalled();
      expect(await saldoDe(user.id)).toBe(100000);
    });

    it('un retiro ya enviado a Kushki no se puede aprobar ni rechazar otra vez', async () => {
      const { admin, withdrawal } = await retiroPendiente();
      await aprobar(withdrawal.id, admin);

      expect((await aprobar(withdrawal.id, admin)).status).toBe(400);
      const rechazar = await request(app).put(`/api/withdrawals/${withdrawal.id}/reject`).set('Authorization', `Bearer ${tokenPara(admin)}`);
      expect(rechazar.status).toBe(400);
      expect(mockIniciar).toHaveBeenCalledTimes(1);
    });

    it('la conciliación cierra los retiros en proceso cuando el banco responde', async () => {
      const { user, admin, withdrawal } = await retiroPendiente();
      await aprobar(withdrawal.id, admin);

      expect(await conciliarRetirosEnProceso()).toMatchObject({ revisados: 1, enProceso: 1 });

      mockEstado.mockResolvedValue('rechazada');
      expect(await conciliarRetirosEnProceso()).toMatchObject({ revisados: 1, rechazados: 1 });
      expect((await prisma.withdrawal.findUnique({ where: { id: withdrawal.id } }))?.status).toBe('rechazado');
      expect(await saldoDe(user.id)).toBe(100000);

      expect(await conciliarRetirosEnProceso()).toMatchObject({ revisados: 0 });
    });
  });
});
