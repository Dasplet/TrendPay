import request from 'supertest';
import jwt from 'jsonwebtoken';
import app, { prisma } from '../index';
import { limpiarBaseDeDatos, crearUsuarioDePrueba, tokenPara } from '../tests/testUtils';
import { encryptBuffer, decryptBuffer } from '../utils/security';

// Sin variables S3_*: los documentos se guardan cifrados en la base de datos (sin simular el almacenamiento).
const PDF = Buffer.from('%PDF-1.4\nContenido confidencial de prueba\n');

function hace(dias: number) {
  return new Date(Date.now() - dias * 86400000).toISOString().slice(0, 10);
}

async function solicitudConCedula() {
  const admin = await crearUsuarioDePrueba({ rol: 'admin' });
  const auth = { Authorization: `Bearer ${tokenPara(admin)}` };
  const creada = await request(app).post('/api/admin/vinculaciones').set(auth)
    .send({ razonSocial: 'Empresa BD', contactoNombre: 'Ana Ruiz', contactoCorreo: 'ana@bd.test' });
  const token = creada.body.enlace.split('/').pop() as string;
  const subida = await request(app).post(`/api/vinculacion/${token}/documentos/cedula_rep_legal`).attach('archivo', PDF, 'cedula.pdf');
  expect(subida.status).toBe(200);
  return { auth, id: creada.body.vinculacion.id as string, token, admin };
}

describe('Documentos de vinculación guardados en la base de datos', () => {
  const s3 = ['S3_BUCKET', 'S3_ACCESS_KEY_ID', 'S3_SECRET_ACCESS_KEY'].map(k => [k, process.env[k]] as const);

  beforeAll(() => { for (const [k] of s3) delete process.env[k]; });
  afterAll(async () => {
    for (const [k, v] of s3) if (v !== undefined) process.env[k] = v;
    await limpiarBaseDeDatos();
    await prisma.$disconnect();
  });
  beforeEach(async () => {
    await limpiarBaseDeDatos();
    await prisma.vinculacionArchivo.deleteMany();
  });

  it('cifra el contenido: en la base no queda el PDF en claro', async () => {
    await solicitudConCedula();
    const fila = await prisma.vinculacionArchivo.findFirstOrThrow();
    const guardado = Buffer.from(fila.contenido);
    expect(guardado.includes(Buffer.from('Contenido confidencial'))).toBe(false);
    expect(decryptBuffer(guardado).equals(PDF)).toBe(true);
  });

  it('el administrador abre el documento con un enlace temporal y recibe el archivo original', async () => {
    const { auth, id, admin } = await solicitudConCedula();
    const enlace = await request(app).get(`/api/admin/vinculaciones/${id}/documentos/cedula_rep_legal/archivo`).set(auth);
    expect(enlace.status).toBe(200);
    expect(enlace.body.url).toMatch(/^\/api\/vinculacion\/archivo\//);

    const archivo = await request(app).get(enlace.body.url).buffer(true).parse((res, cb) => {
      const trozos: Buffer[] = [];
      res.on('data', (t: Buffer) => trozos.push(t));
      res.on('end', () => cb(null, Buffer.concat(trozos)));
    });
    expect(archivo.status).toBe(200);
    expect(archivo.headers['content-type']).toContain('application/pdf');
    expect(archivo.headers['cache-control']).toContain('no-store');
    expect(Buffer.from(archivo.body).equals(PDF)).toBe(true);
    expect(await prisma.auditLog.count({ where: { accion: 'VER_DOCUMENTO_VINCULACION', userId: admin.id } })).toBe(1);
  });

  it('rechaza enlaces vencidos, inventados o firmados para otra cosa', async () => {
    const { id } = await solicitudConCedula();
    const doc = await prisma.vinculacionDocumento.findFirstOrThrow({ where: { vinculacionId: id } });

    const vencido = jwt.sign({ k: doc.storageKey, n: 'x.pdf', p: 'vinculacion-archivo' }, process.env.JWT_SECRET!, { expiresIn: -10 });
    expect((await request(app).get(`/api/vinculacion/archivo/${vencido}`)).status).toBe(401);
    expect((await request(app).get('/api/vinculacion/archivo/token-inventado')).status).toBe(401);

    // Un token de sesión normal (otro propósito) no abre archivos
    const sesion = jwt.sign({ id: 'u1', k: doc.storageKey, n: 'x.pdf' }, process.env.JWT_SECRET!, { expiresIn: 60 });
    expect((await request(app).get(`/api/vinculacion/archivo/${sesion}`)).status).toBe(401);
  });

  it('reemplazar o eliminar la solicitud borra el archivo cifrado', async () => {
    const { auth, id, token } = await solicitudConCedula();
    await request(app).post(`/api/vinculacion/${token}/documentos/cedula_rep_legal`).attach('archivo', PDF, 'nueva.pdf');
    expect(await prisma.vinculacionArchivo.count()).toBe(1);

    const res = await request(app).delete(`/api/admin/vinculaciones/${id}`).set(auth);
    expect(res.status).toBe(200);
    expect(await prisma.vinculacionArchivo.count()).toBe(0);
  });

  it('cifrado de archivos: detecta contenido alterado', () => {
    const cifrado = encryptBuffer(PDF);
    cifrado[cifrado.length - 1] ^= 0xff;
    expect(() => decryptBuffer(cifrado)).toThrow();
  });

  it('el documento con fecha también se guarda y se aprueba igual que en S3', async () => {
    const { token } = await solicitudConCedula();
    const rut = await request(app).post(`/api/vinculacion/${token}/documentos/rut`).field('fechaExpedicion', hace(3)).attach('archivo', PDF, 'rut.pdf');
    expect(rut.status).toBe(200);
    expect(await prisma.vinculacionArchivo.count()).toBe(2);
  });
});
