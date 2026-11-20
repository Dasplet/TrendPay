import axios from 'axios';
import request from 'supertest';
import app, { prisma } from '../index';
import { limpiarBaseDeDatos, crearUsuarioDePrueba, crearSubcuentaDePrueba, tokenPara } from '../tests/testUtils';
import { encrypt } from '../utils/security';
import { enviarCobroAsync, businessCodeDeTitular } from '../utils/kushkiOne';
import { tokenWebhookDatafono, webhookDatafonoUrl, olvidarTokenWebhookEnMemoria, urlPublicaApi } from '../utils/datafonos';

jest.mock('axios');
jest.mock('../utils/kushkiOneAuth', () => ({ prepararSolicitud: jest.fn(() => ({ headers: { Authorization: 'Basic x', timestamp: '1' }, body: { data: 'iv:cifrado' } })) }));
import { prepararSolicitud } from '../utils/kushkiOneAuth';

const http = axios as jest.Mocked<typeof axios>;
const preparar = prepararSolicitud as jest.Mock;

describe('Datáfonos: Business-Code por empresa y código del webhook', () => {
  afterAll(async () => {
    await limpiarBaseDeDatos();
    await prisma.config.deleteMany({ where: { clave: 'kushki_one_webhook_token' } });
    await prisma.$disconnect();
  });
  beforeEach(async () => {
    await limpiarBaseDeDatos();
    await prisma.config.deleteMany({ where: { clave: 'kushki_one_webhook_token' } });
    olvidarTokenWebhookEnMemoria();
    jest.resetAllMocks();
    preparar.mockImplementation(() => ({ headers: { Authorization: 'Basic x', timestamp: '1' }, body: { data: 'iv:cifrado' } }));
    http.post.mockResolvedValue({ data: { status: 'TERMINAL_ACKNOWLEDGED' } });
  });

  const orden = { monto: 10000, clientTransactionId: 'c1', eventsWebhookUrl: 'https://x.test/w', referencia: 'r1' };
  const empresaConTerminal = async (serial: string, codigo: string | null) => {
    const empresa = await crearUsuarioDePrueba({ saldo: 0, nombre: `Empresa ${serial}` });
    if (codigo) await prisma.comercioKushkiOne.create({ data: { userId: empresa.id, businessCodeCif: encrypt(codigo) } });
    await prisma.terminalKushki.create({ data: { serial, alias: 'Caja', titularId: empresa.id } });
    return empresa;
  };

  describe('cada empresa usa su propio Business-Code', () => {
    it('el mensaje a un terminal se firma con el código de la empresa a la que pertenece', async () => {
      await empresaConTerminal('SN-AAAA-0001', 'codigo-de-la-empresa-A');
      await empresaConTerminal('SN-BBBB-0002', 'codigo-de-la-empresa-B');

      await enviarCobroAsync('SN-AAAA-0001', orden);
      await enviarCobroAsync('SN-BBBB-0002', orden);

      expect(preparar.mock.calls.map(([serial, , codigo]) => [serial, codigo])).toEqual([
        ['SN-AAAA-0001', 'codigo-de-la-empresa-A'],
        ['SN-BBBB-0002', 'codigo-de-la-empresa-B'],
      ]);
    });

    it('una empresa sin código no puede mandar nada a Kushki, aunque otra sí lo tenga', async () => {
      await empresaConTerminal('SN-AAAA-0001', 'codigo-de-la-empresa-A');
      await empresaConTerminal('SN-CCCC-0003', null);

      await expect(enviarCobroAsync('SN-CCCC-0003', orden)).rejects.toMatchObject({ status: 503, message: expect.stringContaining('Business-Code') });
      await expect(enviarCobroAsync('SN-DESCONOCIDO-9', orden)).rejects.toMatchObject({ status: 503 });
      expect(http.post).not.toHaveBeenCalled();
    });

    it('un código desactivado no se usa', async () => {
      const e = await empresaConTerminal('SN-AAAA-0001', 'codigo-de-la-empresa-A');
      await prisma.comercioKushkiOne.update({ where: { userId: e.id }, data: { activo: false } });
      expect(await businessCodeDeTitular(e.id)).toBeNull();
    });

    it('el código se guarda cifrado: en la base no aparece en claro', async () => {
      const e = await empresaConTerminal('SN-AAAA-0001', 'codigo-secreto-visible');
      const fila = await prisma.comercioKushkiOne.findUniqueOrThrow({ where: { userId: e.id } });
      expect(fila.businessCodeCif).not.toContain('codigo-secreto-visible');
      expect(await businessCodeDeTitular(e.id)).toBe('codigo-secreto-visible');
    });
  });

  describe('administración del Business-Code', () => {
    const admin = async () => tokenPara(await crearUsuarioDePrueba({ rol: 'admin' }));
    const guardar = (token: string, id: string, businessCode: string) =>
      request(app).put(`/api/datafonos/admin/empresas/${id}/business-code`).set('Authorization', `Bearer ${token}`).send({ businessCode });

    it('el administrador asigna el código a una empresa; se guarda cifrado y se auditan solo los últimos caracteres', async () => {
      const empresa = await crearUsuarioDePrueba({ saldo: 0, nombre: 'Cool Company' });
      const token = await admin();
      const res = await guardar(token, empresa.id, 'a1b2c3d4e5f60718293a4b5c6d7e8f90');
      expect(res.status).toBe(200);
      expect(res.body.termina).toBe('…8f90');
      expect(JSON.stringify(res.body)).not.toContain('a1b2c3d4e5f6');
      expect(await businessCodeDeTitular(empresa.id)).toBe('a1b2c3d4e5f60718293a4b5c6d7e8f90');
      const auditoria = await prisma.auditLog.findFirstOrThrow({ where: { accion: 'GUARDAR_BUSINESS_CODE_KUSHKI_ONE' } });
      expect(JSON.stringify(auditoria)).not.toContain('a1b2c3d4e5f6');

      // reemplazar el código
      await guardar(token, empresa.id, 'zzzzzzzz-nuevo-codigo');
      expect(await businessCodeDeTitular(empresa.id)).toBe('zzzzzzzz-nuevo-codigo');
      expect(await prisma.comercioKushkiOne.count()).toBe(1);
    });

    it('rechaza códigos con formato raro, sedes, cuentas inexistentes y a quien no es administrador', async () => {
      const empresa = await crearUsuarioDePrueba({ saldo: 0 });
      const sede = await crearSubcuentaDePrueba(empresa.id, {});
      const token = await admin();
      expect((await guardar(token, empresa.id, 'corto')).status).toBe(400);
      expect((await guardar(token, empresa.id, 'tiene espacios y símbolos!')).status).toBe(400);
      expect((await guardar(token, sede.id, 'codigo-valido-12345')).status).toBe(404);
      expect((await guardar(token, '00000000-0000-4000-8000-000000000000', 'codigo-valido-12345')).status).toBe(404);
      expect((await guardar(tokenPara(empresa), empresa.id, 'codigo-valido-12345')).status).toBe(403);
      expect(await prisma.comercioKushkiOne.count()).toBe(0);
    });

    it('el listado muestra por empresa si ya tiene código (solo el final) y cuántos datáfonos tiene', async () => {
      const a = await empresaConTerminal('SN-AAAA-0001', 'codigo-empresa-A-1234');
      await empresaConTerminal('SN-CCCC-0003', null);
      const token = await admin();
      const res = await request(app).get('/api/datafonos/admin/terminales').set('Authorization', `Bearer ${token}`);
      expect(res.status).toBe(200);
      const filas = res.body.empresas as { titularId: string; configurado: boolean; termina: string; terminales: number }[];
      expect(filas).toHaveLength(2);
      expect(filas.find((f) => f.titularId === a.id)).toMatchObject({ configurado: true, termina: '…1234', terminales: 1 });
      expect(filas.find((f) => f.titularId !== a.id)).toMatchObject({ configurado: false, termina: '' });
      expect(JSON.stringify(res.body)).not.toContain('codigo-empresa-A');
    });

    it('quitar el código deja a la empresa sin poder cobrar; no se puede con cobros en curso', async () => {
      const e = await empresaConTerminal('SN-AAAA-0001', 'codigo-empresa-A-1234');
      const token = await admin();
      const terminal = await prisma.terminalKushki.findFirstOrThrow({ where: { titularId: e.id } });
      const cobro = await prisma.cobroDatafono.create({ data: { terminalId: terminal.id, userId: e.id, clientTransactionId: crypto.randomUUID(), monto: 5000 } });
      const quitar = () => request(app).delete(`/api/datafonos/admin/empresas/${e.id}/business-code`).set('Authorization', `Bearer ${token}`);

      expect((await quitar()).status).toBe(409);
      await prisma.cobroDatafono.update({ where: { id: cobro.id }, data: { estado: 'aprobado' } });
      expect((await quitar()).status).toBe(200);
      expect(await businessCodeDeTitular(e.id)).toBeNull();
      expect((await quitar()).status).toBe(404);
    });
  });

  describe('probar la conexión con un terminal (sin cobrar)', () => {
    const admin = async () => tokenPara(await crearUsuarioDePrueba({ rol: 'admin' }));
    const probar = (token: string, id: string) => request(app).post(`/api/datafonos/admin/terminales/${id}/probar`).set('Authorization', `Bearer ${token}`);
    const idDe = async (serial: string) => (await prisma.terminalKushki.findUniqueOrThrow({ where: { serial } })).id;

    it('consulta los datos del terminal por su serial y con el código de su empresa', async () => {
      await empresaConTerminal('SN-AAAA-0001', 'codigo-de-la-empresa-A');
      http.post.mockResolvedValue({ data: { model: 'P3', room: '3.0.10', serialNumber: 'SN-AAAA-0001' } });

      const res = await probar(await admin(), await idDe('SN-AAAA-0001'));
      expect(res.status).toBe(200);
      expect(res.body).toMatchObject({ ok: true, conectado: true, modelo: 'P3', version: '3.0.10', serial: 'SN-AAAA-0001' });
      const [url, cuerpo, opciones] = http.post.mock.calls[0] as [string, unknown, { timeout: number }];
      expect(url).toContain('/terminal/v1/SN-AAAA-0001/sync/config/terminal_info');
      expect(cuerpo).toEqual({ data: 'iv:cifrado' });
      expect(opciones.timeout).toBe(40_000); // no deja la pantalla esperando minuto y medio
      expect(preparar.mock.calls[0][2]).toBe('codigo-de-la-empresa-A');
    });

    it('si el terminal no responde dice por qué, con el código de Kushki, sin romper la pantalla', async () => {
      await empresaConTerminal('SN-AAAA-0001', 'codigo-de-la-empresa-A');
      http.post.mockResolvedValue({ data: { type: 'AUTH', code: 'AUTH-001', message: 'Invalid or expired credentials' } });
      const res = await probar(await admin(), await idDe('SN-AAAA-0001'));
      expect(res.status).toBe(200);
      expect(res.body).toMatchObject({ ok: true, conectado: false });
      expect(res.body.mensaje).toContain('Invalid or expired credentials');
      expect(res.body.mensaje).toContain('[AUTH-001]');

      http.post.mockRejectedValue(new Error('timeout of 40000ms exceeded'));
      const sinRespuesta = await probar(await admin(), await idDe('SN-AAAA-0001'));
      expect(sinRespuesta.body.conectado).toBe(false);
      expect(sinRespuesta.body.mensaje).toContain('timeout');
    });

    it('un 504 de Kushki (no alcanza al aparato) se explica con palabras claras y con su código', async () => {
      await empresaConTerminal('SN-AAAA-0001', 'codigo-de-la-empresa-A');
      http.post.mockRejectedValue({ message: 'Request failed with status code 504', response: { status: 504, data: '<html>Gateway Timeout</html>' } });
      const res = await probar(await admin(), await idDe('SN-AAAA-0001'));
      expect(res.body.conectado).toBe(false);
      expect(res.body.mensaje).toContain('no pudo comunicarse con el datáfono');
      expect(res.body.mensaje).toContain('[HTTP-504]');
      expect(res.body.mensaje).not.toContain('Request failed with status code');
    });

    it('una empresa sin Business-Code no llega a llamar a Kushki y lo dice', async () => {
      await empresaConTerminal('SN-CCCC-0003', null);
      const res = await probar(await admin(), await idDe('SN-CCCC-0003'));
      expect(res.body).toMatchObject({ conectado: false });
      expect(res.body.mensaje).toContain('Business-Code');
      expect(http.post).not.toHaveBeenCalled();
    });

    it('solo un administrador puede probar y el terminal tiene que existir', async () => {
      const e = await empresaConTerminal('SN-AAAA-0001', 'codigo-de-la-empresa-A');
      expect((await probar(tokenPara(e), await idDe('SN-AAAA-0001'))).status).toBe(403);
      expect((await probar(await admin(), '00000000-0000-4000-8000-000000000000')).status).toBe(404);
    });
  });

  describe('el código secreto del webhook se crea solo', () => {
    const guardarEnv = { token: process.env.KUSHKI_ONE_WEBHOOK_TOKEN, url: process.env.KUSHKI_ONE_WEBHOOK_URL };
    beforeEach(() => { delete process.env.KUSHKI_ONE_WEBHOOK_TOKEN; process.env.KUSHKI_ONE_WEBHOOK_URL = 'https://api.trendpay.test'; });
    afterEach(() => {
      if (guardarEnv.token === undefined) delete process.env.KUSHKI_ONE_WEBHOOK_TOKEN; else process.env.KUSHKI_ONE_WEBHOOK_TOKEN = guardarEnv.token;
      if (guardarEnv.url === undefined) delete process.env.KUSHKI_ONE_WEBHOOK_URL; else process.env.KUSHKI_ONE_WEBHOOK_URL = guardarEnv.url;
    });

    it('sin la variable de entorno, TrendPay genera un código aleatorio largo, lo guarda cifrado y siempre devuelve el mismo', async () => {
      const t1 = await tokenWebhookDatafono();
      expect(t1).toMatch(/^[0-9a-f]{48}$/);
      olvidarTokenWebhookEnMemoria(); // como si el servidor se reiniciara
      expect(await tokenWebhookDatafono()).toBe(t1);

      const fila = await prisma.config.findUniqueOrThrow({ where: { clave: 'kushki_one_webhook_token' } });
      expect(fila.valor).not.toContain(t1);
      expect(await webhookDatafonoUrl()).toBe(`https://api.trendpay.test/api/datafonos/webhooks/${t1}`);
    });

    it('la variable de entorno, si existe, manda sobre el código automático', async () => {
      process.env.KUSHKI_ONE_WEBHOOK_TOKEN = 'token-fijado-por-el-administrador';
      expect(await tokenWebhookDatafono()).toBe('token-fijado-por-el-administrador');
      expect(await prisma.config.count({ where: { clave: 'kushki_one_webhook_token' } })).toBe(0);
    });

    it('el aviso con el código automático se acepta y con otro se rechaza con 404', async () => {
      const t = await tokenWebhookDatafono();
      expect((await request(app).post(`/api/datafonos/webhooks/${t}`).send({ event_id: 'e', status: 'CARD_PRESENTED', client_transaction_id: '00000000-0000-4000-8000-000000000000' })).status).toBe(200);
      expect((await request(app).post('/api/datafonos/webhooks/codigo-inventado').send({})).status).toBe(404);
    });

    it('la dirección pública nunca sale de lo que mande quien hace la petición', () => {
      expect(urlPublicaApi()).toBe('https://api.trendpay.test');
    });
  });
});
