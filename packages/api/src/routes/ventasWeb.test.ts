import axios from 'axios';
import request from 'supertest';
import app, { prisma } from '../index';
import { limpiarBaseDeDatos, crearUsuarioDePrueba, crearSubcuentaDePrueba, tokenPara } from '../tests/testUtils';
import { encrypt } from '../utils/security';
import { sincronizarEmpresa, sincronizarTodas } from '../utils/sincronizarVentas';
import { itemWebAAviso } from '../utils/ventasWeb';

jest.mock('axios');
const http = axios as jest.Mocked<typeof axios>;

const LLAVE_WEB = 'llave-privada-del-branch-web-12345';
const LLAVE_SAN_JUAN = 'llave-privada-san-juan-1234567';

let n = 0;
// Un pago en línea como lo devuelve la consulta de Kushki
const pago = (extra: Record<string, unknown> = {}) => {
  n += 1;
  return { ticket_number: `2229${String(n).padStart(14, '0')}`, transaction_reference: `web-${n}-${Math.random().toString(36).slice(2)}`, transaction_status: 'APPROVAL', transaction_type: 'SALE', approved_transaction_amount: 36600, created: Date.now() - 60_000, payment_method: 'card', ...extra } as Record<string, any>;
};

describe('Pagos de la página web (Kushki, tarjeta no presente) en la cuenta de la tienda en línea', () => {
  afterAll(async () => { await limpiarBaseDeDatos(); await prisma.config.deleteMany({ where: { clave: { startsWith: 'ventas_pos_desde_' } } }); await prisma.config.deleteMany({ where: { clave: 'comision_datafono_pct' } }); await prisma.$disconnect(); });
  beforeEach(async () => {
    await limpiarBaseDeDatos();
    await prisma.config.deleteMany({ where: { clave: { startsWith: 'ventas_pos_desde_' } } });
    await prisma.config.deleteMany({ where: { clave: 'comision_datafono_pct' } });
    jest.resetAllMocks();
  });

  async function cool() {
    const e = await crearUsuarioDePrueba({ saldo: 0, nombre: 'Cool Company' });
    const sanJuan = await crearSubcuentaDePrueba(e.id, { nombre: 'San Juan' } as any);
    const web = await crearSubcuentaDePrueba(e.id, { nombre: 'Página web' } as any);
    await prisma.comercioKushkiOne.create({ data: { userId: web.id, businessCodeCif: encrypt(LLAVE_WEB), canal: 'web' } });
    return { e, sanJuan, web };
  }
  const respuesta = (items: object[], forma: 'data' | 'items' | 'lista' = 'data') =>
    http.get.mockResolvedValue({ data: forma === 'lista' ? items : { [forma]: items, total: items.length } });
  const saldoDe = async (id: string) => Number((await prisma.wallet.findUnique({ where: { userId: id } }))!.saldo);
  const hace1h = () => Date.now() - 3_600_000;
  const historial = async (u: { id: string; cedula: string; nombre: string; rol: string }) =>
    ((await request(app).get('/api/wallet/history').set('Authorization', `Bearer ${tokenPara(u)}`)).body.transacciones as { categoria: string; descripcion: string }[]);

  describe('lectura de lo que devuelve Kushki', () => {
    it('acepta snake_case y camelCase, estados y tipos distintos, y montos sueltos o por partes', () => {
      expect(itemWebAAviso({ ticketNumber: '111', transactionReference: 'r1', transactionStatus: 'APPROVED', approvedTransactionAmount: 5000, createdAt: 123 }))
        .toMatchObject({ ticket_number: '111', transaction_reference: 'r1', transaction_status: 'APPROVAL', transaction_type: 'SALE', approved_transaction_amount: 5000, created: 123 });
      expect(itemWebAAviso({ ticket_number: '1', status: 'approved', type: 'charge', amount: { subtotalIva: 1000, subtotalIva0: 2000, iva: 190, ice: 0 } }))
        .toMatchObject({ transaction_status: 'APPROVAL', transaction_type: 'SALE', approved_transaction_amount: 3190 });
      expect(itemWebAAviso({ ticket_number: '1', status: 'DECLINED' }).transaction_status).toBe('DECLINED');
      expect(itemWebAAviso({ ticket_number: '2', transaction_status: 'APPROVAL', transaction_type: 'refund', sale_ticket_number: '1' })).toMatchObject({ transaction_type: 'REFUND', sale_ticket_number: '1' });
    });
  });

  describe('sincronización', () => {
    it('cada pago aprobado de la web acredita la billetera de la empresa y queda SOLO en la cuenta web, con la comisión de datáfonos', async () => {
      const { e, sanJuan, web } = await cool();
      await prisma.config.create({ data: { clave: 'comision_datafono_pct', valor: '4' } });
      respuesta([pago({ approved_transaction_amount: 36600 })]);

      const r = await sincronizarEmpresa(web.id, { desdeMs: hace1h() });
      expect(r).toMatchObject({ revisadas: 1, ventas: 1, errores: 0 });
      expect(await saldoDe(e.id)).toBe(36600 - 1464); // 4% de 36.600

      const tx = await prisma.transaction.findFirstOrThrow({ where: { categoria: 'pago_web' } });
      expect(tx).toMatchObject({ sedeId: web.id, userId: web.id, status: 'exitosa' });
      expect(tx.descripcion).toBe('Pago en la página web · Página web');
      expect(Number(tx.comisionValor)).toBe(1464);

      expect((await historial(web)).filter((t) => t.categoria === 'pago_web')).toHaveLength(1);
      expect((await historial(e)).filter((t) => t.categoria === 'pago_web')).toHaveLength(1);
      expect((await historial(sanJuan)).filter((t) => t.categoria === 'pago_web')).toHaveLength(0);
    });

    it('consulta a Kushki con la llave del Branch web (cabecera Private-Merchant-Id) y entiende distintas formas de respuesta', async () => {
      const { web } = await cool();
      for (const forma of ['data', 'items', 'lista'] as const) {
        respuesta([pago()], forma);
        const r = await sincronizarEmpresa(web.id, { desdeMs: hace1h() });
        expect(r.revisadas).toBe(1);
      }
      const [url, config] = http.get.mock.calls[0] as [string, any];
      expect(url).toBe('https://api.kushkipagos.com/analytics/v2/transactions-list');
      expect(config.headers['Private-Merchant-Id']).toBe(LLAVE_WEB);
      expect(config.params).toMatchObject({ limit: 100, offset: 0 });
      expect(typeof config.params.from).toBe('string');
    });

    it('no acredita dos veces el mismo pago y solo cuenta los aprobados', async () => {
      const { e, web } = await cool();
      const aprobado = pago({ approved_transaction_amount: 10000 });
      respuesta([aprobado, pago({ transaction_status: 'DECLINED' }), pago({ transaction_status: 'PENDING' })]);
      await sincronizarEmpresa(web.id, { desdeMs: hace1h() });
      await sincronizarEmpresa(web.id, { desdeMs: hace1h() });
      expect(await saldoDe(e.id)).toBe(10000);
      expect(await prisma.cobroDatafono.count()).toBe(1);
    });

    it('un reembolso del pago descuenta el monto completo y marca el pago como reembolsado', async () => {
      const { e, web } = await cool();
      await prisma.config.create({ data: { clave: 'comision_datafono_pct', valor: '4' } });
      const venta = pago({ approved_transaction_amount: 50000 });
      respuesta([venta, pago({ transaction_type: 'REFUND', sale_ticket_number: venta.ticket_number, approved_transaction_amount: 50000, created: Date.now() - 30_000 })]);
      const r = await sincronizarEmpresa(web.id, { desdeMs: hace1h() });
      expect(r).toMatchObject({ ventas: 1, reembolsos: 1 });
      expect(await saldoDe(e.id)).toBe(48000 - 50000); // acreditó el neto y descontó todo lo devuelto
      expect((await prisma.cobroDatafono.findFirstOrThrow({ where: { ticketNumber: venta.ticket_number } })).estado).toBe('reembolsado');
      const reembolso = await prisma.transaction.findFirstOrThrow({ where: { categoria: 'reembolso_web' } });
      expect(reembolso).toMatchObject({ sedeId: web.id });
      expect(Number(reembolso.montoNeto)).toBe(-50000);
    });

    it('conserva la hora real del pago', async () => {
      const { web } = await cool();
      const hora = Date.now() - 5 * 3_600_000;
      respuesta([pago({ created: hora })]);
      await sincronizarEmpresa(web.id, { desdeMs: hace1h() - 6 * 3_600_000 });
      expect((await prisma.transaction.findFirstOrThrow({ where: { categoria: 'pago_web' } })).createdAt.getTime()).toBe(hora);
    });

    it('la primera vez solo deja constancia de desde cuándo (no acredita lo anterior)', async () => {
      const { e, web } = await cool();
      respuesta([pago()]);
      const r = await sincronizarEmpresa(web.id);
      expect(r.omitida).toMatch(/primera sincronización/);
      expect(http.get).not.toHaveBeenCalled();
      expect(await saldoDe(e.id)).toBe(0);
    });

    it('convive con la llave de datáfonos de otra tienda: cada canal usa su propia consulta', async () => {
      const { e, sanJuan, web } = await cool();
      await prisma.comercioKushkiOne.create({ data: { userId: sanJuan.id, businessCodeCif: encrypt(LLAVE_SAN_JUAN) } }); // canal por defecto: datáfono
      http.post.mockResolvedValue({ data: { items: [{ transaction_reference: 'pos-1', ticket_number: '1117000000000001', transaction_status: 'APPROVAL', transaction_type: 'SALE', approved_transaction_amount: 20000, created: Date.now() - 60_000 }] } });
      respuesta([pago({ approved_transaction_amount: 30000 })]);
      await prisma.config.createMany({ data: [
        { clave: `ventas_pos_desde_${sanJuan.id}`, valor: String(hace1h()) }, { clave: `ventas_pos_desde_${web.id}`, valor: String(hace1h()) },
      ] });
      await sincronizarTodas();
      const txs = await prisma.transaction.findMany({ where: { categoria: { in: ['datafono', 'pago_web'] } }, orderBy: { montoBruto: 'asc' } });
      expect(txs.map((t) => [t.categoria, t.sedeId])).toEqual([['datafono', sanJuan.id], ['pago_web', web.id]]);
      expect(await saldoDe(e.id)).toBe(50000);
      expect((await historial(sanJuan)).filter((t) => t.categoria === 'pago_web')).toHaveLength(0);
      expect((await historial(web)).filter((t) => t.categoria === 'datafono')).toHaveLength(0);
    });
  });

  describe('administración', () => {
    const admin = async () => tokenPara(await crearUsuarioDePrueba({ rol: 'admin' }));

    it('el administrador marca la llave de una tienda como "página web"; la lista lo dice y los datáfonos de la tienda no cuentan la web', async () => {
      const { e, sanJuan } = await cool();
      const token = await admin();
      const r = await request(app).put(`/api/datafonos/admin/empresas/${sanJuan.id}/business-code`).set('Authorization', `Bearer ${token}`).send({ businessCode: 'llave-nueva-de-la-web-1234', canal: 'web' });
      expect(r.status).toBe(200);
      expect((await prisma.comercioKushkiOne.findUniqueOrThrow({ where: { userId: sanJuan.id } })).canal).toBe('web');
      const lista = await request(app).get('/api/datafonos/admin/terminales').set('Authorization', `Bearer ${token}`);
      const sedes = lista.body.empresas.find((x: any) => x.titularId === e.id).sedes as { id: string; canal: string }[];
      expect(sedes.find((s) => s.id === sanJuan.id)!.canal).toBe('web');
      expect((await request(app).put(`/api/datafonos/admin/empresas/${sanJuan.id}/business-code`).set('Authorization', `Bearer ${token}`).send({ businessCode: 'otra-llave-12345678', canal: 'otro' })).status).toBe(400);
    });

    it('"Sincronizar ahora" sobre la cuenta web trae los pagos; si Kushki rechaza la consulta, el mensaje llega al administrador', async () => {
      const { e, web } = await cool();
      const token = await admin();
      respuesta([pago({ approved_transaction_amount: 20000 })]);
      const ok = await request(app).post(`/api/datafonos/admin/empresas/${web.id}/sincronizar`).set('Authorization', `Bearer ${token}`).send({ desde: new Date(hace1h()).toISOString() });
      expect(ok.status).toBe(200);
      expect(ok.body.resumen).toMatchObject({ ventas: 1 });
      expect(await saldoDe(e.id)).toBe(20000);

      http.get.mockRejectedValue({ message: 'Request failed', response: { status: 400, data: { message: 'from es inválido' } } });
      const mal = await request(app).post(`/api/datafonos/admin/empresas/${web.id}/sincronizar`).set('Authorization', `Bearer ${token}`).send({ desde: new Date(hace1h()).toISOString() });
      expect(mal.status).toBe(502);
      expect(mal.body.mensaje).toMatch(/from es inválido/);
    });
  });

  it('"Mis ventas": el resumen separa datáfonos y página web, y cada cuenta ve solo lo suyo', async () => {
    const { e, sanJuan, web } = await cool();
    respuesta([pago({ approved_transaction_amount: 10000 }), pago({ approved_transaction_amount: 5000 })]);
    await sincronizarEmpresa(web.id, { desdeMs: hace1h() });
    // una venta de datáfono en San Juan
    const caja = await prisma.terminalKushki.create({ data: { serial: 'P3F6P624J0101', alias: 'Caja 1', titularId: e.id, sedeId: sanJuan.id } });
    await prisma.cobroDatafono.create({ data: { terminalId: caja.id, userId: sanJuan.id, clientTransactionId: 'terminal:x1', monto: 20000, comisionPct: 0, estado: 'aprobado', origen: 'terminal' } });
    const ver = (u: any, ruta: string) => request(app).get(`/api/datafonos/${ruta}`).set('Authorization', `Bearer ${tokenPara(u)}`);

    const principal = (await ver(e, 'resumen?periodo=7d')).body;
    expect(principal.total).toMatchObject({ cobros: 3, bruto: 35000 });
    expect(principal.porCanal.web).toMatchObject({ cobros: 2, bruto: 15000 });
    expect(principal.porCanal.datafono).toMatchObject({ cobros: 1, bruto: 20000 });
    expect(principal.tiendas.flatMap((t: any) => t.terminales).map((t: any) => t.canal).sort()).toEqual(['datafono', 'web']);

    const cuentaWeb = (await ver(web, 'resumen?periodo=7d')).body;
    expect(cuentaWeb.total).toMatchObject({ cobros: 2, bruto: 15000 });
    expect(cuentaWeb.porCanal.datafono.cobros).toBe(0);
    const cuentaSanJuan = (await ver(sanJuan, 'resumen?periodo=7d')).body;
    expect(cuentaSanJuan.total).toMatchObject({ cobros: 1, bruto: 20000 });
    expect(cuentaSanJuan.porCanal.web.cobros).toBe(0);

    // la lista de movimientos dice de dónde vino cada uno
    const movs = (await ver(web, 'cobros')).body.cobros as { canal: string }[];
    expect(movs).toHaveLength(2);
    expect(movs.every((m) => m.canal === 'web')).toBe(true);
    expect((await ver(e, 'cobros')).body.cobros.map((m: any) => m.canal).sort()).toEqual(['datafono', 'web', 'web']);
  });

  it('el dashboard del administrador cuenta los pagos web aparte de los datáfonos', async () => {
    const { web } = await cool();
    respuesta([pago({ approved_transaction_amount: 10000 })]);
    await sincronizarEmpresa(web.id, { desdeMs: hace1h() });
    const token = tokenPara(await crearUsuarioDePrueba({ rol: 'admin' }));
    const m = (await request(app).get('/api/admin/metrics').set('Authorization', `Bearer ${token}`)).body.metricas;
    expect(m.por_tipo.web).toEqual({ cantidad: 1, monto: 10000 });
    expect(m.por_tipo.datafono).toBeUndefined();
  });
});
