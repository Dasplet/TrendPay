import request from 'supertest';
import app, { prisma } from '../index';
import { limpiarBaseDeDatos, crearUsuarioDePrueba, tokenPara } from '../tests/testUtils';

jest.mock('../utils/kushki', () => {
  const actual = jest.requireActual('../utils/kushki');
  return { ...actual, chargeCardToken: jest.fn(), initTransfer: jest.fn(), getTransferStatus: jest.fn() };
});
import { chargeCardToken, initTransfer, getTransferStatus, KushkiError } from '../utils/kushki';

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
});
