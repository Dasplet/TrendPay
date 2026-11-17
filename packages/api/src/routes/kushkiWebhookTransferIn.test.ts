import { createHmac } from 'node:crypto';
import request from 'supertest';
import app, { prisma } from '../index';
import { limpiarBaseDeDatos, crearUsuarioDePrueba } from '../tests/testUtils';

jest.mock('../utils/kushki', () => {
  const actual = jest.requireActual('../utils/kushki');
  return { ...actual, getTransferStatus: jest.fn() };
});
import { getTransferStatus } from '../utils/kushki';

const SECRETO = 'secreto-de-prueba';
const hmac = (datos: string) => createHmac('sha256', SECRETO).update(datos).digest('hex');

function enviarAviso(cuerpo: object, opts: { firmar?: boolean } = {}) {
  const texto = JSON.stringify(cuerpo);
  const id = '1792700000';
  const req = request(app).post('/api/kushki/webhooks/transfer-in').set('Content-Type', 'application/json').set('X-Kushki-Id', id);
  if (opts.firmar !== false) req.set('X-Kushki-Signature', hmac(`${texto}.${id}`));
  return req.send(texto);
}

describe('Webhook de Kushki para consignaciones (Bre-B / PSE)', () => {
  beforeAll(() => { process.env.KUSHKI_WEBHOOK_SECRET = SECRETO; });
  afterAll(async () => {
    delete process.env.KUSHKI_WEBHOOK_SECRET;
    await limpiarBaseDeDatos();
    await prisma.$disconnect();
  });
  beforeEach(async () => {
    await limpiarBaseDeDatos();
    jest.clearAllMocks();
  });

  const crearPago = (userId: string, reference: string, metodo = 'breb') =>
    prisma.kushkiPayment.create({ data: { userId, reference, metodo, monto: 20000, estado: 'pendiente' } });
  const saldoDe = async (userId: string) => Number((await prisma.wallet.findUnique({ where: { userId } }))!.saldo);

  it('rechaza un aviso sin firma o con firma falsa y no consulta ni acredita nada', async () => {
    const user = await crearUsuarioDePrueba({ saldo: 0 });
    await crearPago(user.id, 'tok_wh_breb_0001');

    expect((await enviarAviso({ token: 'tok_wh_breb_0001' }, { firmar: false })).status).toBe(401);
    const falsa = await request(app).post('/api/kushki/webhooks/transfer-in').set('Content-Type', 'application/json')
      .set('X-Kushki-Id', '1792700000').set('X-Kushki-Signature', hmac('otro cuerpo')).send(JSON.stringify({ token: 'tok_wh_breb_0001' }));
    expect(falsa.status).toBe(401);
    expect(getTransferStatus).not.toHaveBeenCalled();
    expect(await saldoDe(user.id)).toBe(0);
  });

  it('responde 503 si no hay secreto configurado para que Kushki reintente', async () => {
    delete process.env.KUSHKI_WEBHOOK_SECRET;
    try {
      expect((await enviarAviso({ token: 'tok_wh_breb_0001' })).status).toBe(503);
    } finally {
      process.env.KUSHKI_WEBHOOK_SECRET = SECRETO;
    }
  });

  it('con firma válida confirma el estado con Kushki y acredita una sola vez', async () => {
    const user = await crearUsuarioDePrueba({ saldo: 0 });
    await crearPago(user.id, 'tok_wh_breb_0002');
    (getTransferStatus as jest.Mock).mockResolvedValue({ estado: 'aprobada', ticketNumber: 'WH-T1' });

    const res = await enviarAviso({ token: 'tok_wh_breb_0002', status: 'approvedTransaction' });
    expect(res.status).toBe(200);
    expect(await saldoDe(user.id)).toBe(20000);
    expect((await prisma.kushkiPayment.findUnique({ where: { reference: 'tok_wh_breb_0002' } }))!.estado).toBe('completado');

    const repetido = await enviarAviso({ token: 'tok_wh_breb_0002', status: 'approvedTransaction' });
    expect(repetido.status).toBe(200);
    expect(await saldoDe(user.id)).toBe(20000);
    expect(getTransferStatus).toHaveBeenCalledTimes(1);
  });

  it('el aviso no decide el resultado: si Kushki dice que sigue pendiente, no acredita', async () => {
    const user = await crearUsuarioDePrueba({ saldo: 0 });
    await crearPago(user.id, 'tok_wh_breb_0003');
    (getTransferStatus as jest.Mock).mockResolvedValue({ estado: 'pendiente' });

    const res = await enviarAviso({ token: 'tok_wh_breb_0003', status: 'approvedTransaction' });
    expect(res.status).toBe(200);
    expect(await saldoDe(user.id)).toBe(0);
    expect((await prisma.kushkiPayment.findUnique({ where: { reference: 'tok_wh_breb_0003' } }))!.estado).toBe('pendiente');
  });

  it('encuentra el pago también por el ticketNumber y cierra los rechazados', async () => {
    const user = await crearUsuarioDePrueba({ saldo: 0 });
    const pago = await crearPago(user.id, 'tok_wh_pse_0004', 'pse');
    await prisma.kushkiPayment.update({ where: { id: pago.id }, data: { ticketNumber: 'TK-777777' } });
    (getTransferStatus as jest.Mock).mockResolvedValue({ estado: 'rechazada' });

    const res = await enviarAviso({ ticketNumber: 'TK-777777' });
    expect(res.status).toBe(200);
    expect((await prisma.kushkiPayment.findUnique({ where: { id: pago.id } }))!.estado).toBe('rechazado');
    expect(await saldoDe(user.id)).toBe(0);
  });

  it('un aviso firmado que no corresponde a ningún pago responde 200 (validación de Kushki) sin consultar', async () => {
    const res = await enviarAviso({ token: 'tok_que_no_existe_1', status: 'approvedTransaction' });
    expect(res.status).toBe(200);
    expect(getTransferStatus).not.toHaveBeenCalled();

    const sinDatos = await enviarAviso({ evento: 'prueba' });
    expect(sinDatos.status).toBe(200);
  });

  it('si Kushki no responde al confirmar, devuelve 500 para que reintente', async () => {
    const user = await crearUsuarioDePrueba({ saldo: 0 });
    await crearPago(user.id, 'tok_wh_breb_0005');
    (getTransferStatus as jest.Mock).mockRejectedValue(new Error('timeout'));

    expect((await enviarAviso({ token: 'tok_wh_breb_0005' })).status).toBe(500);
    expect(await saldoDe(user.id)).toBe(0);
  });

  it('deja constancia de cada llamada en el registro de webhooks', async () => {
    await enviarAviso({ token: 'tok_que_no_existe_1' });
    await enviarAviso({ token: 'x' }, { firmar: false });
    const logs = await prisma.kushkiWebhookLog.findMany({ orderBy: { createdAt: 'asc' } });
    expect(logs.map((l) => l.estadoHttp)).toEqual([200, 401]);
  });
});
