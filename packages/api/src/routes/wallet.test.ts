import request from 'supertest';
import app, { prisma } from '../index';
import { limpiarBaseDeDatos, crearUsuarioDePrueba, tokenPara } from '../tests/testUtils';

describe('Wallet API', () => {
  afterAll(async () => {
    await limpiarBaseDeDatos();
    await prisma.$disconnect();
  });

  beforeEach(async () => {
    await limpiarBaseDeDatos();
  });

  describe('POST /api/wallet/enviar', () => {
    it('transfiere dinero entre dos usuarios cobrando 3% de comisión al remitente', async () => {
      const a = await crearUsuarioDePrueba({ saldo: 100000 });
      const b = await crearUsuarioDePrueba({ saldo: 5000 });

      const res = await request(app)
        .post('/api/wallet/enviar')
        .set('Authorization', `Bearer ${tokenPara(a)}`)
        .send({ destino: b.cedula, monto: 10000 });

      expect(res.status).toBe(200);
      expect(res.body.ok).toBe(true);
      expect(res.body.saldo).toBe(100000 - 10000 - 300); // 3% de 10000 = 300

      const walletA = await prisma.wallet.findUnique({ where: { userId: a.id } });
      const walletB = await prisma.wallet.findUnique({ where: { userId: b.id } });
      expect(Number(walletA!.saldo)).toBe(89700);
      expect(Number(walletB!.saldo)).toBe(15000);
    });

    it('rechaza el envío si el remitente no tiene saldo suficiente', async () => {
      const a = await crearUsuarioDePrueba({ saldo: 1000 });
      const b = await crearUsuarioDePrueba({ saldo: 0 });

      const res = await request(app)
        .post('/api/wallet/enviar')
        .set('Authorization', `Bearer ${tokenPara(a)}`)
        .send({ destino: b.cedula, monto: 10000 });

      expect(res.status).toBe(400);
      expect(res.body.ok).toBe(false);

      const walletA = await prisma.wallet.findUnique({ where: { userId: a.id } });
      expect(Number(walletA!.saldo)).toBe(1000); // sin cambios
    });

    it('rechaza enviarse dinero a uno mismo', async () => {
      const a = await crearUsuarioDePrueba({ saldo: 100000 });

      const res = await request(app)
        .post('/api/wallet/enviar')
        .set('Authorization', `Bearer ${tokenPara(a)}`)
        .send({ destino: a.cedula, monto: 1000 });

      expect(res.status).toBe(400);
    });

    it('rechaza el envío si el destinatario no existe', async () => {
      const a = await crearUsuarioDePrueba({ saldo: 100000 });

      const res = await request(app)
        .post('/api/wallet/enviar')
        .set('Authorization', `Bearer ${tokenPara(a)}`)
        .send({ destino: 'no-existe-este-usuario', monto: 1000 });

      expect(res.status).toBe(404);
    });

    it('rechaza la solicitud sin token de autenticación', async () => {
      const res = await request(app).post('/api/wallet/enviar').send({ destino: 'x', monto: 1000 });
      expect(res.status).toBe(401);
    });

    it('no permite que dos envíos concurrentes dejen el saldo en negativo', async () => {
      // Saldo alcanza para UN envío de 10.000 (+3% = 10.300) pero no para dos.
      const a = await crearUsuarioDePrueba({ saldo: 15000 });
      const b = await crearUsuarioDePrueba({ saldo: 0 });

      const enviar = () =>
        request(app)
          .post('/api/wallet/enviar')
          .set('Authorization', `Bearer ${tokenPara(a)}`)
          .send({ destino: b.cedula, monto: 10000 });

      const [r1, r2] = await Promise.all([enviar(), enviar()]);
      const resultados = [r1.status, r2.status].sort();

      expect(resultados).toEqual([200, 400]); // uno pasa, el otro se rechaza por saldo insuficiente

      const walletA = await prisma.wallet.findUnique({ where: { userId: a.id } });
      expect(Number(walletA!.saldo)).toBe(15000 - 10300); // solo se descontó una vez, nunca negativo
    });
  });

  describe('Flujo de QR de un solo uso', () => {
    it('genera, paga y bloquea un segundo pago del mismo QR', async () => {
      const owner = await crearUsuarioDePrueba({ saldo: 0 });
      const payer = await crearUsuarioDePrueba({ saldo: 50000 });

      const generar = await request(app)
        .post('/api/wallet/qr/generar')
        .set('Authorization', `Bearer ${tokenPara(owner)}`)
        .send({ monto: 20000, concepto: 'Prueba' });
      expect(generar.status).toBe(200);
      const token = generar.body.qr.token;

      const preview = await request(app)
        .get(`/api/wallet/qr/${token}`)
        .set('Authorization', `Bearer ${tokenPara(payer)}`);
      expect(preview.status).toBe(200);
      expect(preview.body.qr.monto).toBe(20000);
      expect(preview.body.qr.usado).toBe(false);

      const pago1 = await request(app)
        .post(`/api/wallet/qr/${token}/pagar`)
        .set('Authorization', `Bearer ${tokenPara(payer)}`)
        .send({});
      expect(pago1.status).toBe(200);

      const pago2 = await request(app)
        .post(`/api/wallet/qr/${token}/pagar`)
        .set('Authorization', `Bearer ${tokenPara(payer)}`)
        .send({});
      expect(pago2.status).toBe(400);
      expect(pago2.body.mensaje).toMatch(/ya fue pagado/i);

      const walletOwner = await prisma.wallet.findUnique({ where: { userId: owner.id } });
      expect(Number(walletOwner!.saldo)).toBe(20000); // solo se acreditó una vez
    });

    it('no permite pagar el propio QR', async () => {
      const owner = await crearUsuarioDePrueba({ saldo: 0 });
      const generar = await request(app)
        .post('/api/wallet/qr/generar')
        .set('Authorization', `Bearer ${tokenPara(owner)}`)
        .send({ monto: 5000 });
      const token = generar.body.qr.token;

      const pago = await request(app)
        .post(`/api/wallet/qr/${token}/pagar`)
        .set('Authorization', `Bearer ${tokenPara(owner)}`)
        .send({});
      expect(pago.status).toBe(400);
    });
  });

  describe('QR personal (permanente)', () => {
    it('siempre devuelve el mismo token y se puede pagar más de una vez', async () => {
      const owner = await crearUsuarioDePrueba({ saldo: 0 });
      const payer = await crearUsuarioDePrueba({ saldo: 100000 });

      const p1 = await request(app).get('/api/wallet/qr/personal').set('Authorization', `Bearer ${tokenPara(owner)}`);
      const p2 = await request(app).get('/api/wallet/qr/personal').set('Authorization', `Bearer ${tokenPara(owner)}`);
      expect(p1.body.qr.token).toBe(p2.body.qr.token);

      const token = p1.body.qr.token;

      const pago1 = await request(app)
        .post(`/api/wallet/qr/${token}/pagar`)
        .set('Authorization', `Bearer ${tokenPara(payer)}`)
        .send({ monto: 10000 });
      expect(pago1.status).toBe(200);

      const pago2 = await request(app)
        .post(`/api/wallet/qr/${token}/pagar`)
        .set('Authorization', `Bearer ${tokenPara(payer)}`)
        .send({ monto: 5000 });
      expect(pago2.status).toBe(200); // el QR permanente no se bloquea tras el primer pago

      const walletOwner = await prisma.wallet.findUnique({ where: { userId: owner.id } });
      expect(Number(walletOwner!.saldo)).toBe(15000); // 10.000 + 5.000
    });
  });

  describe('GET /api/wallet/balance y /history', () => {
    it('devuelve el saldo actual', async () => {
      const a = await crearUsuarioDePrueba({ saldo: 42000 });
      const res = await request(app).get('/api/wallet/balance').set('Authorization', `Bearer ${tokenPara(a)}`);
      expect(res.status).toBe(200);
      expect(res.body.saldo).toBe(42000);
    });

    it('lista el historial de transacciones del usuario, más recientes primero', async () => {
      const a = await crearUsuarioDePrueba({ saldo: 100000 });
      const b = await crearUsuarioDePrueba({ saldo: 0 });
      await request(app).post('/api/wallet/enviar').set('Authorization', `Bearer ${tokenPara(a)}`).send({ destino: b.cedula, monto: 1000 });
      await request(app).post('/api/wallet/enviar').set('Authorization', `Bearer ${tokenPara(a)}`).send({ destino: b.cedula, monto: 2000 });

      const res = await request(app).get('/api/wallet/history').set('Authorization', `Bearer ${tokenPara(a)}`);
      expect(res.status).toBe(200);
      expect(res.body.transacciones).toHaveLength(2);
      expect(res.body.transacciones[0].monto_bruto).toBe(2000); // el más reciente primero
    });
  });
});
