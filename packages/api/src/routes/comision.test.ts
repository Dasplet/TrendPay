import request from 'supertest';
import app, { prisma } from '../index';
import { limpiarBaseDeDatos, crearUsuarioDePrueba, tokenPara } from '../tests/testUtils';
import { calcularComision } from '../utils/comision';

jest.mock('../utils/kushki', () => {
  const actual = jest.requireActual('../utils/kushki');
  return { ...actual, chargeCardToken: jest.fn(), initTransfer: jest.fn(), getTransferStatus: jest.fn() };
});
import { chargeCardToken, initTransfer, getTransferStatus } from '../utils/kushki';
import { resolverPagoPse } from '../utils/kushkiPayments';

describe('Comisión general configurable', () => {
  afterAll(async () => { await limpiarBaseDeDatos(); await prisma.config.deleteMany({ where: { clave: 'comision_pct' } }); await prisma.$disconnect(); });
  beforeEach(async () => {
    await limpiarBaseDeDatos();
    await prisma.config.deleteMany({ where: { clave: 'comision_pct' } });
    jest.clearAllMocks();
  });

  const admin = async () => tokenPara(await crearUsuarioDePrueba({ rol: 'admin' }));
  const fijar = (token: string, comisionPct: number) => request(app).put('/api/admin/comision').set('Authorization', `Bearer ${token}`).send({ comisionPct });
  const leer = (token: string) => request(app).get('/api/admin/comision').set('Authorization', `Bearer ${token}`);

  it('el cálculo redondea hacia arriba en pesos enteros, sin sumar un peso de más por decimales de máquina', () => {
    expect(calcularComision(30000, 3)).toBe(900);
    expect(calcularComision(10001, 3)).toBe(301);   // 300.03 → 301
    expect(calcularComision(1000, 0)).toBe(0);
    expect(calcularComision(100, 3.1)).toBe(4);     // 3.1 → 4
    expect(calcularComision(1000, 2.5)).toBe(25);   // exacto: no sube a 26
    expect(calcularComision(40000, 2.5)).toBe(1000);
  });

  it('sin nada guardado la comisión es 3%', async () => {
    expect((await leer(await admin())).body.comisionPct).toBe(3);
  });

  it('el administrador la cambia, queda guardada y al volver a leerla es la misma (no vuelve al 3%)', async () => {
    const token = await admin();
    expect((await fijar(token, 2.5)).status).toBe(200);
    expect((await leer(token)).body.comisionPct).toBe(2.5);
    expect((await leer(await admin())).body.comisionPct).toBe(2.5); // otra sesión distinta
    expect((await prisma.config.findUniqueOrThrow({ where: { clave: 'comision_pct' } })).valor).toBe('2.5');

    // las métricas del dashboard muestran la cifra vigente
    const metricas = await request(app).get('/api/admin/metrics').set('Authorization', `Bearer ${token}`);
    expect(metricas.body.metricas.comision_pct).toBe(2.5);
    expect(metricas.body.metricas.comision_datafono_pct).toBe(0); // la de datáfonos es otra cifra, con su propia configuración
  });

  it('acepta de 0% a 20%, rechaza lo demás y solo la cambia un administrador; queda auditada con el valor anterior', async () => {
    const token = await admin();
    expect((await fijar(token, 0)).status).toBe(200);
    expect((await fijar(token, 20)).status).toBe(200);
    expect((await fijar(token, 20.5)).status).toBe(400);
    expect((await fijar(token, -1)).status).toBe(400);
    expect((await leer(token)).body.comisionPct).toBe(20);

    const cliente = await crearUsuarioDePrueba({ saldo: 0 });
    expect((await fijar(tokenPara(cliente), 1)).status).toBe(403);
    expect((await leer(tokenPara(cliente))).status).toBe(403);

    const auditoria = await prisma.auditLog.findMany({ where: { accion: 'COMISION_MODIFICADA' }, orderBy: { createdAt: 'asc' } });
    expect(auditoria).toHaveLength(2);
    expect(auditoria[1].datos).toEqual({ antes: { comision: 0 }, despues: { comision: 20 } });
  });

  it('un cliente ve la comisión vigente para mostrar el total real antes de pagar', async () => {
    const cliente = await crearUsuarioDePrueba({ saldo: 0 });
    const token = tokenPara(cliente);
    expect((await request(app).get('/api/wallet/comision').set('Authorization', `Bearer ${token}`)).body.comisionPct).toBe(3);
    await fijar(await admin(), 1.5);
    expect((await request(app).get('/api/wallet/comision').set('Authorization', `Bearer ${token}`)).body.comisionPct).toBe(1.5);
  });

  describe('se aplica en las operaciones', () => {
    it('enviar dinero: el emisor paga monto + la comisión vigente, y se registra con esa cifra', async () => {
      await fijar(await admin(), 2.5);
      const emisor = await crearUsuarioDePrueba({ saldo: 100000 });
      const receptor = await crearUsuarioDePrueba({ saldo: 0 });
      const res = await request(app).post('/api/wallet/enviar').set('Authorization', `Bearer ${tokenPara(emisor)}`).send({ destino: receptor.cedula, monto: 40000 });
      expect(res.status).toBe(200);

      const saldo = async (id: string) => Number((await prisma.wallet.findUnique({ where: { userId: id } }))!.saldo);
      expect(await saldo(emisor.id)).toBe(100000 - 40000 - 1000); // 2,5% de 40.000 = 1.000
      expect(await saldo(receptor.id)).toBe(40000);
      const tx = await prisma.transaction.findFirstOrThrow({ where: { userId: emisor.id, categoria: 'envio' } });
      expect(Number(tx.comisionPct)).toBe(2.5);
      expect(Number(tx.comisionValor)).toBe(1000);
    });

    it('con comisión 0% el envío no cobra nada extra', async () => {
      await fijar(await admin(), 0);
      const emisor = await crearUsuarioDePrueba({ saldo: 50000 });
      const receptor = await crearUsuarioDePrueba({ saldo: 0 });
      await request(app).post('/api/wallet/enviar').set('Authorization', `Bearer ${tokenPara(emisor)}`).send({ destino: receptor.cedula, monto: 20000 });
      expect(Number((await prisma.wallet.findUnique({ where: { userId: emisor.id } }))!.saldo)).toBe(30000);
    });

    it('consignar con tarjeta: Kushki cobra monto + la comisión vigente y la billetera recibe el monto', async () => {
      await fijar(await admin(), 5);
      const user = await crearUsuarioDePrueba({ saldo: 0 });
      (chargeCardToken as jest.Mock).mockResolvedValue({ ticketNumber: 'tk-1', transactionReference: 'ref-1' });
      const res = await request(app).post('/api/kushki/consignar/tarjeta').set('Authorization', `Bearer ${tokenPara(user)}`).send({ token: 'tok_de_prueba_1234567890', monto: 20000 });
      expect(res.status).toBe(200);
      expect(chargeCardToken).toHaveBeenCalledWith('tok_de_prueba_1234567890', 21000); // 20.000 + 5%
      const tx = await prisma.transaction.findFirstOrThrow({ where: { userId: user.id } });
      expect(Number(tx.comisionPct)).toBe(5);
      expect(Number(tx.montoNeto)).toBe(20000);
    });

    it('PSE: el pago guarda la comisión con la que se cobró; si el administrador la cambia antes de acreditar, se registra la original', async () => {
      const token = await admin();
      await fijar(token, 5);
      const user = await crearUsuarioDePrueba({ saldo: 0 });
      (initTransfer as jest.Mock).mockResolvedValue({ redirectUrl: 'https://banco.test/pagar', transactionReference: 'tr-1' });
      const res = await request(app).post('/api/kushki/consignar/pse/iniciar').set('Authorization', `Bearer ${tokenPara(user)}`)
        .send({ token: 'tok_pse_comision_1234', monto: 20000, documentType: 'CC', documentNumber: '1023456789', email: 'a@b.co', nombreCompleto: 'Marta Gómez' });
      expect(res.status).toBe(200);
      expect(initTransfer).toHaveBeenCalledWith('tok_pse_comision_1234', 21000, expect.anything()); // 20.000 + 5%
      const pago = await prisma.kushkiPayment.findFirstOrThrow({ where: { reference: 'tok_pse_comision_1234' } });
      expect(Number(pago.comisionPct)).toBe(5);

      // el administrador baja la comisión mientras el cliente paga en el banco
      await fijar(token, 1);
      (getTransferStatus as jest.Mock).mockResolvedValue({ estado: 'aprobada', ticketNumber: 'tk-pse-1' });
      await resolverPagoPse(pago);

      const tx = await prisma.transaction.findFirstOrThrow({ where: { userId: user.id, categoria: 'consigna' } });
      expect(Number(tx.comisionPct)).toBe(5);   // la que se le cobró, no la nueva
      expect(Number(tx.comisionValor)).toBe(1000);
      expect(Number(tx.montoNeto)).toBe(20000);
    });

    it('los pagos que ya existían antes de este cambio se registran con el 3% con el que se cobraron', async () => {
      const user = await crearUsuarioDePrueba({ saldo: 0 });
      const pago = await prisma.kushkiPayment.create({ data: { userId: user.id, reference: 'tok_viejo_1234567890', metodo: 'pse', monto: 10000 } });
      expect(Number(pago.comisionPct)).toBe(3);
      (getTransferStatus as jest.Mock).mockResolvedValue({ estado: 'aprobada', ticketNumber: 'tk-viejo' });
      await resolverPagoPse(pago);
      const tx = await prisma.transaction.findFirstOrThrow({ where: { userId: user.id } });
      expect(Number(tx.comisionValor)).toBe(300);
    });
  });
});
