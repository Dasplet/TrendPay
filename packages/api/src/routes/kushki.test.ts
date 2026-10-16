import request from 'supertest';
import app, { prisma } from '../index';
import { limpiarBaseDeDatos, crearUsuarioDePrueba, tokenPara } from '../tests/testUtils';

jest.mock('../utils/kushki', () => {
  const actual = jest.requireActual('../utils/kushki');
  return { ...actual, chargeCardToken: jest.fn(), initTransfer: jest.fn(), getTransferStatus: jest.fn() };
});
import { chargeCardToken, initTransfer, getTransferStatus, KushkiError } from '../utils/kushki';
import { conciliarPagosPendientes, resolverPagoPse } from '../utils/kushkiPayments';

describe('Kushki routes', () => {
  afterAll(async () => {
    await limpiarBaseDeDatos();
    await prisma.$disconnect();
  });

  beforeEach(async () => {
    await limpiarBaseDeDatos();
    jest.clearAllMocks();
  });

  describe('POST /api/kushki/consignar/tarjeta', () => {
    it('acredita el saldo cuando Kushki aprueba el cobro', async () => {
      const user = await crearUsuarioDePrueba({ saldo: 0 });
      (chargeCardToken as jest.Mock).mockResolvedValue({
        ticketNumber: '024359172387595393',
        transactionReference: 'f70c3f7f-a4d4-4227-bf4f-2fe693cafa0b',
      });

      const res = await request(app)
        .post('/api/kushki/consignar/tarjeta')
        .set('Authorization', `Bearer ${tokenPara(user)}`)
        .send({ token: 'tok_de_prueba_1234567890', monto: 30000 });

      expect(res.status).toBe(200);
      expect(res.body.saldo).toBe(30000);

      // La billetera recibe el monto completo; la comisión (3%, redondeada
      // hacia arriba) se cobra encima, en la tarjeta.
      expect(chargeCardToken).toHaveBeenCalledWith('tok_de_prueba_1234567890', 30900);

      const wallet = await prisma.wallet.findUnique({ where: { userId: user.id } });
      expect(Number(wallet!.saldo)).toBe(30000);

      const pago = await prisma.kushkiPayment.findFirst({ where: { userId: user.id } });
      expect(pago!.estado).toBe('completado');
      expect(pago!.metodo).toBe('tarjeta');
      expect(pago!.ticketNumber).toBe('024359172387595393');

      const tx = await prisma.transaction.findFirst({ where: { userId: user.id, categoria: 'consigna' } });
      expect(tx).not.toBeNull();
      expect(Number(tx!.comisionValor)).toBe(900);
      expect(Number(tx!.montoNeto)).toBe(30000);
    });

    it('no acredita saldo y registra el rechazo cuando Kushki lo declina', async () => {
      const user = await crearUsuarioDePrueba({ saldo: 0 });
      (chargeCardToken as jest.Mock).mockRejectedValue(new KushkiError('Fondos insuficientes', 402));

      const res = await request(app)
        .post('/api/kushki/consignar/tarjeta')
        .set('Authorization', `Bearer ${tokenPara(user)}`)
        .send({ token: 'tok_de_prueba_1234567890', monto: 30000 });

      expect(res.status).toBe(402);
      expect(res.body.mensaje).toBe('Fondos insuficientes');

      const wallet = await prisma.wallet.findUnique({ where: { userId: user.id } });
      expect(Number(wallet!.saldo)).toBe(0);

      const pago = await prisma.kushkiPayment.findFirst({ where: { userId: user.id } });
      expect(pago!.estado).toBe('rechazado');
    });

    it('rechaza un monto por debajo del mínimo', async () => {
      const user = await crearUsuarioDePrueba();
      const res = await request(app)
        .post('/api/kushki/consignar/tarjeta')
        .set('Authorization', `Bearer ${tokenPara(user)}`)
        .send({ token: 'tok_de_prueba_1234567890', monto: 500 });

      expect(res.status).toBe(400);
      expect(chargeCardToken).not.toHaveBeenCalled();
    });

    it('rechaza la solicitud sin token de autenticación', async () => {
      const res = await request(app)
        .post('/api/kushki/consignar/tarjeta')
        .send({ token: 'tok_de_prueba_1234567890', monto: 30000 });
      expect(res.status).toBe(401);
    });
  });

  describe('POST /api/kushki/consignar/pse/iniciar', () => {
    const datosPse = {
      token: 'tok_transferencia_1234567890',
      monto: 30000,
      documentType: 'CC' as const,
      documentNumber: '1023456789',
      email: 'juan.garcia@email.com',
      nombreCompleto: 'Juan García',
    };

    it('abre el pago PSE y devuelve la redirectUrl sin acreditar saldo todavía', async () => {
      const user = await crearUsuarioDePrueba({ saldo: 0 });
      (initTransfer as jest.Mock).mockResolvedValue({
        redirectUrl: 'https://api-uat.kushkipagos.com/transfer/v1/agent?token=tok_transferencia_1234567890&mid=123',
        transactionReference: '72e06172-cf21-43f2-b8d9-a4d42bda86f1',
      });

      const res = await request(app)
        .post('/api/kushki/consignar/pse/iniciar')
        .set('Authorization', `Bearer ${tokenPara(user)}`)
        .send(datosPse);

      expect(res.status).toBe(200);
      expect(res.body.redirectUrl).toContain('kushkipagos.com');

      // El PSE también cobra monto+comisión al banco (30000 + 900).
      expect(initTransfer).toHaveBeenCalledWith(
        datosPse.token,
        30900,
        expect.objectContaining({ fullName: datosPse.nombreCompleto, email: datosPse.email })
      );

      const wallet = await prisma.wallet.findUnique({ where: { userId: user.id } });
      expect(Number(wallet!.saldo)).toBe(0);

      const pago = await prisma.kushkiPayment.findUnique({ where: { reference: datosPse.token } });
      expect(pago!.estado).toBe('pendiente');
      expect(pago!.metodo).toBe('pse');
    });

    it('rechaza un monto por debajo del mínimo', async () => {
      const user = await crearUsuarioDePrueba();
      const res = await request(app)
        .post('/api/kushki/consignar/pse/iniciar')
        .set('Authorization', `Bearer ${tokenPara(user)}`)
        .send({ ...datosPse, monto: 500 });

      expect(res.status).toBe(400);
      expect(initTransfer).not.toHaveBeenCalled();
    });
  });

  describe('POST /api/kushki/consignar/pse/confirmar', () => {
    it('acredita el saldo cuando el banco aprueba la transacción', async () => {
      const user = await crearUsuarioDePrueba({ saldo: 0 });
      await prisma.kushkiPayment.create({
        data: { userId: user.id, reference: 'tok_pendiente', metodo: 'pse', monto: 30000, estado: 'pendiente' },
      });
      (getTransferStatus as jest.Mock).mockResolvedValue({ estado: 'aprobada', ticketNumber: '9395131991058926' });

      const res = await request(app)
        .post('/api/kushki/consignar/pse/confirmar')
        .set('Authorization', `Bearer ${tokenPara(user)}`)
        .send({ token: 'tok_pendiente' });

      expect(res.status).toBe(200);
      expect(res.body.estado).toBe('completado');
      expect(res.body.saldo).toBe(30000);

      const wallet = await prisma.wallet.findUnique({ where: { userId: user.id } });
      expect(Number(wallet!.saldo)).toBe(30000);

      const pago = await prisma.kushkiPayment.findUnique({ where: { reference: 'tok_pendiente' } });
      expect(pago!.estado).toBe('completado');

      const tx = await prisma.transaction.findFirst({ where: { userId: user.id, categoria: 'consigna' } });
      expect(Number(tx!.comisionValor)).toBe(900);
      expect(Number(tx!.montoNeto)).toBe(30000);
    });

    it('no acredita saldo mientras el banco sigue validando', async () => {
      const user = await crearUsuarioDePrueba({ saldo: 0 });
      await prisma.kushkiPayment.create({
        data: { userId: user.id, reference: 'tok_pendiente', metodo: 'pse', monto: 30000, estado: 'pendiente' },
      });
      (getTransferStatus as jest.Mock).mockResolvedValue({ estado: 'pendiente' });

      const res = await request(app)
        .post('/api/kushki/consignar/pse/confirmar')
        .set('Authorization', `Bearer ${tokenPara(user)}`)
        .send({ token: 'tok_pendiente' });

      expect(res.status).toBe(200);
      expect(res.body.estado).toBe('pendiente');

      const wallet = await prisma.wallet.findUnique({ where: { userId: user.id } });
      expect(Number(wallet!.saldo)).toBe(0);
    });

    it('marca el pago como rechazado y no acredita saldo cuando el banco lo declina', async () => {
      const user = await crearUsuarioDePrueba({ saldo: 0 });
      await prisma.kushkiPayment.create({
        data: { userId: user.id, reference: 'tok_pendiente', metodo: 'pse', monto: 30000, estado: 'pendiente' },
      });
      (getTransferStatus as jest.Mock).mockResolvedValue({ estado: 'rechazada' });

      const res = await request(app)
        .post('/api/kushki/consignar/pse/confirmar')
        .set('Authorization', `Bearer ${tokenPara(user)}`)
        .send({ token: 'tok_pendiente' });

      expect(res.status).toBe(200);
      expect(res.body.estado).toBe('rechazado');

      const wallet = await prisma.wallet.findUnique({ where: { userId: user.id } });
      expect(Number(wallet!.saldo)).toBe(0);
    });

    it('es idempotente: no vuelve a acreditar un pago ya completado', async () => {
      const user = await crearUsuarioDePrueba({ saldo: 30000 });
      await prisma.kushkiPayment.create({
        data: { userId: user.id, reference: 'tok_completado', metodo: 'pse', monto: 30000, estado: 'completado' },
      });

      const res = await request(app)
        .post('/api/kushki/consignar/pse/confirmar')
        .set('Authorization', `Bearer ${tokenPara(user)}`)
        .send({ token: 'tok_completado' });

      expect(res.status).toBe(200);
      expect(res.body.estado).toBe('completado');
      expect(getTransferStatus).not.toHaveBeenCalled();

      const wallet = await prisma.wallet.findUnique({ where: { userId: user.id } });
      expect(Number(wallet!.saldo)).toBe(30000);
    });

    it('rechaza confirmar un pago de otro usuario', async () => {
      const dueno = await crearUsuarioDePrueba();
      const otro = await crearUsuarioDePrueba();
      await prisma.kushkiPayment.create({
        data: { userId: dueno.id, reference: 'tok_ajeno_1234567890', metodo: 'pse', monto: 30000, estado: 'pendiente' },
      });

      const res = await request(app)
        .post('/api/kushki/consignar/pse/confirmar')
        .set('Authorization', `Bearer ${tokenPara(otro)}`)
        .send({ token: 'tok_ajeno_1234567890' });

      expect(res.status).toBe(404);
      expect(getTransferStatus).not.toHaveBeenCalled();
    });
  });

  describe('resolverPagoPse (concurrencia)', () => {
    it('no acredita dos veces si dos resoluciones llegan a la vez', async () => {
      const user = await crearUsuarioDePrueba({ saldo: 0 });
      const pago = await prisma.kushkiPayment.create({
        data: { userId: user.id, reference: 'tok_carrera_1234567890', metodo: 'pse', monto: 30000, estado: 'pendiente' },
      });
      (getTransferStatus as jest.Mock).mockResolvedValue({ estado: 'aprobada', ticketNumber: '555' });

      await Promise.all([resolverPagoPse(pago), resolverPagoPse(pago)]);

      const wallet = await prisma.wallet.findUnique({ where: { userId: user.id } });
      expect(Number(wallet!.saldo)).toBe(30000);
      const txs = await prisma.transaction.count({ where: { userId: user.id, categoria: 'consigna' } });
      expect(txs).toBe(1);
    });
  });

  describe('conciliarPagosPendientes', () => {
    const haceMinutos = (m: number) => new Date(Date.now() - m * 60_000);

    it('acredita un PSE aprobado cuyo usuario nunca volvió del banco', async () => {
      const user = await crearUsuarioDePrueba({ saldo: 0 });
      await prisma.kushkiPayment.create({
        data: { userId: user.id, reference: 'tok_abandonado_123456', metodo: 'pse', monto: 20000, estado: 'pendiente', createdAt: haceMinutos(15) },
      });
      (getTransferStatus as jest.Mock).mockResolvedValue({ estado: 'aprobada', ticketNumber: '777' });

      const resumen = await conciliarPagosPendientes();

      expect(resumen).toEqual({ revisados: 1, completados: 1, rechazados: 0, pendientes: 0, errores: 0 });
      const wallet = await prisma.wallet.findUnique({ where: { userId: user.id } });
      expect(Number(wallet!.saldo)).toBe(20000);

      // una segunda pasada ya no encuentra nada pendiente ni vuelve a acreditar
      const segunda = await conciliarPagosPendientes();
      expect(segunda.revisados).toBe(0);
      const despues = await prisma.wallet.findUnique({ where: { userId: user.id } });
      expect(Number(despues!.saldo)).toBe(20000);
    });

    it('ignora pagos muy recientes y muy antiguos', async () => {
      const user = await crearUsuarioDePrueba({ saldo: 0 });
      await prisma.kushkiPayment.create({
        data: { userId: user.id, reference: 'tok_reciente_1234567', metodo: 'pse', monto: 20000, estado: 'pendiente', createdAt: haceMinutos(0.5) },
      });
      await prisma.kushkiPayment.create({
        data: { userId: user.id, reference: 'tok_antiguo_12345678', metodo: 'pse', monto: 20000, estado: 'pendiente', createdAt: haceMinutos(60 * 30) },
      });

      const resumen = await conciliarPagosPendientes();

      expect(resumen.revisados).toBe(0);
      expect(getTransferStatus).not.toHaveBeenCalled();
    });

    it('un error de Kushki en un pago no detiene el resto', async () => {
      const user = await crearUsuarioDePrueba({ saldo: 0 });
      await prisma.kushkiPayment.create({
        data: { userId: user.id, reference: 'tok_falla_123456789', metodo: 'pse', monto: 10000, estado: 'pendiente', createdAt: haceMinutos(20) },
      });
      await prisma.kushkiPayment.create({
        data: { userId: user.id, reference: 'tok_ok_12345678901', metodo: 'pse', monto: 10000, estado: 'pendiente', createdAt: haceMinutos(10) },
      });
      (getTransferStatus as jest.Mock)
        .mockRejectedValueOnce(new KushkiError('Kushki caído', 502))
        .mockResolvedValueOnce({ estado: 'rechazada' });

      const resumen = await conciliarPagosPendientes();

      expect(resumen).toEqual({ revisados: 2, completados: 0, rechazados: 1, pendientes: 0, errores: 1 });
    });
  });

  describe('GET /api/kushki/consignaciones', () => {
    it('devuelve solo las consignaciones del usuario y el token solo del PSE pendiente', async () => {
      const user = await crearUsuarioDePrueba();
      const otro = await crearUsuarioDePrueba();
      await prisma.kushkiPayment.create({ data: { userId: user.id, reference: 'tok_mio_pendiente_123', metodo: 'pse', monto: 20000, estado: 'pendiente' } });
      await prisma.kushkiPayment.create({ data: { userId: user.id, reference: 'DEP-111111', metodo: 'tarjeta', monto: 30000, estado: 'completado' } });
      await prisma.kushkiPayment.create({ data: { userId: otro.id, reference: 'tok_ajeno_pendiente_12', metodo: 'pse', monto: 99000, estado: 'pendiente' } });

      const res = await request(app).get('/api/kushki/consignaciones').set('Authorization', `Bearer ${tokenPara(user)}`);

      expect(res.status).toBe(200);
      expect(res.body.consignaciones).toHaveLength(2);
      const pse = res.body.consignaciones.find((c: any) => c.metodo === 'pse');
      const tarjeta = res.body.consignaciones.find((c: any) => c.metodo === 'tarjeta');
      expect(pse.token).toBe('tok_mio_pendiente_123');
      expect(tarjeta.token).toBeUndefined();
    });

    it('exige autenticación', async () => {
      const res = await request(app).get('/api/kushki/consignaciones');
      expect(res.status).toBe(401);
    });
  });

  describe('Panel admin de Kushki', () => {
    it('lista pagos con totales por estado', async () => {
      const admin = await crearUsuarioDePrueba({ rol: 'admin' });
      const user = await crearUsuarioDePrueba();
      await prisma.kushkiPayment.create({ data: { userId: user.id, reference: 'DEP-222222', metodo: 'tarjeta', monto: 30000, estado: 'completado' } });
      await prisma.kushkiPayment.create({ data: { userId: user.id, reference: 'tok_admin_pend_12345', metodo: 'pse', monto: 20000, estado: 'pendiente' } });

      const res = await request(app).get('/api/admin/kushki/pagos').set('Authorization', `Bearer ${tokenPara(admin)}`);

      expect(res.status).toBe(200);
      expect(res.body.pagos).toHaveLength(2);
      expect(res.body.totales).toEqual(expect.arrayContaining([
        { estado: 'completado', cantidad: 1, monto: 30000 },
        { estado: 'pendiente', cantidad: 1, monto: 20000 },
      ]));
    });

    it('un usuario normal no puede listar ni conciliar', async () => {
      const user = await crearUsuarioDePrueba();
      const auth = { Authorization: `Bearer ${tokenPara(user)}` };
      expect((await request(app).get('/api/admin/kushki/pagos').set(auth)).status).toBe(403);
      expect((await request(app).post('/api/admin/kushki/conciliar').set(auth)).status).toBe(403);
    });

    it('el admin puede forzar la conciliación', async () => {
      const admin = await crearUsuarioDePrueba({ rol: 'admin' });
      const user = await crearUsuarioDePrueba({ saldo: 0 });
      await prisma.kushkiPayment.create({
        data: { userId: user.id, reference: 'tok_forzar_12345678', metodo: 'pse', monto: 15000, estado: 'pendiente' },
      });
      (getTransferStatus as jest.Mock).mockResolvedValue({ estado: 'aprobada', ticketNumber: '888' });

      const res = await request(app).post('/api/admin/kushki/conciliar').set('Authorization', `Bearer ${tokenPara(admin)}`);

      expect(res.status).toBe(200);
      expect(res.body.resumen.completados).toBe(1);
    });
  });
});
