import request from 'supertest';
import app, { prisma } from '../index';
import { limpiarBaseDeDatos, crearUsuarioDePrueba, crearSubcuentaDePrueba, tokenPara } from '../tests/testUtils';

jest.mock('../utils/kushki', () => {
  const actual = jest.requireActual('../utils/kushki');
  return { ...actual, chargeCardToken: jest.fn(), initTransfer: jest.fn(), getTransferStatus: jest.fn() };
});
import { chargeCardToken, getTransferStatus } from '../utils/kushki';

const retiro = { bancoNombre: 'Bancolombia', tipoCuenta: 'Ahorros', numeroCuenta: '12345678901', cedulaTitular: '1020304050', nombreTitular: 'Empresa Padre SAS' };

// Escenario empresarial: un padre con billetera y dos subcuentas que la comparten.
// Hijo 1 solo recarga y no ve el saldo; Hijo 2 ve el saldo y solo retira.
async function crearEmpresa(saldo = 100000) {
  const padre = await crearUsuarioDePrueba({ saldo, nombre: 'Empresa Padre' });
  const hijo1 = await crearSubcuentaDePrueba(padre.id, { permisoVerSaldo: false, permisoRecargar: true, permisoEnviar: false, permisoRetirar: false });
  const hijo2 = await crearSubcuentaDePrueba(padre.id, { permisoVerSaldo: true, permisoRecargar: false, permisoEnviar: false, permisoRetirar: true });
  return { padre, hijo1, hijo2 };
}

async function saldoDe(userId: string) {
  const wallet = await prisma.wallet.findUnique({ where: { userId } });
  return Number(wallet!.saldo);
}

