import axios from 'axios';
import request from 'supertest';
import app, { prisma } from '../index';
import { limpiarBaseDeDatos, crearUsuarioDePrueba, crearSubcuentaDePrueba, tokenPara } from '../tests/testUtils';
import { encrypt } from '../utils/security';
import { sincronizarEmpresa, sincronizarTodas } from '../utils/sincronizarVentas';

jest.mock('axios');
const http = axios as jest.Mocked<typeof axios>;

const LLAVE_EMPRESA = 'llave-privada-de-la-empresa-12345';
const LLAVE_SAN_JUAN = 'llave-privada-san-juan-1234567';
const LLAVE_PIONEROS = 'llave-privada-pioneros-1234567';

let n = 0;
const item = (extra: Record<string, unknown> = {}) => {
  n += 1;
  return { transaction_reference: `ref-${n}-${Math.random().toString(36).slice(2)}`, ticket_number: `1118${String(n).padStart(14, '0')}`, transaction_status: 'APPROVAL', transaction_type: 'SALE', approved_transaction_amount: 50000, request_amount: 50000, created: 1795207388000 + n * 1000, ...extra } as Record<string, any>;
};

describe('Una llave de Kushki por cuenta: cada venta llega a la tienda de su propio Branch', () => {
  afterAll(async () => { await limpiarBaseDeDatos(); await prisma.config.deleteMany({ where: { clave: { startsWith: 'ventas_pos_desde_' } } }); await prisma.$disconnect(); });
  beforeEach(async () => {
    await limpiarBaseDeDatos();
    await prisma.config.deleteMany({ where: { clave: { startsWith: 'ventas_pos_desde_' } } });
    await prisma.config.deleteMany({ where: { clave: 'comision_datafono_pct' } });
    jest.resetAllMocks();
  });

  async function cool() {
    const e = await crearUsuarioDePrueba({ saldo: 0, nombre: 'Cool Company' });
    const sanJuan = await crearSubcuentaDePrueba(e.id, { nombre: 'San Juan' } as any);
    const pioneros = await crearSubcuentaDePrueba(e.id, { nombre: 'Pioneros' } as any);
    return { e, sanJuan, pioneros };
  }
  const llave = (userId: string, llaveClara: string) => prisma.comercioKushkiOne.create({ data: { userId, businessCodeCif: encrypt(llaveClara) } });
  // Kushki responde distinto según la llave con la que se pregunta (cabecera Private-Credential-Id)
  const porLlave = (respuestas: Record<string, object[]>) => http.post.mockImplementation(async (_url: string, _body?: any, config?: any) => ({ data: { items: respuestas[config?.headers?.['Private-Credential-Id']] ?? [] } }));
  const saldoDe = async (id: string) => Number((await prisma.wallet.findUnique({ where: { userId: id } }))!.saldo);
  const ahora = () => Date.now();
  const historial = async (u: { id: string; cedula: string; nombre: string; rol: string }) =>
    ((await request(app).get('/api/wallet/history').set('Authorization', `Bearer ${tokenPara(u)}`)).body.transacciones as { categoria: string }[]).filter((t) => t.categoria === 'datafono');
  const admin = async () => tokenPara(await crearUsuarioDePrueba({ rol: 'admin' }));

  it('lo que Kushki devuelve con la llave de una tienda queda en esa tienda (y no en las otras)', async () => {
    const { e, sanJuan, pioneros } = await cool();
    await llave(sanJuan.id, LLAVE_SAN_JUAN);
    await llave(pioneros.id, LLAVE_PIONEROS);
    porLlave({ [LLAVE_SAN_JUAN]: [item({ approved_transaction_amount: 30000, request_amount: 30000 })], [LLAVE_PIONEROS]: [item({ approved_transaction_amount: 70000, request_amount: 70000 })] });

    // La primera vez solo se deja constancia de "desde cuándo": se pide desde hace un rato
    const r1 = await sincronizarEmpresa(sanJuan.id, { desdeMs: ahora() - 3_600_000 });
    const r2 = await sincronizarEmpresa(pioneros.id, { desdeMs: ahora() - 3_600_000 });
    expect(r1).toMatchObject({ ventas: 1, sinAparato: 1 });
    expect(r2).toMatchObject({ ventas: 1 });

    // la billetera es una sola, de la empresa
    expect(await saldoDe(e.id)).toBe(100000);
    const txs = await prisma.transaction.findMany({ where: { categoria: 'datafono' }, orderBy: { montoBruto: 'asc' } });
    expect(txs.map((t) => [Number(t.montoBruto), t.sedeId])).toEqual([[30000, sanJuan.id], [70000, pioneros.id]]);

    // cada tienda ve solo lo suyo; la cuenta principal ve todo
    expect(await historial(sanJuan)).toHaveLength(1);
    expect(await historial(pioneros)).toHaveLength(1);
    expect(await historial(e)).toHaveLength(2);
    // cada tienda tiene su propio "datáfono sin identificar"
    const buckets = await prisma.terminalKushki.findMany({ where: { serial: { startsWith: 'SIN-IDENTIFICAR' } }, orderBy: { alias: 'asc' } });
    expect(buckets.map((b) => b.alias)).toEqual(['Datáfono sin identificar · Pioneros', 'Datáfono sin identificar · San Juan']);
    expect(buckets.every((b) => b.titularId === e.id)).toBe(true);
  });

  it('con la llave de la tienda, la venta queda en esa tienda aunque la empresa tenga otras tiendas', async () => {
    // (caso real de COOL: con dos tiendas ya no se puede adivinar; la llave propia lo resuelve)
    const { sanJuan, pioneros } = await cool();
    await prisma.terminalKushki.create({ data: { serial: 'P3F6P624J0101', alias: 'Caja 1', titularId: (await prisma.user.findUniqueOrThrow({ where: { id: sanJuan.id } })).cuentaPadreId!, sedeId: sanJuan.id } });
    await prisma.terminalKushki.create({ data: { serial: 'P3F6P624J0354', alias: 'Caja Pioneros', titularId: (await prisma.user.findUniqueOrThrow({ where: { id: pioneros.id } })).cuentaPadreId!, sedeId: pioneros.id } });
    await llave(pioneros.id, LLAVE_PIONEROS);
    // el aviso trae el serial de una caja de OTRA tienda: con la llave de Pioneros manda la llave
    porLlave({ [LLAVE_PIONEROS]: [item({ pos_details: { terminal_id: 'P3F6P624J0101' } })] });
    await sincronizarEmpresa(pioneros.id, { desdeMs: ahora() - 3_600_000 });
    const tx = await prisma.transaction.findFirstOrThrow({ where: { categoria: 'datafono' } });
    expect(tx.sedeId).toBe(pioneros.id);
  });

  it('sincronizarTodas recorre las llaves de las tiendas primero y no registra dos veces la misma venta', async () => {
    const { e, sanJuan } = await cool();
    await llave(e.id, LLAVE_EMPRESA);
    await llave(sanJuan.id, LLAVE_SAN_JUAN);
    const venta = item({ approved_transaction_amount: 40000, request_amount: 40000 });
    // La llave de la empresa también devuelve la venta de San Juan (y otra sin dueño claro)
    const otra = item({ approved_transaction_amount: 10000, request_amount: 10000 });
    porLlave({ [LLAVE_SAN_JUAN]: [venta], [LLAVE_EMPRESA]: [venta, otra] });
    await prisma.config.createMany({ data: [
      { clave: `ventas_pos_desde_${e.id}`, valor: String(ahora() - 3_600_000) },
      { clave: `ventas_pos_desde_${sanJuan.id}`, valor: String(ahora() - 3_600_000) },
    ] });
    await sincronizarTodas();
    const txs = await prisma.transaction.findMany({ where: { categoria: 'datafono' }, orderBy: { montoBruto: 'desc' } });
    expect(txs).toHaveLength(2); // la de 40.000 una sola vez
    expect(txs[0].sedeId).toBe(sanJuan.id); // la tienda gana: su llave se procesó antes
    expect(await saldoDe(e.id)).toBe(50000);
  });

  describe('administración', () => {
    const guardar = (token: string, id: string, cuerpo: object) => request(app).put(`/api/datafonos/admin/empresas/${id}/business-code`).set('Authorization', `Bearer ${token}`).send(cuerpo);

    it('el administrador guarda la llave de una tienda; se guarda cifrada y la lista la muestra dentro de su empresa', async () => {
      const { e, sanJuan, pioneros } = await cool();
      const token = await admin();
      const r = await guardar(token, sanJuan.id, { businessCode: LLAVE_SAN_JUAN });
      expect(r.status).toBe(200);
      const fila = await prisma.comercioKushkiOne.findUniqueOrThrow({ where: { userId: sanJuan.id } });
      expect(fila.businessCodeCif).not.toContain('san-juan');

      const lista = await request(app).get('/api/datafonos/admin/terminales').set('Authorization', `Bearer ${token}`);
      expect(JSON.stringify(lista.body)).not.toContain(LLAVE_SAN_JUAN);
      await prisma.terminalKushki.create({ data: { serial: 'P3F6P624J0101', alias: 'Caja 1', titularId: e.id, sedeId: sanJuan.id } });
      const lista2 = await request(app).get('/api/datafonos/admin/terminales').set('Authorization', `Bearer ${token}`);
      const empresa = lista2.body.empresas.find((x: any) => x.titularId === e.id);
      expect(empresa.sedes.map((s: any) => [s.nombre, s.configurado, s.termina, s.terminales])).toEqual(expect.arrayContaining([
        [expect.any(String), true, '…4567', 1], [expect.any(String), false, '', 0],
      ]));
      // la tienda no aparece como una empresa aparte
      expect(lista2.body.empresas.map((x: any) => x.titularId)).toEqual([e.id]);
      expect(pioneros.id).toBeDefined();
    });

    it('una empresa que solo tiene llave en sus tiendas (sin datáfonos ni llave propia) también aparece en la lista', async () => {
      const { e, sanJuan } = await cool();
      await llave(sanJuan.id, LLAVE_SAN_JUAN);
      const lista = await request(app).get('/api/datafonos/admin/terminales').set('Authorization', `Bearer ${await admin()}`);
      const empresa = lista.body.empresas.find((x: any) => x.titularId === e.id);
      expect(empresa).toBeDefined();
      expect(empresa.configurado).toBe(false);
      expect(empresa.sedes.find((s: any) => s.id === sanJuan.id)).toMatchObject({ configurado: true });
    });

    it('en una tienda no se guarda la firma de webhooks (es de la empresa) y exige la llave', async () => {
      const { sanJuan } = await cool();
      const token = await admin();
      expect((await guardar(token, sanJuan.id, { webhookSecret: 'firma-de-webhooks-123' })).status).toBe(400);
      expect((await guardar(token, sanJuan.id, { businessCode: 'corto' })).status).toBe(400);
      expect(await prisma.comercioKushkiOne.count()).toBe(0);
    });

    it('una sede de otra sede o una cuenta eliminada no pueden tener llave; solo el administrador', async () => {
      const { e, sanJuan } = await cool();
      const eliminada = await crearUsuarioDePrueba({ saldo: 0 });
      await prisma.user.update({ where: { id: eliminada.id }, data: { eliminadoAt: new Date() } });
      const token = await admin();
      expect((await guardar(token, eliminada.id, { businessCode: LLAVE_EMPRESA })).status).toBe(404);
      expect((await guardar(token, '00000000-0000-4000-8000-000000000000', { businessCode: LLAVE_EMPRESA })).status).toBe(404);
      expect((await guardar(tokenPara(e), sanJuan.id, { businessCode: LLAVE_SAN_JUAN })).status).toBe(403);
    });

    it('"Sincronizar ahora" y "Quitar" funcionan sobre una tienda', async () => {
      const { e, sanJuan } = await cool();
      const token = await admin();
      await guardar(token, sanJuan.id, { businessCode: LLAVE_SAN_JUAN });
      porLlave({ [LLAVE_SAN_JUAN]: [item({ approved_transaction_amount: 20000, request_amount: 20000 })] });
      const sync = await request(app).post(`/api/datafonos/admin/empresas/${sanJuan.id}/sincronizar`).set('Authorization', `Bearer ${token}`).send({ desde: new Date(ahora() - 3_600_000).toISOString() });
      expect(sync.status).toBe(200);
      expect(sync.body.resumen).toMatchObject({ ventas: 1 });
      expect(await saldoDe(e.id)).toBe(20000);

      expect((await request(app).delete(`/api/datafonos/admin/empresas/${sanJuan.id}/business-code`).set('Authorization', `Bearer ${token}`)).status).toBe(200);
      expect(await prisma.comercioKushkiOne.count()).toBe(0);
    });
  });
});
