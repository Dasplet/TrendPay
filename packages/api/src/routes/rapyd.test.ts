import request from 'supertest';
import app, { prisma } from '../index';
import { limpiarBaseDeDatos, crearUsuarioDePrueba, tokenPara } from '../tests/testUtils';

jest.mock('../utils/rapyd', () => {
  const actual = jest.requireActual('../utils/rapyd');
  return { ...actual, getCheckoutPage: jest.fn() };
});
import { getCheckoutPage } from '../utils/rapyd';

describe('Rapyd routes', () => {
  afterAll(async () => {
    await limpiarBaseDeDatos();
    await prisma.$disconnect();
  });

  beforeEach(async () => {
    await limpiarBaseDeDatos();
    jest.clearAllMocks();
  });

  describe('GET /api/rapyd/verificar/:reference', () => {
    it('acredita el pago y actualiza el saldo cuando Rapyd confirma que ya fue pagado', async () => {
      const user = await crearUsuarioDePrueba({ saldo: 0 });
      const payment = await prisma.rapydPayment.create({
        data: { userId: user.id, reference: 'DEP-TEST-1', checkoutId: 'checkout_123', monto: 25000, estado: 'pendiente' },
      });

      (getCheckoutPage as jest.Mock).mockResolvedValue({ payment: { paid: true, id: 'rapyd_pay_1' }, status: 'CLO' });

      const res = await request(app)
        .get(`/api/rapyd/verificar/${payment.reference}`)
        .set('Authorization', `Bearer ${tokenPara(user)}`);

      expect(res.status).toBe(200);
      expect(res.body.estado).toBe('completado');
      expect(res.body.saldo).toBe(25000);

      const wallet = await prisma.wallet.findUnique({ where: { userId: user.id } });
      expect(Number(wallet!.saldo)).toBe(25000);

      const tx = await prisma.transaction.findFirst({ where: { userId: user.id, categoria: 'consigna' } });
      expect(tx).not.toBeNull();
    });

    it('marca la consignación como rechazada si el checkout expiró', async () => {
      const user = await crearUsuarioDePrueba({ saldo: 0 });
      const payment = await prisma.rapydPayment.create({
        data: { userId: user.id, reference: 'DEP-TEST-2', checkoutId: 'checkout_456', monto: 10000, estado: 'pendiente' },
      });
      (getCheckoutPage as jest.Mock).mockResolvedValue({ payment: { paid: false }, status: 'EXP' });

      const res = await request(app)
        .get(`/api/rapyd/verificar/${payment.reference}`)
        .set('Authorization', `Bearer ${tokenPara(user)}`);

      expect(res.status).toBe(200);
      expect(res.body.estado).toBe('rechazado');
    });

    it('devuelve 404 si la consignación no pertenece al usuario', async () => {
      const user = await crearUsuarioDePrueba();
      const otro = await crearUsuarioDePrueba();
      const payment = await prisma.rapydPayment.create({
        data: { userId: otro.id, reference: 'DEP-TEST-3', monto: 5000, estado: 'pendiente' },
      });

      const res = await request(app)
        .get(`/api/rapyd/verificar/${payment.reference}`)
        .set('Authorization', `Bearer ${tokenPara(user)}`);
      expect(res.status).toBe(404);
    });
  });
});