describe('Subcuentas empresariales', () => {
  afterAll(async () => {
    await limpiarBaseDeDatos();
    await prisma.$disconnect();
  });

  beforeEach(async () => {
    await limpiarBaseDeDatos();
    jest.clearAllMocks();
  });

  describe('saldo compartido', () => {
    it('el padre y el hijo 2 ven el mismo saldo; el hijo 1 no puede verlo', async () => {
      const { padre, hijo1, hijo2 } = await crearEmpresa(100000);

      const rPadre = await request(app).get('/api/wallet/balance').set('Authorization', `Bearer ${tokenPara(padre)}`);
      const rHijo2 = await request(app).get('/api/wallet/balance').set('Authorization', `Bearer ${tokenPara(hijo2)}`);
      const rHijo1 = await request(app).get('/api/wallet/balance').set('Authorization', `Bearer ${tokenPara(hijo1)}`);

      expect(rPadre.body.saldo).toBe(100000);
      expect(rHijo2.body.saldo).toBe(100000);
      expect(rHijo2.body.walletId).toBe(rPadre.body.walletId);
      expect(rHijo1.status).toBe(403);
      expect(rHijo1.body.code).toBe('SIN_PERMISO');
    });

    it('/auth/me devuelve permisos y oculta el saldo (null) al hijo 1', async () => {
      const { padre, hijo1, hijo2 } = await crearEmpresa(100000);

      const rHijo1 = await request(app).get('/api/auth/me').set('Authorization', `Bearer ${tokenPara(hijo1)}`);
      const rHijo2 = await request(app).get('/api/auth/me').set('Authorization', `Bearer ${tokenPara(hijo2)}`);

      expect(rHijo1.body.usuario.saldo).toBeNull();
      expect(rHijo1.body.usuario.permisos).toEqual({ verSaldo: false, recargar: true, enviar: false, retirar: false });
      expect(rHijo1.body.usuario.cuentaPadre).toEqual({ id: padre.id, nombre: 'Empresa Padre' });
      expect(rHijo2.body.usuario.saldo).toBe(100000);
      expect(rHijo2.body.usuario.walletId).toBe(padre.wallet!.id);
    });

    it('el login de una subcuenta devuelve la billetera del padre', async () => {
      const { padre, hijo2 } = await crearEmpresa(100000);

      const res = await request(app).post('/api/auth/login').send({ cedula: hijo2.cedula, pin: '1234' });

      expect(res.status).toBe(200);
      expect(res.body.usuario.saldo).toBe(100000);
      expect(res.body.usuario.walletId).toBe(padre.wallet!.id);
    });
  });

  describe('hijo 1 · solo recarga', () => {
    it('recarga con tarjeta y el dinero llega a la billetera del padre, sin revelar el saldo', async () => {
      const { padre, hijo1 } = await crearEmpresa(100000);
      (chargeCardToken as jest.Mock).mockResolvedValue({ ticketNumber: '111', transactionReference: 'abc' });

      const res = await request(app)
        .post('/api/kushki/consignar/tarjeta')
        .set('Authorization', `Bearer ${tokenPara(hijo1)}`)
        .send({ token: 'tok_de_prueba_1234567890', monto: 20000 });

      expect(res.status).toBe(200);
      expect(res.body.saldo).toBeUndefined();
      expect(await saldoDe(padre.id)).toBe(120000);
    });

    it('un PSE confirmado de la subcuenta acredita la billetera del padre', async () => {
      const { padre, hijo1 } = await crearEmpresa(0);
      await prisma.kushkiPayment.create({ data: { userId: hijo1.id, reference: 'tok_pse_hijo_123456', metodo: 'pse', monto: 15000 } });
      (getTransferStatus as jest.Mock).mockResolvedValue({ estado: 'aprobada', ticketNumber: '222' });

      const res = await request(app)
        .post('/api/kushki/consignar/pse/confirmar')
        .set('Authorization', `Bearer ${tokenPara(hijo1)}`)
        .send({ token: 'tok_pse_hijo_123456' });

      expect(res.body.estado).toBe('completado');
      expect(res.body.saldo).toBeUndefined();
      expect(await saldoDe(padre.id)).toBe(15000);
    });

    it('no puede enviar, retirar ni pagar QR', async () => {
      const { hijo1 } = await crearEmpresa(100000);
      const otro = await crearUsuarioDePrueba({ saldo: 0 });
      const auth = `Bearer ${tokenPara(hijo1)}`;

      const envio = await request(app).post('/api/wallet/enviar').set('Authorization', auth).send({ destino: otro.cedula, monto: 1000 });
      const ret = await request(app).post('/api/withdrawals').set('Authorization', auth).send({ ...retiro, monto: 10000 });
      const qr = await request(app).post('/api/wallet/qr/cualquiera/pagar').set('Authorization', auth).send({ monto: 1000 });

      expect([envio.status, ret.status, qr.status]).toEqual([403, 403, 403]);
    });
  });

  describe('hijo 2 · ve el saldo y solo retira', () => {
    it('retira de la billetera compartida', async () => {
      const { padre, hijo2 } = await crearEmpresa(100000);

      const res = await request(app)
        .post('/api/withdrawals')
        .set('Authorization', `Bearer ${tokenPara(hijo2)}`)
        .send({ ...retiro, monto: 30000 });

      expect(res.status).toBe(201);
      expect(res.body.saldo).toBe(70000);
      expect(await saldoDe(padre.id)).toBe(70000);
    });

    it('si el admin rechaza su retiro, el reverso vuelve a la billetera del padre', async () => {
      const { padre, hijo2 } = await crearEmpresa(100000);
      const admin = await crearUsuarioDePrueba({ rol: 'admin' });
      const creado = await request(app).post('/api/withdrawals').set('Authorization', `Bearer ${tokenPara(hijo2)}`).send({ ...retiro, monto: 30000 });
      expect(creado.status).toBe(201);
      const w = await prisma.withdrawal.findFirstOrThrow({ where: { userId: hijo2.id } });

      const res = await request(app).put(`/api/withdrawals/${w.id}/reject`).set('Authorization', `Bearer ${tokenPara(admin)}`).send({});

      expect(res.status).toBe(200);
      expect(await saldoDe(padre.id)).toBe(100000);
    });

    it('no puede enviar ni recargar', async () => {
      const { hijo2 } = await crearEmpresa(100000);
      const otro = await crearUsuarioDePrueba({ saldo: 0 });
      const auth = `Bearer ${tokenPara(hijo2)}`;

      const envio = await request(app).post('/api/wallet/enviar').set('Authorization', auth).send({ destino: otro.cedula, monto: 1000 });
      const recarga = await request(app).post('/api/kushki/consignar/tarjeta').set('Authorization', auth).send({ token: 'tok_de_prueba_1234567890', monto: 20000 });
      const cobro = await request(app).post('/api/wallet/qr/generar').set('Authorization', auth).send({});

      expect([envio.status, recarga.status, cobro.status]).toEqual([403, 403, 403]);
      expect(chargeCardToken).not.toHaveBeenCalled();
    });
  });

  describe('información compartida', () => {
    it('el historial de movimientos es el de la billetera común para las tres cuentas', async () => {
      const { padre, hijo1, hijo2 } = await crearEmpresa(100000);
      await request(app).post('/api/withdrawals').set('Authorization', `Bearer ${tokenPara(hijo2)}`).send({ ...retiro, monto: 10000 });

      for (const u of [padre, hijo1, hijo2]) {
        const res = await request(app).get('/api/wallet/history').set('Authorization', `Bearer ${tokenPara(u)}`);
        expect(res.body.transacciones).toHaveLength(1);
        expect(res.body.transacciones[0].categoria).toBe('retiro');
      }

      const retiros = await request(app).get('/api/withdrawals/me').set('Authorization', `Bearer ${tokenPara(padre)}`);
      expect(retiros.body.retiros).toHaveLength(1);
    });

    it('el padre puede enviar dinero y no puede enviarse a una de sus subcuentas', async () => {
      const { padre, hijo1 } = await crearEmpresa(100000);
      const otro = await crearUsuarioDePrueba({ saldo: 0 });
      const auth = `Bearer ${tokenPara(padre)}`;

      const aSubcuenta = await request(app).post('/api/wallet/enviar').set('Authorization', auth).send({ destino: hijo1.cedula, monto: 1000 });
      const aTercero = await request(app).post('/api/wallet/enviar').set('Authorization', auth).send({ destino: otro.cedula, monto: 10000 });

      expect(aSubcuenta.status).toBe(400);
      expect(aTercero.status).toBe(200);
      expect(await saldoDe(otro.id)).toBe(10000);
    });

    it('un tercero que envía a una subcuenta acredita la billetera del padre', async () => {
      const { padre, hijo2 } = await crearEmpresa(0);
      const otro = await crearUsuarioDePrueba({ saldo: 50000 });

      const res = await request(app).post('/api/wallet/enviar').set('Authorization', `Bearer ${tokenPara(otro)}`).send({ destino: hijo2.cedula, monto: 10000 });

      expect(res.status).toBe(200);
      expect(await saldoDe(padre.id)).toBe(10000);
    });
  });
});
