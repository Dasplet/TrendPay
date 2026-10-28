import request from 'supertest';
import app, { prisma } from '../index';
import { limpiarBaseDeDatos, crearUsuarioDePrueba, tokenPara } from '../tests/testUtils';
import * as storage from '../utils/storage';
import * as email from '../utils/email';
import { enlaceVinculacion } from '../utils/vinculaciones';

jest.mock('../utils/storage', () => ({
  almacenamientoConfigurado: jest.fn(() => true),
  guardarObjeto: jest.fn(async () => undefined),
  borrarObjeto: jest.fn(async () => undefined),
  urlTemporal: jest.fn(async (key: string) => `https://almacen.test/${key}?firma=abc`),
}));
jest.mock('../utils/email', () => ({
  ...jest.requireActual('../utils/email'),
  sendVinculacionEmail: jest.fn(async () => true),
}));

const PDF = Buffer.from('%PDF-1.4\n1 0 obj\n<<>>\nendobj\n');
const PNG = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(16)]);

const TIPOS = ['cedula_rep_legal', 'rut', 'camara_comercio', 'cert_bancaria', 'composicion_accionaria'] as const;

function hace(dias: number) {
  return new Date(Date.now() - dias * 86400000).toISOString().slice(0, 10);
}

const datosEmpresa = { razonSocial: 'Comercial Andina S.A.S.', nit: '900123456-7', contactoNombre: 'Laura Gómez', contactoCorreo: 'laura@andina.test' };

async function crearSolicitud() {
  const admin = await crearUsuarioDePrueba({ rol: 'admin' });
  const auth = { Authorization: `Bearer ${tokenPara(admin)}` };
  const res = await request(app).post('/api/admin/vinculaciones').set(auth).send(datosEmpresa);
  const token = res.body.enlace.split('/').pop() as string;
  return { admin, auth, id: res.body.vinculacion.id as string, token };
}

function subir(token: string, tipo: string, opts: { archivo?: Buffer; nombre?: string; fecha?: string } = {}) {
  const req = request(app).post(`/api/vinculacion/${token}/documentos/${tipo}`);
  if (opts.fecha) req.field('fechaExpedicion', opts.fecha);
  return req.attach('archivo', opts.archivo ?? PDF, opts.nombre ?? 'documento.pdf');
}

async function subirTodos(token: string) {
  for (const tipo of TIPOS) {
    const fecha = tipo === 'cedula_rep_legal' ? undefined : hace(10);
    const res = await subir(token, tipo, { fecha });
    expect(res.status).toBe(200);
  }
}

describe('Enlace de vinculación', () => {
  const entorno = { front: process.env.FRONTEND_URL, node: process.env.NODE_ENV };
  afterEach(() => {
    if (entorno.front === undefined) delete process.env.FRONTEND_URL; else process.env.FRONTEND_URL = entorno.front;
    (process.env as Record<string, string | undefined>).NODE_ENV = entorno.node;
  });

  it('usa FRONTEND_URL cuando es una dirección pública', () => {
    process.env.FRONTEND_URL = 'https://app.trendpay.test/';
    expect(enlaceVinculacion('abc')).toBe('https://app.trendpay.test/vinculacion/abc');
  });

  it('en producción ignora un FRONTEND_URL de desarrollo y usa el dominio real', () => {
    process.env.FRONTEND_URL = 'http://localhost:3000';
    (process.env as Record<string, string | undefined>).NODE_ENV = 'production';
    expect(enlaceVinculacion('abc')).toBe('https://trendpay.com.co/vinculacion/abc');
  });

  it('en desarrollo conserva localhost para poder probar', () => {
    process.env.FRONTEND_URL = 'http://localhost:3000';
    expect(enlaceVinculacion('abc')).toBe('http://localhost:3000/vinculacion/abc');
  });
});

