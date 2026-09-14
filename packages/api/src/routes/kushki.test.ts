import request from 'supertest';
import app, { prisma } from '../index';
import { limpiarBaseDeDatos, crearUsuarioDePrueba, tokenPara } from '../tests/testUtils';

jest.mock('../utils/kushki', () => {
  const actual = jest.requireActual('../utils/kushki');
  return { ...actual, chargeCardToken: jest.fn() };
});
import { chargeCardToken, KushkiError } from '../utils/kushki';

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

      const wallet = await prisma.wallet.findUnique({ where: { userId: user.id } });
      expect(Number(wallet!.saldo)).toBe(30000);

      const pago = await prisma.kushkiPayment.findFirst({ where: { userId: user.id } });
      expect(pago!.estado).toBe('completado');
      expect(pago!.metodo).toBe('tarjeta');
      expect(pago!.ticketNumber).toBe('024359172387595393');

      const tx = await prisma.transaction.findFirst({ where: { userId: user.id, categoria: 'consigna' } });
      expect(tx).not.toBeNull();
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
});
