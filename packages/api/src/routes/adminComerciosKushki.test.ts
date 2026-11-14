import request from 'supertest';
import app, { prisma } from '../index';
import { limpiarBaseDeDatos, crearUsuarioDePrueba, crearSubcuentaDePrueba, tokenPara } from '../tests/testUtils';

jest.mock('../utils/kushki', () => {
  const actual = jest.requireActual('../utils/kushki');
  return { ...actual, getConfigTransferencias: jest.fn() };
});
import { getConfigTransferencias, KushkiError } from '../utils/kushki';
import { decrypt } from '../utils/security';

const PUBLICA = 'PUBLICAKEY1234567890ab';
const PRIVADA = 'PRIVADAKEY1234567890cd';
const BREB = { procesadores: [{ name: 'Bre-B Credibanco Processor', currency: 'COP', tipo: 'bre-b', canales: ['QR'] }], respuesta: {} };
const SIN_PROCESADORES = { procesadores: [], respuesta: { processors: [] } };

describe('Admin · crear usuarios y sedes, y mover una sede de empresa', () => {
  afterAll(async () => { await limpiarBaseDeDatos(); await prisma.$disconnect(); });
  beforeEach(async () => { await limpiarBaseDeDatos(); jest.clearAllMocks(); });

  const auth = (u: any) => ({ Authorization: `Bearer ${tokenPara(u)}` });
  const nuevo = (extra: object = {}) => ({ cedula: '9000111222', nombre: 'Sede Norte', correo: 'sede.norte@trendpay.test', pin: '4321', ...extra });
  const crear = (a: any, cuerpo: object) => request(app).post('/api/admin/users').set(auth(a)).send(cuerpo);

  it('ya no se pueden crear cuentas de administrador', async () => {
    const a = await crearUsuarioDePrueba({ rol: 'admin' });
    const res = await crear(a, nuevo({ rol: 'admin' }));
    expect(res.status).toBe(400);
    expect(res.body.mensaje).toContain('administrador');
    expect(await prisma.user.count({ where: { cedula: '9000111222' } })).toBe(0);
    // sin rol, o con rol "usuario", se crea un cliente normal
    expect((await crear(a, nuevo({ rol: 'usuario' }))).body.usuario.rol).toBe('usuario');
  });

  it('crea una sede dentro de una empresa: sin billetera propia, con sus permisos y auditada', async () => {
    const a = await crearUsuarioDePrueba({ rol: 'admin' });
    const empresa = await crearUsuarioDePrueba({ nombre: 'Cool Company SAS', saldo: 50000 });
    const res = await crear(a, nuevo({ cuentaPadreId: empresa.id, permisoVerSaldo: true, permisoRecargar: true, permisoEnviar: false, permisoRetirar: false }));
    expect(res.status).toBe(201);
    expect(res.body.mensaje).toBe('Sede creada');
    expect(res.body.usuario).toMatchObject({ rol: 'usuario', cuentaPadreId: empresa.id });

    const sede = await prisma.user.findUnique({ where: { id: res.body.usuario.id }, include: { wallet: true } });
    expect(sede).toMatchObject({ cuentaPadreId: empresa.id, permisoVerSaldo: true, permisoRecargar: true, permisoEnviar: false, permisoRetirar: false });
    expect(sede!.wallet).toBeNull();
    // el saldo de la empresa no cambia
    expect(Number((await prisma.wallet.findUnique({ where: { userId: empresa.id } }))!.saldo)).toBe(50000);
    const auditoria = await prisma.auditLog.findFirst({ where: { accion: 'CREAR_USUARIO', registroId: sede!.id } });
    expect(JSON.stringify(auditoria)).toContain(empresa.id);
    expect(JSON.stringify(auditoria)).not.toContain('4321');
  });

  it('sin cuentaPadreId crea una cuenta padre con su billetera en cero', async () => {
    const a = await crearUsuarioDePrueba({ rol: 'admin' });
    const res = await crear(a, nuevo());
    const u = await prisma.user.findUnique({ where: { id: res.body.usuario.id }, include: { wallet: true } });
    expect(u).toMatchObject({ cuentaPadreId: null, rol: 'usuario' });
    expect(Number(u!.wallet!.saldo)).toBe(0);
  });

  it('una sede solo cuelga de una empresa: no de otra sede, ni de un admin, ni de algo que no existe', async () => {
    const a = await crearUsuarioDePrueba({ rol: 'admin' });
    const empresa = await crearUsuarioDePrueba();
    const sede = await crearSubcuentaDePrueba(empresa.id);
    for (const padre of [sede.id, a.id, '00000000-0000-0000-0000-000000000000']) {
      const res = await crear(a, nuevo({ cuentaPadreId: padre }));
      expect(res.status).toBe(400);
      expect(res.body.mensaje).toContain('empresa');
    }
    expect((await crear(a, nuevo({ cuentaPadreId: 'no-es-un-uuid' }))).status).toBe(400);
    expect(await prisma.user.count({ where: { cedula: '9000111222' } })).toBe(0);
  });

  it('un usuario normal no puede crear', async () => {
    const u = await crearUsuarioDePrueba();
    expect((await crear(u, nuevo())).status).toBe(403);
  });

  describe('mover una sede a otra empresa', () => {
    const mover = (a: any, id: string, cuentaPadreId: any) => request(app).put(`/api/admin/users/${id}`).set(auth(a)).send({ cuentaPadreId });

    it('cambia la sede de empresa y queda auditado (antes y después)', async () => {
      const a = await crearUsuarioDePrueba({ rol: 'admin' });
      const e1 = await crearUsuarioDePrueba();
      const e2 = await crearUsuarioDePrueba();
      const sede = await crearSubcuentaDePrueba(e1.id);
      const res = await mover(a, sede.id, e2.id);
      expect(res.status).toBe(200);
      expect((await prisma.user.findUnique({ where: { id: sede.id } }))!.cuentaPadreId).toBe(e2.id);
      const aud = await prisma.auditLog.findFirst({ where: { accion: 'EDITAR_USUARIO', registroId: sede.id } });
      expect(aud!.datos).toMatchObject({ antes: { cuentaPadreId: e1.id }, despues: { cuentaPadreId: e2.id } });
    });

    it('no convierte en sede una cuenta con billetera propia, ni usa como empresa a una sede o a ella misma', async () => {
      const a = await crearUsuarioDePrueba({ rol: 'admin' });
      const e1 = await crearUsuarioDePrueba({ saldo: 90000 });
      const e2 = await crearUsuarioDePrueba();
      const sede = await crearSubcuentaDePrueba(e1.id);
      expect((await mover(a, e2.id, e1.id)).status).toBe(400);
      expect((await mover(a, sede.id, sede.id)).status).toBe(400);
      const otraSede = await crearSubcuentaDePrueba(e2.id);
      expect((await mover(a, sede.id, otraSede.id)).status).toBe(400);
      expect((await mover(a, sede.id, null)).status).toBe(400);
      expect((await prisma.user.findUnique({ where: { id: sede.id } }))!.cuentaPadreId).toBe(e1.id);
      expect(Number((await prisma.wallet.findUnique({ where: { userId: e2.id } }))!.saldo)).toBe(0);
    });

    it('no la mueve mientras tenga pagos o retiros en curso', async () => {
      const a = await crearUsuarioDePrueba({ rol: 'admin' });
      const e1 = await crearUsuarioDePrueba();
      const e2 = await crearUsuarioDePrueba();
      const sede = await crearSubcuentaDePrueba(e1.id);
      await prisma.kushkiPayment.create({ data: { userId: sede.id, reference: 'tok_sede_pendiente_1', metodo: 'breb', monto: 1000, estado: 'pendiente' } });
      const res = await mover(a, sede.id, e2.id);
      expect(res.status).toBe(409);
      expect((await prisma.user.findUnique({ where: { id: sede.id } }))!.cuentaPadreId).toBe(e1.id);

      await prisma.kushkiPayment.updateMany({ data: { estado: 'completado' } });
      expect((await mover(a, sede.id, e2.id)).status).toBe(200);
    });
  });
});