describe('Vinculación de clientes', () => {
  afterAll(async () => {
    await limpiarBaseDeDatos();
    await prisma.$disconnect();
  });

  beforeEach(async () => {
    jest.clearAllMocks();
    (storage.almacenamientoConfigurado as jest.Mock).mockReturnValue(true);
    await limpiarBaseDeDatos();
  });

  describe('Administración', () => {
    it('un usuario normal no puede crear solicitudes', async () => {
      const user = await crearUsuarioDePrueba();
      const res = await request(app).post('/api/admin/vinculaciones').set('Authorization', `Bearer ${tokenPara(user)}`).send(datosEmpresa);
      expect(res.status).toBe(403);
    });

    it('crea la solicitud, envía el correo y guarda solo el hash del enlace', async () => {
      const { id, token } = await crearSolicitud();
      expect(token.length).toBeGreaterThan(30);
      expect(email.sendVinculacionEmail).toHaveBeenCalledWith('laura@andina.test', expect.objectContaining({ motivo: 'invitacion', empresa: 'Comercial Andina S.A.S.' }));

      const guardada = await prisma.vinculacion.findUnique({ where: { id } });
      expect(guardada!.estado).toBe('invitada');
      expect(guardada!.tokenHash).not.toContain(token);
      expect(guardada!.tokenHash).toHaveLength(64);
    });

    it('valida los datos de la solicitud', async () => {
      const { auth } = await crearSolicitud();
      const res = await request(app).post('/api/admin/vinculaciones').set(auth).send({ ...datosEmpresa, contactoCorreo: 'no-es-correo' });
      expect(res.status).toBe(400);
    });

    it('si el correo falla igual entrega el enlace para copiarlo', async () => {
      (email.sendVinculacionEmail as jest.Mock).mockRejectedValueOnce(new Error('Resend caído'));
      const admin = await crearUsuarioDePrueba({ rol: 'admin' });
      const res = await request(app).post('/api/admin/vinculaciones').set('Authorization', `Bearer ${tokenPara(admin)}`).send(datosEmpresa);
      expect(res.status).toBe(201);
      expect(res.body.correoEnviado).toBe(false);
      expect(res.body.enlace).toContain('/vinculacion/');
    });
  });

  describe('Portal del cliente', () => {
    it('muestra los 5 documentos con sus reglas', async () => {
      const { token } = await crearSolicitud();
      const res = await request(app).get(`/api/vinculacion/${token}`);
      expect(res.status).toBe(200);
      expect(res.body.vinculacion.razonSocial).toBe('Comercial Andina S.A.S.');
      expect(res.body.documentos.map((d: any) => d.tipo)).toEqual([...TIPOS]);
      expect(res.body.documentos.find((d: any) => d.tipo === 'rut').pedirFecha).toBe(true);
      expect(res.body.documentos.find((d: any) => d.tipo === 'cedula_rep_legal').pedirFecha).toBe(false);
    });

    it('rechaza enlaces inválidos y vencidos', async () => {
      const { id, token } = await crearSolicitud();
      expect((await request(app).get('/api/vinculacion/token-inventado')).status).toBe(404);

      await prisma.vinculacion.update({ where: { id }, data: { expiraAt: new Date(Date.now() - 1000) } });
      expect((await request(app).get(`/api/vinculacion/${token}`)).status).toBe(410);
    });

    it('acepta PDF y guarda el archivo en el almacenamiento privado', async () => {
      const { id, token } = await crearSolicitud();
      const res = await subir(token, 'cedula_rep_legal');
      expect(res.status).toBe(200);

      expect(storage.guardarObjeto).toHaveBeenCalledWith(expect.stringMatching(new RegExp(`^vinculaciones/${id}/cedula_rep_legal/.+\\.pdf$`)), expect.any(Buffer), 'application/pdf');
      const doc = await prisma.vinculacionDocumento.findFirst({ where: { vinculacionId: id } });
      expect(doc!.sha256).toHaveLength(64);
      expect(doc!.estado).toBe('pendiente');
    });

    it('identifica el archivo por su contenido y no por la extensión', async () => {
      const { token } = await crearSolicitud();
      const falso = await subir(token, 'cedula_rep_legal', { archivo: Buffer.from('MZ ejecutable'), nombre: 'cedula.pdf' });
      expect(falso.status).toBe(400);
      expect(storage.guardarObjeto).not.toHaveBeenCalled();

      const png = await subir(token, 'cedula_rep_legal', { archivo: PNG, nombre: 'cedula.png' });
      expect(png.status).toBe(200);
    });

    it('rechaza archivos de más de 8 MB', async () => {
      const { token } = await crearSolicitud();
      const grande = Buffer.concat([PDF, Buffer.alloc(9 * 1024 * 1024)]);
      const res = await subir(token, 'cedula_rep_legal', { archivo: grande });
      expect(res.status).toBe(413);
    });

    it('valida la vigencia de cada documento según su regla', async () => {
      const { token } = await crearSolicitud();

      expect((await subir(token, 'camara_comercio')).status).toBe(400); // sin fecha
      expect((await subir(token, 'camara_comercio', { fecha: hace(91) })).status).toBe(400);
      expect((await subir(token, 'camara_comercio', { fecha: hace(90) })).status).toBe(200);
      expect((await subir(token, 'cert_bancaria', { fecha: hace(120) })).status).toBe(400);
      expect((await subir(token, 'composicion_accionaria', { fecha: hace(-5) })).status).toBe(400); // futura

      const anioPasado = `${new Date().getUTCFullYear() - 1}-06-15`;
      const rutViejo = await subir(token, 'rut', { fecha: anioPasado });
      expect(rutViejo.status).toBe(400);
      expect(rutViejo.body.mensaje).toContain('año en curso');
    });

    it('reemplazar un documento borra el archivo anterior', async () => {
      const { token } = await crearSolicitud();
      await subir(token, 'cedula_rep_legal');
      await subir(token, 'cedula_rep_legal', { archivo: PNG, nombre: 'nueva.png' });
      expect(storage.borrarObjeto).toHaveBeenCalledTimes(1);
      expect(await prisma.vinculacionDocumento.count()).toBe(1);
    });

    it('responde 503 si el almacenamiento no está configurado', async () => {
      (storage.almacenamientoConfigurado as jest.Mock).mockReturnValue(false);
      const { token } = await crearSolicitud();
      expect((await subir(token, 'cedula_rep_legal')).status).toBe(503);
    });

    it('no permite enviar la solicitud incompleta', async () => {
      const { token } = await crearSolicitud();
      await subir(token, 'cedula_rep_legal');
      const res = await request(app).post(`/api/vinculacion/${token}/enviar`);
      expect(res.status).toBe(400);
      expect(res.body.mensaje).toContain('Falta cargar');
    });

    it('envía a revisión, avisa a los administradores y congela los cambios', async () => {
      const { admin, token, id } = await crearSolicitud();
      await subirTodos(token);

      const res = await request(app).post(`/api/vinculacion/${token}/enviar`);
      expect(res.status).toBe(200);
      expect((await prisma.vinculacion.findUnique({ where: { id } }))!.estado).toBe('en_revision');
      expect(await prisma.notification.count({ where: { userId: admin.id, titulo: 'Vinculación lista para revisar' } })).toBe(1);

      expect((await request(app).post(`/api/vinculacion/${token}/enviar`)).status).toBe(409);
      expect((await subir(token, 'cedula_rep_legal')).status).toBe(409);
    });
  });

  describe('Revisión del equipo', () => {
    async function solicitudEnRevision() {
      const ctx = await crearSolicitud();
      await subirTodos(ctx.token);
      await request(app).post(`/api/vinculacion/${ctx.token}/enviar`);
      return ctx;
    }

    it('entrega un enlace temporal al archivo y deja rastro en la auditoría', async () => {
      const { auth, id, admin } = await solicitudEnRevision();
      const res = await request(app).get(`/api/admin/vinculaciones/${id}/documentos/rut/archivo`).set(auth);
      expect(res.status).toBe(200);
      expect(res.body.url).toContain('https://almacen.test/');
      expect(await prisma.auditLog.count({ where: { accion: 'VER_DOCUMENTO_VINCULACION', userId: admin.id } })).toBe(1);
    });

    it('exige el motivo al rechazar un documento', async () => {
      const { auth, id } = await solicitudEnRevision();
      const sinMotivo = await request(app).put(`/api/admin/vinculaciones/${id}/documentos/rut`).set(auth).send({ estado: 'rechazado' });
      expect(sinMotivo.status).toBe(400);
      const conMotivo = await request(app).put(`/api/admin/vinculaciones/${id}/documentos/rut`).set(auth).send({ estado: 'rechazado', motivo: 'Ilegible' });
      expect(conMotivo.status).toBe(200);
    });

    it('no aprueba la solicitud mientras falten documentos por aprobar', async () => {
      const { auth, id } = await solicitudEnRevision();
      await request(app).put(`/api/admin/vinculaciones/${id}/documentos/rut`).set(auth).send({ estado: 'aprobado' });
      const res = await request(app).put(`/api/admin/vinculaciones/${id}/decision`).set(auth).send({ decision: 'aprobar' });
      expect(res.status).toBe(400);
      expect(res.body.mensaje).toContain('falta aprobar');
    });

    it('aprueba la solicitud cuando todos los documentos están aprobados', async () => {
      const { auth, id } = await solicitudEnRevision();
      for (const tipo of TIPOS) {
        await request(app).put(`/api/admin/vinculaciones/${id}/documentos/${tipo}`).set(auth).send({ estado: 'aprobado' });
      }
      const res = await request(app).put(`/api/admin/vinculaciones/${id}/decision`).set(auth).send({ decision: 'aprobar' });
      expect(res.status).toBe(200);
      expect(res.body.estado).toBe('aprobada');
      expect(email.sendVinculacionEmail).toHaveBeenLastCalledWith('laura@andina.test', expect.objectContaining({ motivo: 'aprobada' }));
      const otra = await request(app).put(`/api/admin/vinculaciones/${id}/decision`).set(auth).send({ decision: 'rechazar', mensaje: 'x' });
      expect(otra.status).toBe(409);
    });

    it('pide correcciones con un enlace nuevo y el cliente solo vuelve a subir lo rechazado', async () => {
      const { auth, id, token } = await solicitudEnRevision();
      for (const tipo of TIPOS.filter(t => t !== 'rut')) {
        await request(app).put(`/api/admin/vinculaciones/${id}/documentos/${tipo}`).set(auth).send({ estado: 'aprobado' });
      }
      await request(app).put(`/api/admin/vinculaciones/${id}/documentos/rut`).set(auth).send({ estado: 'rechazado', motivo: 'Actividad económica incorrecta' });

      const res = await request(app).put(`/api/admin/vinculaciones/${id}/decision`).set(auth).send({ decision: 'solicitar_correccion', mensaje: 'Revisa el RUT' });
      expect(res.status).toBe(200);
      expect(res.body.estado).toBe('requiere_correccion');
      const nuevoToken = res.body.enlace.split('/').pop() as string;
      expect(nuevoToken).not.toBe(token);

      // El enlace anterior ya no sirve; el nuevo muestra el motivo del rechazo
      expect((await request(app).get(`/api/vinculacion/${token}`)).status).toBe(404);
      const vista = await request(app).get(`/api/vinculacion/${nuevoToken}`);
      expect(vista.body.vinculacion.mensaje).toBe('Revisa el RUT');
      expect(vista.body.documentos.find((d: any) => d.tipo === 'rut').motivo).toBe('Actividad económica incorrecta');

      // Un documento aprobado no se reemplaza; el rechazado sí
      expect((await subir(nuevoToken, 'camara_comercio', { fecha: hace(5) })).status).toBe(409);
      expect((await request(app).post(`/api/vinculacion/${nuevoToken}/enviar`)).status).toBe(400);
      expect((await subir(nuevoToken, 'rut', { fecha: hace(1) })).status).toBe(200);
      expect((await request(app).post(`/api/vinculacion/${nuevoToken}/enviar`)).status).toBe(200);
    });

    it('pedir correcciones exige haber rechazado algún documento', async () => {
      const { auth, id } = await solicitudEnRevision();
      const res = await request(app).put(`/api/admin/vinculaciones/${id}/decision`).set(auth).send({ decision: 'solicitar_correccion' });
      expect(res.status).toBe(400);
    });

    it('rechazar la solicitud exige explicarle el motivo al cliente', async () => {
      const { auth, id } = await solicitudEnRevision();
      expect((await request(app).put(`/api/admin/vinculaciones/${id}/decision`).set(auth).send({ decision: 'rechazar' })).status).toBe(400);
      const ok = await request(app).put(`/api/admin/vinculaciones/${id}/decision`).set(auth).send({ decision: 'rechazar', mensaje: 'No cumple el perfil' });
      expect(ok.status).toBe(200);
      expect(ok.body.estado).toBe('rechazada');
    });

    it('el listado resume el avance de cada solicitud', async () => {
      const { auth, id, token } = await crearSolicitud();
      await subir(token, 'cedula_rep_legal');
      const res = await request(app).get('/api/admin/vinculaciones').set(auth);
      const fila = res.body.vinculaciones.find((v: any) => v.id === id);
      expect(fila.documentosSubidos).toBe(1);
      expect(fila.documentosTotales).toBe(5);
    });

    it('reenviar el enlace invalida el anterior', async () => {
      const { auth, id, token } = await crearSolicitud();
      const res = await request(app).post(`/api/admin/vinculaciones/${id}/enlace`).set(auth);
      expect(res.status).toBe(200);
      expect((await request(app).get(`/api/vinculacion/${token}`)).status).toBe(404);
      expect((await request(app).get(`/api/vinculacion/${res.body.enlace.split('/').pop()}`)).status).toBe(200);
    });
  });
});
