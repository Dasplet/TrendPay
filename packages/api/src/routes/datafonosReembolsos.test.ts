import request from 'supertest';
import app, { prisma } from '../index';
import { limpiarBaseDeDatos, crearUsuarioDePrueba, crearSubcuentaDePrueba, tokenPara } from '../tests/testUtils';
import { KushkiError } from '../utils/kushki';

jest.mock('../utils/kushkiOne', () => {
  const actual = jest.requireActual('../utils/kushkiOne');
  return { ...actual, enviarCobroAsync: jest.fn(), enviarReembolsoAsync: jest.fn(), buscarTransaccion: jest.fn() };
});
import { enviarCobroAsync, enviarReembolsoAsync, buscarTransaccion } from '../utils/kushkiOne';
import { conciliarReembolsos } from '../utils/datafonos';

const TOKEN_URL = 'codigo-secreto-de-prueba';
const enviar = enviarCobroAsync as jest.Mock;
const reembolsar = enviarReembolsoAsync as jest.Mock;
const buscar = buscarTransaccion as jest.Mock;

const aprobada = (monto: number, extra: object = {}) => ({ estado: 'aprobada', tipo: 'SALE', transactionReference: 'ref-1', ticketNumber: 'tk-1', montoAprobado: monto, ...extra });
const anulada = (monto: number) => ({ estado: 'anulada', tipo: 'VOID', transactionReference: 'ref-void', montoAprobado: monto });

