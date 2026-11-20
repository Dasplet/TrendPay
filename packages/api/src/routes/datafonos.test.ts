import request from 'supertest';
import app, { prisma } from '../index';
import { limpiarBaseDeDatos, crearUsuarioDePrueba, crearSubcuentaDePrueba, tokenPara } from '../tests/testUtils';
import { KushkiError } from '../utils/kushki';

jest.mock('../utils/kushkiOne', () => {
  const actual = jest.requireActual('../utils/kushkiOne');
  return { ...actual, enviarCobroAsync: jest.fn(), buscarTransaccion: jest.fn() };
});
import { enviarCobroAsync, buscarTransaccion } from '../utils/kushkiOne';
import { conciliarCobrosDatafono } from '../utils/datafonos';

const TOKEN_URL = 'codigo-secreto-de-prueba';
const SERIAL = 'TJ54241P20911';
const enviar = enviarCobroAsync as jest.Mock;
const buscar = buscarTransaccion as jest.Mock;

const aprobada = (monto: number, extra: object = {}) => ({ estado: 'aprobada', tipo: 'SALE', transactionReference: 'ref-1', ticketNumber: 'tk-1', montoAprobado: monto, ...extra });

describe('Cobros con datáfono (Kushki One)', () => {
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
    await prisma.config.deleteMany({ where: { clave: 'comision_datafono_pct' } }); // la comisión es global: cada prueba parte de 0%
    jest.resetAllMocks();
    enviar.mockResolvedValue(undefined);
  });

  async function escenario() {
    const empresa = await crearUsuarioDePrueba({ saldo: 0, nombre: 'Cool Company' });
    const sede = await crearSubcuentaDePrueba(empresa.id, { permisoVerSaldo: false, permisoRecargar: true, permisoEnviar: false, permisoRetirar: false });
    const terminal = await prisma.terminalKushki.create({ data: { serial: SERIAL, alias: 'Caja 1', titularId: empresa.id, sedeId: sede.id } });
    return { empresa, sede, terminal, tokenSede: tokenPara(sede), tokenEmpresa: tokenPara(empresa) };
  }
  const saldoDe = async (userId: string) => Number((await prisma.wallet.findUnique({ where: { userId } }))!.saldo);
  const cobrar = (token: string, terminalId: string, monto: number) =>
    request(app).post('/api/datafonos/cobros').set('Authorization', `Bearer ${token}`).send({ terminalId, monto });
  const aviso = (cuerpo: object, codigo = TOKEN_URL) => request(app).post(`/api/datafonos/webhooks/${codigo}`).send(cuerpo);
  const evento = (cobro: { clientTransactionId: string }, status: string, extra: object = {}, eventId = `ev-${Math.random()}`) =>
    ({ event_id: eventId, status, client_transaction_id: cobro.clientTransactionId, terminal: { serial_number: SERIAL, brand: 'SUNMI' }, ...extra });

  describe('iniciar un cobro', () => {
    it('la sede cobra: envía la orden al terminal con el webhook y deja el cobro pendiente sin tocar el saldo', async () => {
      const { empresa, terminal, tokenSede } = await escenario();
      const res = await cobrar(tokenSede, terminal.id, 50000);
      expect(res.status).toBe(201);
      expect(res.body.cobro).toMatchObject({ estado: 'pendiente', monto: 50000, terminal: 'Caja 1' });

      expect(enviar).toHaveBeenCalledTimes(1);
      const [serial, orden] = enviar.mock.calls[0];
      expect(serial).toBe(SERIAL);
      expect(orden).toMatchObject({ monto: 50000, eventsWebhookUrl: `https://api.trendpay.test/api/datafonos/webhooks/${TOKEN_URL}` });
      expect(orden.clientTransactionId).toMatch(/^[0-9a-f-]{36}$/);
      expect(await saldoDe(empresa.id)).toBe(0);
    });

    it('valida el monto: entero y dentro del rango', async () => {
      const { terminal, tokenSede } = await escenario();
      for (const monto of [500, 12.5, -3, 60_000_000]) {
        expect((await cobrar(tokenSede, terminal.id, monto)).status).toBe(400);
      }
      expect(enviar).not.toHaveBeenCalled();
    });

    it('un terminal con un cobro en curso rechaza otro', async () => {
      const { terminal, tokenSede } = await escenario();
      expect((await cobrar(tokenSede, terminal.id, 10000)).status).toBe(201);
      const segundo = await cobrar(tokenSede, terminal.id, 20000);
      expect(segundo.status).toBe(409);
      expect(enviar).toHaveBeenCalledTimes(1);
    });

    it('si Kushki no entrega la orden al terminal, responde error y el terminal queda libre', async () => {
      const { terminal, tokenSede } = await escenario();
      enviar.mockRejectedValueOnce(new KushkiError('Terminal ocupado', 409, { codigo: 'TERM-001' }));
      const res = await cobrar(tokenSede, terminal.id, 10000);
      expect(res.status).toBe(409);
      expect((await prisma.cobroDatafono.findFirst())!.estado).toBe('error');
      expect((await cobrar(tokenSede, terminal.id, 10000)).status).toBe(201);
    });

    it('una sede solo usa sus datáfonos; la empresa usa todos; otra empresa no ve los ajenos', async () => {
      const { empresa, terminal, tokenEmpresa } = await escenario();
      const otraSede = await crearSubcuentaDePrueba(empresa.id, { permisoRecargar: true });
      const ajeno = await crearUsuarioDePrueba({ saldo: 0 });
      expect((await cobrar(tokenPara(otraSede), terminal.id, 10000)).status).toBe(404);
      expect((await cobrar(tokenPara(ajeno), terminal.id, 10000)).status).toBe(404);
      expect((await cobrar(tokenEmpresa, terminal.id, 10000)).status).toBe(201);

      const lista = await request(app).get('/api/datafonos/terminales').set('Authorization', `Bearer ${tokenPara(otraSede)}`);
      expect(lista.body.terminales).toEqual([]);
    });

    it('una sede sin permiso de recargar no puede cobrar', async () => {
      const { empresa, terminal } = await escenario();
      const sinPermiso = await crearSubcuentaDePrueba(empresa.id, { permisoRecargar: false });
      await prisma.terminalKushki.update({ where: { id: terminal.id }, data: { sedeId: null } });
      expect((await cobrar(tokenPara(sinPermiso), terminal.id, 10000)).status).toBe(403);
    });

    it('sin configuración de Kushki One responde 503 y no crea nada', async () => {
      const { terminal, tokenSede } = await escenario();
      delete process.env.KUSHKI_ONE_BUSINESS_CODE;
      try {
        expect((await cobrar(tokenSede, terminal.id, 10000)).status).toBe(503);
        expect(await prisma.cobroDatafono.count()).toBe(0);
      } finally {
        process.env.KUSHKI_ONE_BUSINESS_CODE = 'business-code-de-prueba';
      }
    });
  });

  describe('aviso (webhook) de Kushki', () => {
    async function cobroPendiente(monto = 50000) {
      const e = await escenario();
      await cobrar(e.tokenSede, e.terminal.id, monto);
      const cobro = (await prisma.cobroDatafono.findFirst())!;
      return { ...e, cobro };
    }

    it('la aprobación confirmada por Kushki acredita el monto en la billetera de la empresa, una sola vez', async () => {
      const { empresa, sede, cobro } = await cobroPendiente(50000);
      buscar.mockResolvedValue(aprobada(50000));

      const res = await aviso(evento(cobro, 'APPROVAL', {}, 'ev-1'));
      expect(res.status).toBe(200);
      expect(buscar).toHaveBeenCalledWith(SERIAL, cobro.clientTransactionId);
      expect(await saldoDe(empresa.id)).toBe(50000);

      const tx = await prisma.transaction.findFirst({ where: { categoria: 'datafono' } });
      expect(tx).toMatchObject({ userId: sede.id, status: 'exitosa' });
      expect(Number(tx!.montoNeto)).toBe(50000);
      expect(Number(tx!.saldoDespues)).toBe(50000);
      expect((await prisma.cobroDatafono.findUnique({ where: { id: cobro.id } }))).toMatchObject({ estado: 'aprobado', ticketNumber: 'tk-1', transactionReference: 'ref-1' });

      // el mismo aviso repetido, y otro aviso de aprobación con otro id: no vuelven a acreditar
      await aviso(evento(cobro, 'APPROVAL', {}, 'ev-1'));
      await aviso(evento(cobro, 'APPROVAL', {}, 'ev-2'));
      expect(await saldoDe(empresa.id)).toBe(50000);
      expect(await prisma.transaction.count({ where: { categoria: 'datafono' } })).toBe(1);
    });

    it('aplica la comisión configurada y acredita el neto', async () => {
      const admin = await crearUsuarioDePrueba({ rol: 'admin' });
      const cambio = await request(app).put('/api/datafonos/admin/config').set('Authorization', `Bearer ${tokenPara(admin)}`).send({ comisionPct: 2.5 });
      expect(cambio.status).toBe(200);

      const { empresa, cobro } = await cobroPendiente(40000);
      buscar.mockResolvedValue(aprobada(40000));
      await aviso(evento(cobro, 'APPROVAL'));

      expect(await saldoDe(empresa.id)).toBe(39000);
      const tx = await prisma.transaction.findFirst({ where: { categoria: 'datafono' } });
      expect(Number(tx!.comisionValor)).toBe(1000);
      expect(Number(tx!.comisionPct)).toBe(2.5);
      expect(Number(tx!.montoBruto)).toBe(40000);
    });

    it('sin comisión configurada no se descuenta nada', async () => {
      const { empresa, cobro } = await cobroPendiente(30000);
      buscar.mockResolvedValue(aprobada(30000));
      await aviso(evento(cobro, 'APPROVAL'));
      expect(await saldoDe(empresa.id)).toBe(30000);
    });

    it('el aviso solo no decide: si Kushki no confirma la aprobación, no se acredita', async () => {
      const { empresa, cobro } = await cobroPendiente();
      buscar.mockResolvedValue(null);
      expect((await aviso(evento(cobro, 'APPROVAL'))).status).toBe(200);
      expect(await saldoDe(empresa.id)).toBe(0);
      expect((await prisma.cobroDatafono.findUnique({ where: { id: cobro.id } }))!.estado).toBe('pendiente');

      buscar.mockResolvedValue({ estado: 'rechazada', tipo: 'SALE', montoAprobado: 0 });
      await aviso(evento(cobro, 'APPROVAL'));
      expect(await saldoDe(empresa.id)).toBe(0);
      expect((await prisma.cobroDatafono.findUnique({ where: { id: cobro.id } }))!.estado).toBe('rechazado');
    });

    it('si no se puede consultar a Kushki responde 500 (para que reintente) y el reintento sí acredita', async () => {
      const { empresa, cobro } = await cobroPendiente();
      buscar.mockRejectedValueOnce(new KushkiError('timeout', 502));
      const e = evento(cobro, 'APPROVAL', {}, 'ev-reintento');
      expect((await aviso(e)).status).toBe(500);
      expect(await saldoDe(empresa.id)).toBe(0);

      buscar.mockResolvedValue(aprobada(50000));
      expect((await aviso(e)).status).toBe(200);
      expect(await saldoDe(empresa.id)).toBe(50000);
    });

    it('si Kushki aprobó un monto distinto al pedido no acredita y lo deja en revisión', async () => {
      const { empresa, cobro } = await cobroPendiente(50000);
      buscar.mockResolvedValue(aprobada(30000));
      await aviso(evento(cobro, 'APPROVAL'));
      expect(await saldoDe(empresa.id)).toBe(0);
      expect((await prisma.cobroDatafono.findUnique({ where: { id: cobro.id } }))!.estado).toBe('revision');
    });

    it('rechazada o cancelada en el terminal: el cobro se cierra sin saldo', async () => {
      const a = await cobroPendiente();
      await aviso(evento(a.cobro, 'DECLINED', { failure_reason: { code: '51', message: 'Fondos insuficientes' } }));
      expect(await prisma.cobroDatafono.findUnique({ where: { id: a.cobro.id } })).toMatchObject({ estado: 'rechazado', detalle: 'Fondos insuficientes' });
      expect(await saldoDe(a.empresa.id)).toBe(0);

      await limpiarBaseDeDatos();
      const b = await cobroPendiente();
      await aviso(evento(b.cobro, 'TERMINAL_CANCELED'));
      expect((await prisma.cobroDatafono.findUnique({ where: { id: b.cobro.id } }))!.estado).toBe('cancelado');
      expect(buscar).not.toHaveBeenCalled();
    });

    it('los estados intermedios solo actualizan lo que muestra la pantalla', async () => {
      const { cobro } = await cobroPendiente();
      await aviso(evento(cobro, 'CARD_PRESENTED'));
      expect(await prisma.cobroDatafono.findUnique({ where: { id: cobro.id } })).toMatchObject({ estado: 'pendiente', estadoTerminal: 'CARD_PRESENTED' });
    });

    it('un código de URL equivocado se rechaza con 404 sin tocar nada', async () => {
      const { empresa, cobro } = await cobroPendiente();
      buscar.mockResolvedValue(aprobada(50000));
      expect((await aviso(evento(cobro, 'APPROVAL'), 'codigo-falso')).status).toBe(404);
      expect(buscar).not.toHaveBeenCalled();
      expect(await saldoDe(empresa.id)).toBe(0);
    });

    it('ignora avisos de un terminal distinto al del cobro y de cobros que no existen', async () => {
      const { empresa, cobro } = await cobroPendiente();
      buscar.mockResolvedValue(aprobada(50000));
      const otroTerminal = evento(cobro, 'APPROVAL', { terminal: { serial_number: 'OTRO-SERIAL-9' } });
      expect((await aviso(otroTerminal)).status).toBe(200);
      expect((await aviso({ event_id: 'x1', status: 'APPROVAL', client_transaction_id: '00000000-0000-4000-8000-000000000000' })).status).toBe(200);
      expect(buscar).not.toHaveBeenCalled();
      expect(await saldoDe(empresa.id)).toBe(0);
    });

    it('un aviso mal formado se rechaza con 400', async () => {
      await escenario();
      expect((await aviso({ status: 'APPROVAL' })).status).toBe(400);
    });

    it('deja constancia en el registro de avisos del panel, con el prefijo Datáfono', async () => {
      const { cobro } = await cobroPendiente();
      await aviso(evento(cobro, 'CARD_PRESENTED'));
      const log = await prisma.kushkiWebhookLog.findFirst({ orderBy: { createdAt: 'desc' } });
      expect(log!.detalle).toContain('Datáfono');
    });
  });

  describe('conciliación y consulta de la pantalla', () => {
    const envejecer = (id: string, minutos: number) =>
      prisma.cobroDatafono.update({ where: { id }, data: { createdAt: new Date(Date.now() - minutos * 60_000) } });

    it('si el aviso nunca llegó, la conciliación acredita lo que Kushki ya aprobó', async () => {
      const e = await escenario();
      await cobrar(e.tokenSede, e.terminal.id, 20000);
      const cobro = (await prisma.cobroDatafono.findFirst())!;
      await envejecer(cobro.id, 5);
      buscar.mockResolvedValue(aprobada(20000));

      expect(await conciliarCobrosDatafono()).toMatchObject({ revisados: 1, aprobados: 1 });
      expect(await saldoDe(e.empresa.id)).toBe(20000);
      expect((await conciliarCobrosDatafono()).revisados).toBe(0);
    });

    it('sin rastro en Kushki a los 10 minutos queda expirado y libera el terminal; si luego aparece aprobado, se acredita', async () => {
      const e = await escenario();
      await cobrar(e.tokenSede, e.terminal.id, 20000);
      const cobro = (await prisma.cobroDatafono.findFirst())!;
      await envejecer(cobro.id, 12);
      buscar.mockResolvedValue(null);

      await conciliarCobrosDatafono();
      expect((await prisma.cobroDatafono.findUnique({ where: { id: cobro.id } }))!.estado).toBe('expirado');
      expect((await cobrar(e.tokenSede, e.terminal.id, 10000)).status).toBe(201);

      buscar.mockResolvedValue(aprobada(20000, { ticketNumber: 'tk-tarde' }));
      await conciliarCobrosDatafono();
      expect((await prisma.cobroDatafono.findUnique({ where: { id: cobro.id } }))!.estado).toBe('aprobado');
      expect(await saldoDe(e.empresa.id)).toBe(20000);
    });

    it('un error de Kushki en la conciliación no rompe ni acredita', async () => {
      const e = await escenario();
      await cobrar(e.tokenSede, e.terminal.id, 20000);
      await envejecer((await prisma.cobroDatafono.findFirst())!.id, 5);
      buscar.mockRejectedValue(new KushkiError('caído', 502));
      expect(await conciliarCobrosDatafono()).toMatchObject({ revisados: 1, errores: 1 });
      expect(await saldoDe(e.empresa.id)).toBe(0);
    });

    it('la pantalla consulta el cobro; pasados 20 s le pregunta a Kushki y muestra el resultado', async () => {
      const e = await escenario();
      await cobrar(e.tokenSede, e.terminal.id, 20000);
      const cobro = (await prisma.cobroDatafono.findFirst())!;

      const rapido = await request(app).get(`/api/datafonos/cobros/${cobro.id}`).set('Authorization', `Bearer ${e.tokenSede}`);
      expect(rapido.body.cobro.estado).toBe('pendiente');
      expect(buscar).not.toHaveBeenCalled();

      await envejecer(cobro.id, 1);
      buscar.mockResolvedValue(aprobada(20000));
      const luego = await request(app).get(`/api/datafonos/cobros/${cobro.id}`).set('Authorization', `Bearer ${e.tokenSede}`);
      expect(luego.body.cobro.estado).toBe('aprobado');
      expect(await saldoDe(e.empresa.id)).toBe(20000);
    });

    it('cada quien ve solo sus cobros: la sede los suyos, la empresa los de todos', async () => {
      const e = await escenario();
      const otraSede = await crearSubcuentaDePrueba(e.empresa.id, { permisoRecargar: true });
      await prisma.terminalKushki.update({ where: { id: e.terminal.id }, data: { sedeId: null } });
      await cobrar(e.tokenSede, e.terminal.id, 20000);
      const cobro = (await prisma.cobroDatafono.findFirst())!;

      const ajeno = await request(app).get(`/api/datafonos/cobros/${cobro.id}`).set('Authorization', `Bearer ${tokenPara(otraSede)}`);
      expect(ajeno.status).toBe(404);
      const empresa = await request(app).get('/api/datafonos/cobros').set('Authorization', `Bearer ${e.tokenEmpresa}`);
      expect(empresa.body.cobros).toHaveLength(1);
    });
  });

  describe('administración de datáfonos', () => {
    const admin = async () => tokenPara(await crearUsuarioDePrueba({ rol: 'admin' }));
    const crear = (token: string, cuerpo: object) => request(app).post('/api/datafonos/admin/terminales').set('Authorization', `Bearer ${token}`).send(cuerpo);

    it('registra tres datáfonos en la misma sede y los lista con empresa y sede', async () => {
      const empresa = await crearUsuarioDePrueba({ nombre: 'Cool Company' });
      const sede = await crearSubcuentaDePrueba(empresa.id, { permisoRecargar: true });
      const token = await admin();
      for (const [i, serial] of ['SN-AAA-0001', 'SN-AAA-0002', 'SN-AAA-0003'].entries()) {
        const r = await crear(token, { serial, alias: `Caja ${i + 1}`, titularId: empresa.id, sedeId: sede.id });
        expect(r.status).toBe(201);
      }
      const lista = await request(app).get('/api/datafonos/admin/terminales').set('Authorization', `Bearer ${token}`);
      expect(lista.body.terminales).toHaveLength(3);
      expect(lista.body.terminales[0]).toMatchObject({ titular: 'Cool Company', sedeId: sede.id, modelo: 'Sunmi P3', activo: true });
    });

    it('rechaza serial repetido, sede de otra empresa, titular que es sede y a quien no es admin', async () => {
      const empresa = await crearUsuarioDePrueba();
      const otra = await crearUsuarioDePrueba();
      const sedeAjena = await crearSubcuentaDePrueba(otra.id, {});
      const sede = await crearSubcuentaDePrueba(empresa.id, {});
      const token = await admin();

      expect((await crear(token, { serial: 'SN-BBB-0001', alias: 'Caja', titularId: empresa.id })).status).toBe(201);
      expect((await crear(token, { serial: 'SN-BBB-0001', alias: 'Otra', titularId: empresa.id })).status).toBe(409);
      expect((await crear(token, { serial: 'SN-BBB-0002', alias: 'Caja', titularId: empresa.id, sedeId: sedeAjena.id })).status).toBe(400);
      expect((await crear(token, { serial: 'SN-BBB-0003', alias: 'Caja', titularId: sede.id })).status).toBe(400);
      expect((await crear(token, { serial: 'no válido!', alias: 'Caja', titularId: empresa.id })).status).toBe(400);
      expect((await crear(tokenPara(empresa), { serial: 'SN-BBB-0004', alias: 'Caja', titularId: empresa.id })).status).toBe(403);
    });

    it('permite reasignar la sede y desactivar un datáfono; el desactivado ya no cobra', async () => {
      const e = await escenario();
      const token = await admin();
      const off = await request(app).put(`/api/datafonos/admin/terminales/${e.terminal.id}`).set('Authorization', `Bearer ${token}`).send({ activo: false, sedeId: null });
      expect(off.status).toBe(200);
      expect((await cobrar(e.tokenSede, e.terminal.id, 10000)).status).toBe(404);
    });

    it('la comisión tiene que estar entre 0% y 20% y queda auditada', async () => {
      const token = await admin();
      const put = (comisionPct: number) => request(app).put('/api/datafonos/admin/config').set('Authorization', `Bearer ${token}`).send({ comisionPct });
      expect((await put(25)).status).toBe(400);
      expect((await put(-1)).status).toBe(400);
      expect((await put(1.5)).status).toBe(200);
      expect((await request(app).get('/api/datafonos/admin/config').set('Authorization', `Bearer ${token}`)).body.comisionPct).toBe(1.5);
      expect(await prisma.auditLog.count({ where: { accion: 'CAMBIAR_COMISION_DATAFONO' } })).toBe(1);
    });
  });
});