describe('Admin · Branches de Kushki por cliente', () => {
  afterAll(async () => { await limpiarBaseDeDatos(); await prisma.$disconnect(); });
  beforeEach(async () => { await limpiarBaseDeDatos(); jest.clearAllMocks(); });

  const admin = async () => crearUsuarioDePrueba({ rol: 'admin' });
  const auth = (u: any) => ({ Authorization: `Bearer ${tokenPara(u)}` });
  const guardar = (a: any, userId: string, cuerpo: object = {}) =>
    request(app).put(`/api/admin/kushki/comercios/${userId}`).set(auth(a)).send({ publicMerchantId: PUBLICA, privateMerchantId: PRIVADA, ...cuerpo });

  it('solo un admin puede ver o cambiar los Branches', async () => {
    const user = await crearUsuarioDePrueba();
    expect((await request(app).get('/api/admin/kushki/comercios').set(auth(user))).status).toBe(403);
    expect((await guardar(user, user.id)).status).toBe(403);
    expect((await request(app).delete(`/api/admin/kushki/comercios/${user.id}`).set(auth(user))).status).toBe(403);
  });

  describe('PUT (guardar llaves)', () => {
    it('guarda el Branch con la llave privada CIFRADA, verifica la pública y avisa si hay Bre-B', async () => {
      const a = await admin();
      const cliente = await crearUsuarioDePrueba();
      (getConfigTransferencias as jest.Mock).mockResolvedValue(BREB);

      const res = await guardar(a, cliente.id, { ambiente: 'produccion' });
      expect(res.body).toEqual({ ok: true, verificado: true, brebHabilitado: true });
      // se verificó contra el ambiente elegido y con la llave pública
      expect(getConfigTransferencias).toHaveBeenCalledWith({ publicId: PUBLICA, privateId: PRIVADA, baseUrl: 'https://api.kushkipagos.com' });

      const fila = await prisma.comercioKushki.findUnique({ where: { userId: cliente.id } });
      expect(fila!.publicMerchantId).toBe(PUBLICA);
      expect(fila!.privateMerchantIdCif).not.toContain(PRIVADA);
      expect(decrypt(fila!.privateMerchantIdCif)).toBe(PRIVADA);
      expect(fila).toMatchObject({ ambiente: 'produccion', activo: true });

      const auditoria = await prisma.auditLog.findFirst({ where: { accion: 'GUARDAR_COMERCIO_KUSHKI' } });
      expect(JSON.stringify(auditoria)).not.toContain(PRIVADA);
      expect(JSON.stringify(auditoria)).not.toContain(PUBLICA);
    });

    it('el ambiente "pruebas" verifica contra el UAT; guardar de nuevo reemplaza las llaves', async () => {
      const a = await admin();
      const cliente = await crearUsuarioDePrueba();
      (getConfigTransferencias as jest.Mock).mockResolvedValue(SIN_PROCESADORES);
      const r1 = await guardar(a, cliente.id, { ambiente: 'pruebas' });
      expect(r1.body).toEqual({ ok: true, verificado: true, brebHabilitado: false });
      expect((getConfigTransferencias as jest.Mock).mock.calls[0][0].baseUrl).toBe('https://api-uat.kushkipagos.com');

      await guardar(a, cliente.id, { publicMerchantId: 'OTRAPUBLICA1234567890ab' });
      expect(await prisma.comercioKushki.count()).toBe(1);
      expect((await prisma.comercioKushki.findUnique({ where: { userId: cliente.id } }))!.publicMerchantId).toBe('OTRAPUBLICA1234567890ab');
    });

    it('si Kushki rechaza la Public Key (401) no guarda nada', async () => {
      const a = await admin();
      const cliente = await crearUsuarioDePrueba();
      (getConfigTransferencias as jest.Mock).mockRejectedValue(new KushkiError('Unauthorized', 401));
      const res = await guardar(a, cliente.id);
      expect(res.status).toBe(400);
      expect(res.body.mensaje).toContain('Public Key');
      expect(await prisma.comercioKushki.count()).toBe(0);
    });

    it('si Kushki no responde guarda igual pero avisa que no quedó verificado', async () => {
      const a = await admin();
      const cliente = await crearUsuarioDePrueba();
      (getConfigTransferencias as jest.Mock).mockRejectedValue(new KushkiError('Kushki no respondió', 502));
      const res = await guardar(a, cliente.id);
      expect(res.body).toEqual({ ok: true, verificado: false, brebHabilitado: false });
      expect(await prisma.comercioKushki.count()).toBe(1);
    });

    it('valida el formato de las llaves', async () => {
      const a = await admin();
      const cliente = await crearUsuarioDePrueba();
      expect((await guardar(a, cliente.id, { publicMerchantId: 'corta' })).status).toBe(400);
      expect((await guardar(a, cliente.id, { privateMerchantId: 'tiene espacios y ###' })).status).toBe(400);
      expect(getConfigTransferencias).not.toHaveBeenCalled();
    });

    it('solo las cuentas padre de clientes tienen Branch (no subcuentas ni admins ni inexistentes)', async () => {
      const a = await admin();
      const padre = await crearUsuarioDePrueba();
      const hija = await crearSubcuentaDePrueba(padre.id);
      (getConfigTransferencias as jest.Mock).mockResolvedValue(BREB);
      expect((await guardar(a, hija.id)).status).toBe(404);
      expect((await guardar(a, a.id)).status).toBe(404);
      expect((await guardar(a, '00000000-0000-0000-0000-000000000000')).status).toBe(404);
    });
  });

  describe('GET (lista de las cuentas)', () => {
    it('lista solo cuentas padre con su estado de Branch, busca y nunca devuelve llaves completas', async () => {
      const a = await admin();
      const conBranch = await crearUsuarioDePrueba({ nombre: 'Cool Company SAS' });
      await crearUsuarioDePrueba({ nombre: 'Otra Empresa SAS' });
      await crearSubcuentaDePrueba(conBranch.id);
      (getConfigTransferencias as jest.Mock).mockResolvedValue(BREB);
      await guardar(a, conBranch.id);

      const res = await request(app).get('/api/admin/kushki/comercios').set(auth(a));
      expect(res.body).toMatchObject({ ok: true, total: 2, configurados: 1 });
      const fila = res.body.cuentas.find((c: any) => c.userId === conBranch.id);
      expect(fila.comercio).toMatchObject({ activo: true, ambiente: 'produccion', publicTermina: '…90ab' });
      expect(res.body.cuentas.find((c: any) => c.userId !== conBranch.id).comercio).toBeNull();
      expect(JSON.stringify(res.body)).not.toContain(PRIVADA);
      expect(JSON.stringify(res.body)).not.toContain(PUBLICA);

      const busqueda = await request(app).get('/api/admin/kushki/comercios?q=cool').set(auth(a));
      expect(busqueda.body.total).toBe(1);
      expect(busqueda.body.cuentas[0].nombre).toBe('Cool Company SAS');
    });

    it('cada empresa trae sus sedes (subcuentas) debajo, y buscar una sede muestra su empresa', async () => {
      const a = await admin();
      const empresa = await crearUsuarioDePrueba({ nombre: 'Cool Company SAS' });
      const sedeNorte = await crearSubcuentaDePrueba(empresa.id, { permisoRecargar: false });
      await prisma.user.update({ where: { id: sedeNorte.id }, data: { nombre: 'Sede Norte' } });
      const sedeSur = await crearSubcuentaDePrueba(empresa.id);
      await prisma.user.update({ where: { id: sedeSur.id }, data: { nombre: 'Sede Sur' } });
      await crearUsuarioDePrueba({ nombre: 'Otra Empresa SAS' });

      const res = await request(app).get('/api/admin/kushki/comercios').set(auth(a));
      // las sedes NO aparecen como filas propias: solo debajo de su empresa
      expect(res.body.total).toBe(2);
      const fila = res.body.cuentas.find((c: any) => c.userId === empresa.id);
      expect(fila.subcuentas.map((s: any) => s.nombre)).toEqual(['Sede Norte', 'Sede Sur']);
      expect(fila.subcuentas[0]).toMatchObject({ userId: sedeNorte.id, puedeRecargar: false, bloqueada: false });
      expect(fila.subcuentas[1].puedeRecargar).toBe(true);
      expect(res.body.cuentas.find((c: any) => c.userId !== empresa.id).subcuentas).toEqual([]);
      expect(JSON.stringify(res.body)).not.toContain('pinHash');

      const porSede = await request(app).get('/api/admin/kushki/comercios?q=sede%20sur').set(auth(a));
      expect(porSede.body.total).toBe(1);
      expect(porSede.body.cuentas[0]).toMatchObject({ userId: empresa.id, nombre: 'Cool Company SAS' });
    });

    it('con todos=1 (pantalla de Usuarios) incluye admins y los datos de cada cuenta y sede', async () => {
      const a = await admin();
      const empresa = await crearUsuarioDePrueba({ nombre: 'Cool Company SAS', saldo: 150000 });
      const sede = await crearSubcuentaDePrueba(empresa.id);

      const soloClientes = await request(app).get('/api/admin/kushki/comercios').set(auth(a));
      expect(soloClientes.body.cuentas.map((c: any) => c.userId)).toEqual([empresa.id]);

      const todos = await request(app).get('/api/admin/kushki/comercios?todos=1').set(auth(a));
      expect(todos.body.total).toBe(2);
      expect(todos.body.cuentas.map((c: any) => c.userId).sort()).toEqual([a.id, empresa.id].sort());
      const fila = todos.body.cuentas.find((c: any) => c.userId === empresa.id);
      // los mismos datos que usan las acciones de Usuarios (ver, editar, bloquear, eliminar)
      expect(fila).toMatchObject({ id: empresa.id, saldo: 150000, rol: 'usuario', bloqueado: false, kycNivel: 1 });
      expect(fila.subcuentas[0]).toMatchObject({ id: sede.id, userId: sede.id, rol: 'usuario', bloqueada: false });
      expect(JSON.stringify(todos.body)).not.toContain('pinHash');
    });

    it('pagina para manejar más de 100 cuentas', async () => {
      const a = await admin();
      await prisma.user.createMany({ data: Array.from({ length: 120 }, (_, i) => ({
        cedula: `P${String(i).padStart(9, '0')}`, nombre: `Cliente ${String(i).padStart(3, '0')}`, correo: `p${i}@trendpay.test`, pinHash: 'x',
      })) });
      const p1 = await request(app).get('/api/admin/kushki/comercios?limit=100&page=1').set(auth(a));
      const p2 = await request(app).get('/api/admin/kushki/comercios?limit=100&page=2').set(auth(a));
      expect(p1.body.total).toBe(120);
      expect(p1.body.cuentas).toHaveLength(100);
      expect(p2.body.cuentas).toHaveLength(20);
    });
  });

  describe('verificar y quitar', () => {
    it('verifica el Branch guardado con SUS llaves y su ambiente', async () => {
      const a = await admin();
      const cliente = await crearUsuarioDePrueba();
      (getConfigTransferencias as jest.Mock).mockResolvedValue(BREB);
      await guardar(a, cliente.id);
      (getConfigTransferencias as jest.Mock).mockClear();

      const res = await request(app).post(`/api/admin/kushki/comercios/${cliente.id}/verificar`).set(auth(a));
      expect(res.body).toMatchObject({ ok: true, brebHabilitado: true, entorno: { urlBase: 'https://api.kushkipagos.com', llavePublicaTermina: '…90ab' } });
      expect(getConfigTransferencias).toHaveBeenCalledWith({ publicId: PUBLICA, privateId: PRIVADA, baseUrl: 'https://api.kushkipagos.com' });
      expect(JSON.stringify(res.body)).not.toContain(PRIVADA);

      const sin = await crearUsuarioDePrueba();
      expect((await request(app).post(`/api/admin/kushki/comercios/${sin.id}/verificar`).set(auth(a))).status).toBe(404);
    });

    it('quitar: borra el Branch, pero no si hay QR pendientes que necesitan esas llaves', async () => {
      const a = await admin();
      const cliente = await crearUsuarioDePrueba();
      (getConfigTransferencias as jest.Mock).mockResolvedValue(BREB);
      await guardar(a, cliente.id);
      const branch = await prisma.comercioKushki.findUnique({ where: { userId: cliente.id } });
      const pago = await prisma.kushkiPayment.create({ data: { userId: cliente.id, reference: 'tok_pend_branch_01', metodo: 'breb', monto: 1000, estado: 'pendiente', comercioId: branch!.id } });

      const bloqueado = await request(app).delete(`/api/admin/kushki/comercios/${cliente.id}`).set(auth(a));
      expect(bloqueado.status).toBe(409);
      expect(await prisma.comercioKushki.count()).toBe(1);

      await prisma.kushkiPayment.update({ where: { id: pago.id }, data: { estado: 'completado' } });
      expect((await request(app).delete(`/api/admin/kushki/comercios/${cliente.id}`).set(auth(a))).body).toEqual({ ok: true });
      expect(await prisma.comercioKushki.count()).toBe(0);
      // el historial del pago se conserva, solo pierde el vínculo
      expect((await prisma.kushkiPayment.findUnique({ where: { id: pago.id } }))!.comercioId).toBeNull();
      expect(await prisma.auditLog.count({ where: { accion: 'QUITAR_COMERCIO_KUSHKI' } })).toBe(1);
    });
  });
});
