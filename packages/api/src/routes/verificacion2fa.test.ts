import request from 'supertest';
import app, { prisma } from '../index';
import { limpiarBaseDeDatos, crearUsuarioDePrueba, tokenPara } from '../tests/testUtils';
import { MAX_INTENTOS_CODIGO, ESPERA_REENVIO_MS } from '../utils/verificacion2fa';

jest.mock('../utils/email', () => {
  const actual = jest.requireActual('../utils/email');
  return { ...actual, sendOtpEmail: jest.fn() };
});
import { sendOtpEmail } from '../utils/email';

describe('Verificación en dos pasos (2FA)', () => {
  afterAll(async () => { await limpiarBaseDeDatos(); await prisma.$disconnect(); });
  beforeEach(async () => {
    await limpiarBaseDeDatos();
    jest.clearAllMocks();
    (sendOtpEmail as jest.Mock).mockResolvedValue(true);
  });

  const auth = (u: any) => ({ Authorization: `Bearer ${tokenPara(u)}` });
  const post = (u: any, ruta: string, cuerpo: object = {}) => request(app).post(`/api/auth/2fa/${ruta}`).set(auth(u)).send(cuerpo);
  const estado = async (id: string) => (await prisma.user.findUniqueOrThrow({ where: { id } })).requiere2fa;
  // El código que se mandó por correo (en las pruebas el correo está simulado)
  const ultimoCodigo = () => (sendOtpEmail as jest.Mock).mock.calls.at(-1)![1] as string;
  // Salta la espera entre códigos sin esperar de verdad
  const sinEspera = () => prisma.codigoVerificacion.updateMany({ data: { createdAt: new Date(Date.now() - ESPERA_REENVIO_MS - 1000) } });

  async function conDosPasos() {
    const u = await crearUsuarioDePrueba({ saldo: 100000 });
    await prisma.user.update({ where: { id: u.id }, data: { requiere2fa: true } });
    return u;
  }

  describe('encender y apagar', () => {
    it('se enciende con el PIN y el código que llega al correo', async () => {
      const u = await crearUsuarioDePrueba();
      expect((await request(app).get('/api/auth/2fa/estado').set(auth(u))).body).toMatchObject({ activo: false });

      const pedir = await post(u, 'solicitar', { proposito: 'activar', pin: '1234' });
      expect(pedir.status).toBe(200);
      expect(sendOtpEmail).toHaveBeenCalledWith(u.correo, expect.stringMatching(/^\d{6}$/));
      expect(pedir.body.correo).toMatch(/\*/); // el correo sale enmascarado

      const confirmar = await post(u, 'activar', { codigo: ultimoCodigo() });
      expect(confirmar.status).toBe(200);
      expect(await estado(u.id)).toBe(true);
      expect((await request(app).get('/api/auth/2fa/estado').set(auth(u))).body.activo).toBe(true);
      expect(await prisma.userAuditLog.count({ where: { userId: u.id, accion: 'ACTIVAR_2FA' } })).toBe(1);
    });

    it('no se enciende con el PIN equivocado, y los fallos cuentan para el bloqueo de la cuenta', async () => {
      const u = await crearUsuarioDePrueba();
      const r = await post(u, 'solicitar', { proposito: 'activar', pin: '0000' });
      expect(r.status).toBe(401);
      expect(sendOtpEmail).not.toHaveBeenCalled();
      expect((await prisma.user.findUniqueOrThrow({ where: { id: u.id } })).intentosPin).toBe(1);
    });

    it('con un código equivocado no se enciende', async () => {
      const u = await crearUsuarioDePrueba();
      await post(u, 'solicitar', { proposito: 'activar', pin: '1234' });
      const r = await post(u, 'activar', { codigo: '000000' === ultimoCodigo() ? '111111' : '000000' });
      expect(r.status).toBe(400);
      expect(r.body.mensaje).toMatch(/incorrecto/i);
      expect(await estado(u.id)).toBe(false);
    });

    it('para apagarla se pide el PIN y un código nuevo del correo', async () => {
      const u = await conDosPasos();
      expect((await post(u, 'solicitar', { proposito: 'desactivar', pin: '9999' })).status).toBe(401);
      expect((await post(u, 'solicitar', { proposito: 'desactivar', pin: '1234' })).status).toBe(200);

      expect((await post(u, 'desactivar', { pin: '9999', codigo: ultimoCodigo() })).status).toBe(401);
      expect(await estado(u.id)).toBe(true);

      const ok = await post(u, 'desactivar', { pin: '1234', codigo: ultimoCodigo() });
      expect(ok.status).toBe(200);
      expect(await estado(u.id)).toBe(false);
      expect(await prisma.userAuditLog.count({ where: { userId: u.id, accion: 'DESACTIVAR_2FA' } })).toBe(1);
    });

    it('un código para otra cosa no sirve (el de activar no apaga ni confirma operaciones)', async () => {
      const u = await crearUsuarioDePrueba();
      await post(u, 'solicitar', { proposito: 'activar', pin: '1234' });
      const codigo = ultimoCodigo();
      await prisma.user.update({ where: { id: u.id }, data: { requiere2fa: true } });
      expect((await post(u, 'desactivar', { pin: '1234', codigo })).status).toBe(400);
      const envio = await request(app).post('/api/wallet/enviar').set(auth(u)).send({ destino: 'x', monto: 5000, codigo2fa: codigo });
      expect(envio.status).toBe(403);
    });

    it('no deja pedir un código de más: ya activa / no activa, propósito inválido, y espera entre códigos', async () => {
      const u = await crearUsuarioDePrueba();
      expect((await post(u, 'solicitar', { proposito: 'desactivar', pin: '1234' })).status).toBe(400);
      expect((await post(u, 'solicitar', { proposito: 'operacion' })).status).toBe(400);
      expect((await post(u, 'solicitar', { proposito: 'otra', pin: '1234' })).status).toBe(400);

      expect((await post(u, 'solicitar', { proposito: 'activar', pin: '1234' })).status).toBe(200);
      const repetido = await post(u, 'solicitar', { proposito: 'activar', pin: '1234' });
      expect(repetido.status).toBe(429);
      expect(sendOtpEmail).toHaveBeenCalledTimes(1);
      await sinEspera();
      expect((await post(u, 'solicitar', { proposito: 'activar', pin: '1234' })).status).toBe(200);
      expect(sendOtpEmail).toHaveBeenCalledTimes(2);
    });

    it('exige estar autenticado', async () => {
      expect((await request(app).post('/api/auth/2fa/solicitar').send({ proposito: 'activar', pin: '1234' })).status).toBe(401);
      expect((await request(app).get('/api/auth/2fa/estado')).status).toBe(401);
    });

    it('si falla el envío del correo no queda un código pendiente y se avisa', async () => {
      const u = await crearUsuarioDePrueba();
      (sendOtpEmail as jest.Mock).mockRejectedValueOnce(new Error('correo caído'));
      const r = await post(u, 'solicitar', { proposito: 'activar', pin: '1234' });
      expect(r.status).toBe(500);
      expect(await prisma.codigoVerificacion.count({ where: { userId: u.id } })).toBe(0);
    });
  });

  describe('al iniciar sesión', () => {
    it('pide el código, y completa la entrada con el correcto (que ya no sirve una segunda vez)', async () => {
      const u = await conDosPasos();
      const login = await request(app).post('/api/auth/login').send({ cedula: u.cedula, pin: '1234' });
      expect(login.body.requiere2fa).toBe(true);
      expect(login.body.accessToken).toBeUndefined();
      const codigo = ultimoCodigo();

      const mal = await request(app).post('/api/auth/login/verify-2fa').send({ cedula: u.cedula, otp: codigo === '123456' ? '654321' : '123456' });
      expect(mal.status).toBe(400);
      const bien = await request(app).post('/api/auth/login/verify-2fa').send({ cedula: u.cedula, otp: codigo });
      expect(bien.status).toBe(200);
      expect(bien.body.accessToken).toBeDefined();
      expect(bien.body.usuario.requiere2fa).toBe(true);

      const otra = await request(app).post('/api/auth/login/verify-2fa').send({ cedula: u.cedula, otp: codigo });
      expect(otra.status).toBe(400);
    });

    it('tras 5 códigos equivocados el código se anula y hay que pedir otro', async () => {
      const u = await conDosPasos();
      await request(app).post('/api/auth/login').send({ cedula: u.cedula, pin: '1234' });
      const codigo = ultimoCodigo();
      const falso = codigo === '111111' ? '222222' : '111111';
      for (let i = 0; i < MAX_INTENTOS_CODIGO; i++) {
        expect((await request(app).post('/api/auth/login/verify-2fa').send({ cedula: u.cedula, otp: falso })).status).toBe(400);
      }
      const conElBueno = await request(app).post('/api/auth/login/verify-2fa').send({ cedula: u.cedula, otp: codigo });
      expect(conElBueno.status).toBe(400);
    });

    it('un código vencido no sirve', async () => {
      const u = await conDosPasos();
      await request(app).post('/api/auth/login').send({ cedula: u.cedula, pin: '1234' });
      const codigo = ultimoCodigo();
      await prisma.codigoVerificacion.updateMany({ data: { expiraAt: new Date(Date.now() - 1000) } });
      const r = await request(app).post('/api/auth/login/verify-2fa').send({ cedula: u.cedula, otp: codigo });
      expect(r.status).toBe(400);
      expect(r.body.mensaje).toMatch(/venci/i);
    });

    it('sin 2FA encendido, verify-2fa no deja entrar a nadie', async () => {
      const u = await crearUsuarioDePrueba();
      const r = await request(app).post('/api/auth/login/verify-2fa').send({ cedula: u.cedula, otp: '123456' });
      expect(r.status).toBe(400);
    });

    it('en la base de datos solo queda la huella del código, nunca el código', async () => {
      const u = await conDosPasos();
      await request(app).post('/api/auth/login').send({ cedula: u.cedula, pin: '1234' });
      const fila = await prisma.codigoVerificacion.findFirstOrThrow({ where: { userId: u.id } });
      expect(fila.codigoHash).not.toContain(ultimoCodigo());
      expect(fila.codigoHash).toHaveLength(64);
    });
  });

  describe('en las operaciones sensibles', () => {
    async function pedirCodigoDeOperacion(u: any) {
      const r = await post(u, 'solicitar', { proposito: 'operacion' });
      expect(r.status).toBe(200);
      return ultimoCodigo();
    }
    const destino = () => crearUsuarioDePrueba({ saldo: 0 });

    it('enviar dinero: sin código responde 403 con requiere2fa; con el código correcto se hace y el código se gasta', async () => {
      const u = await conDosPasos();
      const d = await destino();
      const sin = await request(app).post('/api/wallet/enviar').set(auth(u)).send({ destino: d.cedula, monto: 10000 });
      expect(sin.status).toBe(403);
      expect(sin.body.requiere2fa).toBe(true);

      const codigo = await pedirCodigoDeOperacion(u);
      const mal = await request(app).post('/api/wallet/enviar').set(auth(u)).send({ destino: d.cedula, monto: 10000, codigo2fa: codigo === '000000' ? '111111' : '000000' });
      expect(mal.status).toBe(403);

      const ok = await request(app).post('/api/wallet/enviar').set(auth(u)).send({ destino: d.cedula, monto: 10000, codigo2fa: codigo });
      expect(ok.status).toBe(200);
      expect(Number((await prisma.wallet.findUniqueOrThrow({ where: { userId: d.id } })).saldo)).toBe(10000);

      // el mismo código no vale para una segunda operación
      const repetida = await request(app).post('/api/wallet/enviar').set(auth(u)).send({ destino: d.cedula, monto: 10000, codigo2fa: codigo });
      expect(repetida.status).toBe(403);
    });

    it('el código también puede ir en la cabecera x-codigo-2fa', async () => {
      const u = await conDosPasos();
      const d = await destino();
      const codigo = await pedirCodigoDeOperacion(u);
      const ok = await request(app).post('/api/wallet/enviar').set(auth(u)).set('x-codigo-2fa', codigo).send({ destino: d.cedula, monto: 10000 });
      expect(ok.status).toBe(200);
    });

    it('el navegador puede mandar la cabecera x-codigo-2fa (CORS la permite)', async () => {
      const r = await request(app).options('/api/wallet/enviar')
        .set('Origin', 'http://localhost:3000')
        .set('Access-Control-Request-Method', 'POST')
        .set('Access-Control-Request-Headers', 'authorization,content-type,x-codigo-2fa');
      expect(String(r.headers['access-control-allow-headers']).toLowerCase()).toContain('x-codigo-2fa');
    });

    it('retirar a un banco y cambiar el PIN también lo piden', async () => {
      const u = await conDosPasos();
      const retiro = { bancoNombre: 'Bancolombia', tipoCuenta: 'ahorros', numeroCuenta: '12345678901', cedulaTitular: '1023456789', nombreTitular: 'Titular Prueba', monto: 20000 };
      const sin = await request(app).post('/api/withdrawals').set(auth(u)).send(retiro);
      expect(sin.status).toBe(403);
      expect(sin.body.requiere2fa).toBe(true);
      expect(await prisma.withdrawal.count()).toBe(0);

      const cambio = { pin_actual: '1234', pin_nuevo: '4321', pin_confirmar: '4321' };
      expect((await request(app).put('/api/auth/change-pin').set(auth(u)).send(cambio)).status).toBe(403);
      const codigo = await pedirCodigoDeOperacion(u);
      expect((await request(app).put('/api/auth/change-pin').set(auth(u)).send({ ...cambio, codigo2fa: codigo })).status).toBe(200);
    });

    it('vincular o quitar una cuenta de banco también lo pide', async () => {
      const u = await conDosPasos();
      const cuenta = { bancoNombre: 'Bancolombia', tipoCuenta: 'ahorros', numeroCuenta: '12345678901', nombreTitular: 'Titular Prueba', cedulaTitular: '1023456789' };
      const r = await request(app).post('/api/bank-accounts').set(auth(u)).send(cuenta);
      expect(r.status).toBe(403);
      expect(r.body.requiere2fa).toBe(true);
    });

    it('quien no tiene 2FA no ve ningún cambio: las operaciones funcionan como siempre', async () => {
      const u = await crearUsuarioDePrueba({ saldo: 50000 });
      const d = await destino();
      const ok = await request(app).post('/api/wallet/enviar').set(auth(u)).send({ destino: d.cedula, monto: 10000 });
      expect(ok.status).toBe(200);
    });

    it('apagar la verificación vuelve a dejar las operaciones sin código', async () => {
      const u = await conDosPasos();
      const d = await destino();
      await post(u, 'solicitar', { proposito: 'desactivar', pin: '1234' });
      await post(u, 'desactivar', { pin: '1234', codigo: ultimoCodigo() });
      const ok = await request(app).post('/api/wallet/enviar').set(auth(u)).send({ destino: d.cedula, monto: 10000 });
      expect(ok.status).toBe(200);
    });
  });
});