describe('Datáfonos: visibilidad por tienda y reembolsos', () => {
  beforeAll(() => {
    process.env.KUSHKI_ONE_BUSINESS_CODE = 'business-code-de-prueba';
    process.env.KUSHKI_ONE_WEBHOOK_TOKEN = TOKEN_URL;
    process.env.KUSHKI_ONE_WEBHOOK_URL = 'https://api.trendpay.test';
  });
  afterAll(async () => {
    delete process.env.KUSHKI_ONE_BUSINESS_CODE;
    delete process.env.KUSHKI_ONE_WEBHOOK_TOKEN;
    delete process.env.KUSHKI_ONE_WEBHOOK_URL;
    await limpiarBaseDeDatos();
    await prisma.config.deleteMany({ where: { clave: 'comision_datafono_pct' } });
    await prisma.$disconnect();
  });
  beforeEach(async () => {
    await limpiarBaseDeDatos();
    await prisma.config.deleteMany({ where: { clave: 'comision_datafono_pct' } });
    jest.resetAllMocks();
    enviar.mockResolvedValue(undefined);
    reembolsar.mockResolvedValue(undefined);
  });

  const saldoDe = async (userId: string) => Number((await prisma.wallet.findUnique({ where: { userId } }))!.saldo);
  const cobrar = (token: string, terminalId: string, monto: number) =>
    request(app).post('/api/datafonos/cobros').set('Authorization', `Bearer ${token}`).send({ terminalId, monto });
  const aviso = (cuerpo: object) => request(app).post(`/api/datafonos/webhooks/${TOKEN_URL}`).send(cuerpo);
  const pedirReembolso = (token: string, id: string) => request(app).post(`/api/datafonos/cobros/${id}/reembolsar`).set('Authorization', `Bearer ${token}`);
  const historial = async (token: string) =>
    (await request(app).get('/api/wallet/history').set('Authorization', `Bearer ${token}`)).body.transacciones as { categoria: string; descripcion: string }[];
  const delTipo = <T extends { categoria: string }>(lista: T[], categoria: string) => lista.filter((t) => t.categoria === categoria);

  // Una empresa con dos tiendas, cada una con su datáfono
  async function dosTiendas(comisionPct = 0) {
    const empresa = await crearUsuarioDePrueba({ saldo: 0, nombre: 'Cool Company' });
    const sanJuan = await crearSubcuentaDePrueba(empresa.id, {});
    const norte = await crearSubcuentaDePrueba(empresa.id, {});
    const tSanJuan = await prisma.terminalKushki.create({ data: { serial: 'SN-VIS-0001', alias: 'Caja San Juan', titularId: empresa.id, sedeId: sanJuan.id } });
    const tNorte = await prisma.terminalKushki.create({ data: { serial: 'SN-VIS-0002', alias: 'Caja Norte', titularId: empresa.id, sedeId: norte.id } });
    if (comisionPct) await prisma.config.upsert({ where: { clave: 'comision_datafono_pct' }, create: { clave: 'comision_datafono_pct', valor: String(comisionPct) }, update: { valor: String(comisionPct) } });
    return { empresa, sanJuan, norte, tSanJuan, tNorte, tokenEmpresa: tokenPara(empresa), tokenSanJuan: tokenPara(sanJuan), tokenNorte: tokenPara(norte) };
  }

  // Cobra y deja el cobro aprobado y acreditado (con más de un minuto, para poder reembolsarlo)
  async function cobroAprobado(token: string, terminalId: string, monto: number, ref = 'ref-1', ticket = 'tk-1') {
    await cobrar(token, terminalId, monto);
    const cobro = await prisma.cobroDatafono.findFirstOrThrow({ where: { terminalId }, orderBy: { createdAt: 'desc' } });
    buscar.mockResolvedValue(aprobada(monto, { transactionReference: ref, ticketNumber: ticket }));
    await aviso({ event_id: `ev-ok-${cobro.id}`, status: 'APPROVAL', client_transaction_id: cobro.clientTransactionId, terminal: { serial_number: (await prisma.terminalKushki.findUniqueOrThrow({ where: { id: terminalId } })).serial } });
    await prisma.cobroDatafono.update({ where: { id: cobro.id }, data: { createdAt: new Date(Date.now() - 5 * 60_000) } });
    return prisma.cobroDatafono.findUniqueOrThrow({ where: { id: cobro.id } });
  }

  describe('visibilidad', () => {
    it('cada cobro aparece en la tienda a la que pertenece y en la cuenta principal; las otras tiendas no lo ven', async () => {
      const e = await dosTiendas();
      await cobroAprobado(e.tokenSanJuan, e.tSanJuan.id, 50000, 'ref-sj', 'tk-sj');
      await cobroAprobado(e.tokenNorte, e.tNorte.id, 20000, 'ref-n', 'tk-n');
      // un movimiento común de la billetera compartida (no es de datáfono)
      const wallet = await prisma.wallet.findUniqueOrThrow({ where: { userId: e.empresa.id } });
      await prisma.transaction.create({ data: { walletId: wallet.id, userId: e.empresa.id, codigo: 'DEP-COMUN', categoria: 'consigna', descripcion: 'Consignación PSE', montoBruto: 1000, montoNeto: 1000, saldoAntes: 0, saldoDespues: 1000 } });

      const principal = await historial(e.tokenEmpresa);
      expect(delTipo(principal, 'datafono')).toHaveLength(2);
      expect(delTipo(principal, 'consigna')).toHaveLength(1);

      const sanJuan = await historial(e.tokenSanJuan);
      expect(delTipo(sanJuan, 'datafono').map((t) => t.descripcion)).toEqual(['Cobro con datáfono · Caja San Juan']);
      expect(delTipo(sanJuan, 'consigna')).toHaveLength(1); // lo demás de la billetera compartida no cambia

      const norte = await historial(e.tokenNorte);
      expect(delTipo(norte, 'datafono').map((t) => t.descripcion)).toEqual(['Cobro con datáfono · Caja Norte']);
    });

    it('un datáfono sin tienda queda en la sede que cobró; si cobra la cuenta principal solo lo ve la principal', async () => {
      const e = await dosTiendas();
      const libre = await prisma.terminalKushki.create({ data: { serial: 'SN-VIS-0003', alias: 'Caja libre', titularId: e.empresa.id, sedeId: null } });
      await cobroAprobado(e.tokenNorte, libre.id, 10000, 'ref-a', 'tk-a');
      await cobroAprobado(e.tokenEmpresa, libre.id, 30000, 'ref-b', 'tk-b');

      const sedes = (await prisma.transaction.findMany({ where: { categoria: 'datafono' }, orderBy: { montoBruto: 'asc' } })).map((t) => t.sedeId);
      expect(sedes).toEqual([e.norte.id, null]);
      expect(delTipo(await historial(e.tokenNorte), 'datafono')).toHaveLength(1);
      expect(delTipo(await historial(e.tokenSanJuan), 'datafono')).toHaveLength(0);
      expect(delTipo(await historial(e.tokenEmpresa), 'datafono')).toHaveLength(2);
    });
  });

  describe('reembolsos', () => {
    it('descuenta de la billetera lo que se acreditó, solo cuando Kushki lo confirma, y aparece en la tienda y en la principal', async () => {
      const e = await dosTiendas();
      const cobro = await cobroAprobado(e.tokenSanJuan, e.tSanJuan.id, 50000, 'ref-sj');
      const otro = await cobroAprobado(e.tokenNorte, e.tNorte.id, 20000, 'ref-n', 'tk-n');
      expect(await saldoDe(e.empresa.id)).toBe(70000);

      const res = await pedirReembolso(e.tokenEmpresa, cobro.id);
      expect(res.status).toBe(202);
      expect(reembolsar).toHaveBeenCalledTimes(1);
      const [serial, orden] = reembolsar.mock.calls[0];
      expect(serial).toBe('SN-VIS-0001');
      expect(orden).toMatchObject({ transactionReference: 'ref-sj', eventsWebhookUrl: `https://api.trendpay.test/api/datafonos/webhooks/${TOKEN_URL}` });
      expect(await prisma.cobroDatafono.findUniqueOrThrow({ where: { id: cobro.id } })).toMatchObject({ estado: 'reembolsando', reembolsoClientId: orden.clientTransactionId });
      expect(await saldoDe(e.empresa.id)).toBe(70000); // todavía no: falta la confirmación de Kushki

      // Kushki confirma la anulación
      buscar.mockResolvedValue(anulada(50000));
      const evt = { event_id: 'ev-void-1', status: 'APPROVAL', client_transaction_id: orden.clientTransactionId, terminal: { serial_number: 'SN-VIS-0001' } };
      expect((await aviso(evt)).status).toBe(200);
      expect(buscar).toHaveBeenLastCalledWith('SN-VIS-0001', orden.clientTransactionId);
      expect(await saldoDe(e.empresa.id)).toBe(20000);
      expect((await prisma.cobroDatafono.findUniqueOrThrow({ where: { id: cobro.id } })).estado).toBe('reembolsado');

      const tx = await prisma.transaction.findFirstOrThrow({ where: { categoria: 'reembolso_datafono' } });
      expect(tx).toMatchObject({ sedeId: e.sanJuan.id, status: 'exitosa' });
      expect(Number(tx.montoNeto)).toBe(-50000);
      expect([Number(tx.saldoAntes), Number(tx.saldoDespues)]).toEqual([70000, 20000]);

      // el mismo aviso otra vez (o uno nuevo de la misma anulación) no descuenta dos veces
      await aviso(evt);
      await aviso({ ...evt, event_id: 'ev-void-2' });
      expect(await saldoDe(e.empresa.id)).toBe(20000);

      // la tienda y la principal lo ven; la otra tienda no; el otro cobro no cambia
      expect(delTipo(await historial(e.tokenSanJuan), 'reembolso_datafono')).toHaveLength(1);
      expect(delTipo(await historial(e.tokenEmpresa), 'reembolso_datafono')).toHaveLength(1);
      expect(delTipo(await historial(e.tokenNorte), 'reembolso_datafono')).toHaveLength(0);
      expect((await prisma.cobroDatafono.findUniqueOrThrow({ where: { id: otro.id } })).estado).toBe('aprobado');
      expect(await prisma.notification.count({ where: { userId: e.empresa.id, titulo: 'Reembolso de un cobro con datáfono' } })).toBe(1);
    });

    it('con comisión se devuelve solo el neto que se había acreditado', async () => {
      const e = await dosTiendas(2.5);
      const cobro = await cobroAprobado(e.tokenSanJuan, e.tSanJuan.id, 40000);
      expect(await saldoDe(e.empresa.id)).toBe(39000);

      await pedirReembolso(e.tokenEmpresa, cobro.id);
      const id = (await prisma.cobroDatafono.findUniqueOrThrow({ where: { id: cobro.id } })).reembolsoClientId!;
      buscar.mockResolvedValue(anulada(40000));
      await aviso({ event_id: 'ev-c', status: 'APPROVAL', client_transaction_id: id, terminal: { serial_number: 'SN-VIS-0001' } });
      expect(await saldoDe(e.empresa.id)).toBe(0);
    });

    it('el aviso solo no decide: sin confirmación de Kushki no se descuenta nada', async () => {
      const e = await dosTiendas();
      const cobro = await cobroAprobado(e.tokenSanJuan, e.tSanJuan.id, 50000);
      await pedirReembolso(e.tokenEmpresa, cobro.id);
      const id = (await prisma.cobroDatafono.findUniqueOrThrow({ where: { id: cobro.id } })).reembolsoClientId!;
      buscar.mockResolvedValue(null);
      expect((await aviso({ event_id: 'ev-n', status: 'APPROVAL', client_transaction_id: id, terminal: { serial_number: 'SN-VIS-0001' } })).status).toBe(200);
      expect(await saldoDe(e.empresa.id)).toBe(50000);
      expect((await prisma.cobroDatafono.findUniqueOrThrow({ where: { id: cobro.id } })).estado).toBe('reembolsando');
    });

    it('si Kushki rechaza o cancela el reembolso, el cobro sigue aprobado y el saldo no cambia', async () => {
      const e = await dosTiendas();
      const cobro = await cobroAprobado(e.tokenSanJuan, e.tSanJuan.id, 50000);
      await pedirReembolso(e.tokenEmpresa, cobro.id);
      const id = (await prisma.cobroDatafono.findUniqueOrThrow({ where: { id: cobro.id } })).reembolsoClientId!;
      await aviso({ event_id: 'ev-r', status: 'DECLINED', client_transaction_id: id, terminal: { serial_number: 'SN-VIS-0001' }, failure_reason: { message: 'Anulación no permitida' } });
      expect(await prisma.cobroDatafono.findUniqueOrThrow({ where: { id: cobro.id } })).toMatchObject({ estado: 'aprobado', detalle: 'Anulación no permitida', reembolsoClientId: null });
      expect(await saldoDe(e.empresa.id)).toBe(50000);
      expect((await pedirReembolso(e.tokenEmpresa, cobro.id)).status).toBe(202); // se puede intentar de nuevo
    });

    it('si no se puede enviar la orden a Kushki, el cobro sigue aprobado', async () => {
      const e = await dosTiendas();
      const cobro = await cobroAprobado(e.tokenSanJuan, e.tSanJuan.id, 50000);
      reembolsar.mockRejectedValueOnce(new KushkiError('Terminal sin conexión', 502));
      expect((await pedirReembolso(e.tokenEmpresa, cobro.id)).status).toBe(502);
      expect(await prisma.cobroDatafono.findUniqueOrThrow({ where: { id: cobro.id } })).toMatchObject({ estado: 'aprobado', reembolsoClientId: null });
      expect(await saldoDe(e.empresa.id)).toBe(50000);
    });

    it('restricciones: solo la cuenta principal, solo cobros aprobados, una vez, con saldo y pasado un minuto', async () => {
      const e = await dosTiendas();
      const cobro = await cobroAprobado(e.tokenSanJuan, e.tSanJuan.id, 50000);

      expect((await pedirReembolso(e.tokenSanJuan, cobro.id)).status).toBe(403); // una sede no reembolsa
      const ajena = await crearUsuarioDePrueba({ saldo: 0 });
      expect((await pedirReembolso(tokenPara(ajena), cobro.id)).status).toBe(404);

      // sin saldo suficiente (ya retiraron el dinero)
      await prisma.wallet.update({ where: { userId: e.empresa.id }, data: { saldo: 10000 } });
      expect((await pedirReembolso(e.tokenEmpresa, cobro.id)).status).toBe(409);
      expect(reembolsar).not.toHaveBeenCalled();
      await prisma.wallet.update({ where: { userId: e.empresa.id }, data: { saldo: 50000 } });

      // demasiado pronto
      await prisma.cobroDatafono.update({ where: { id: cobro.id }, data: { createdAt: new Date() } });
      expect((await pedirReembolso(e.tokenEmpresa, cobro.id)).status).toBe(409);
      await prisma.cobroDatafono.update({ where: { id: cobro.id }, data: { createdAt: new Date(Date.now() - 5 * 60_000) } });

      // dos clics seguidos mandan una sola anulación
      expect((await pedirReembolso(e.tokenEmpresa, cobro.id)).status).toBe(202);
      expect((await pedirReembolso(e.tokenEmpresa, cobro.id)).status).toBe(409);
      expect(reembolsar).toHaveBeenCalledTimes(1);

      // un cobro que no está aprobado no se reembolsa
      const pendiente = await prisma.cobroDatafono.create({ data: { terminalId: e.tNorte.id, userId: e.norte.id, clientTransactionId: crypto.randomUUID(), monto: 5000 } });
      expect((await pedirReembolso(e.tokenEmpresa, pendiente.id)).status).toBe(409);
    });

    it('la conciliación aplica los reembolsos que Kushki ya confirmó y detecta anulaciones hechas por fuera de TrendPay', async () => {
      const e = await dosTiendas();
      const enCurso = await cobroAprobado(e.tokenSanJuan, e.tSanJuan.id, 50000, 'ref-1', 'tk-1');
      const externo = await cobroAprobado(e.tokenNorte, e.tNorte.id, 20000, 'ref-2', 'tk-2');
      await pedirReembolso(e.tokenEmpresa, enCurso.id);
      const idReembolso = (await prisma.cobroDatafono.findUniqueOrThrow({ where: { id: enCurso.id } })).reembolsoClientId!;
      expect(await saldoDe(e.empresa.id)).toBe(70000);

      // sin buscar anulaciones externas: solo se resuelve el reembolso que se pidió
      buscar.mockImplementation(async (_serial: string, clientId: string) => (clientId === idReembolso ? anulada(50000) : aprobada(20000)));
      expect(await conciliarReembolsos()).toBe(1);
      expect(await saldoDe(e.empresa.id)).toBe(20000);
      expect((await prisma.cobroDatafono.findUniqueOrThrow({ where: { id: externo.id } })).estado).toBe('aprobado');

      // la revisión de anulaciones externas: el cobro del Norte fue anulado directamente en Kushki
      buscar.mockImplementation(async (_serial: string, clientId: string) => (clientId === externo.clientTransactionId ? anulada(20000) : aprobada(50000)));
      expect(await conciliarReembolsos({ incluirExternos: true })).toBe(1);
      expect(await saldoDe(e.empresa.id)).toBe(0);
      expect((await prisma.cobroDatafono.findUniqueOrThrow({ where: { id: externo.id } })).estado).toBe('reembolsado');
      expect(await conciliarReembolsos({ incluirExternos: true })).toBe(0); // ya aplicado: no se descuenta dos veces
    });

    it('el resumen de ventas no cuenta los cobros reembolsados', async () => {
      const e = await dosTiendas();
      const cobro = await cobroAprobado(e.tokenSanJuan, e.tSanJuan.id, 50000);
      await cobroAprobado(e.tokenNorte, e.tNorte.id, 20000, 'ref-2', 'tk-2');
      await pedirReembolso(e.tokenEmpresa, cobro.id);
      const id = (await prisma.cobroDatafono.findUniqueOrThrow({ where: { id: cobro.id } })).reembolsoClientId!;
      buscar.mockResolvedValue(anulada(50000));
      await aviso({ event_id: 'ev-x', status: 'APPROVAL', client_transaction_id: id, terminal: { serial_number: 'SN-VIS-0001' } });

      const res = await request(app).get('/api/datafonos/resumen?periodo=mes').set('Authorization', `Bearer ${e.tokenEmpresa}`);
      expect(res.body.total).toMatchObject({ cobros: 1, bruto: 20000 });
    });
  });
});
