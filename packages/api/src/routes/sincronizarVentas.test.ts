import axios from 'axios';
import request from 'supertest';
import app, { prisma } from '../index';
import { limpiarBaseDeDatos, crearUsuarioDePrueba, crearSubcuentaDePrueba, tokenPara } from '../tests/testUtils';
import { encrypt } from '../utils/security';
import { sincronizarEmpresa } from '../utils/sincronizarVentas';

jest.mock('axios');
const http = axios as jest.Mocked<typeof axios>;

const LLAVE = 'llave-privada-de-la-branch-card-present';
let n = 0;
// Una transacción como la devuelve la consulta de Kushki (forma tomada de su documentación)
const item = (extra: Record<string, unknown> = {}) => {
  n += 1;
  return { transaction_reference: `ref-${n}-${Math.random().toString(36).slice(2)}`, ticket_number: `1117${String(n).padStart(14, '0')}`, transaction_status: 'APPROVAL', transaction_type: 'SALE', approved_transaction_amount: 50000, request_amount: 50000, created: 1795207388000 + n * 1000, merchant_id: '20000000305053342000', ...extra } as Record<string, any>;
};

describe('Sincronizar las ventas del datáfono con Kushki (sin webhook)', () => {
  afterAll(async () => { await limpiarBaseDeDatos(); await prisma.config.deleteMany({ where: { clave: { startsWith: 'ventas_pos_desde_' } } }); await prisma.config.deleteMany({ where: { clave: 'comision_datafono_pct' } }); await prisma.$disconnect(); });
  beforeEach(async () => {
    await limpiarBaseDeDatos();
    await prisma.config.deleteMany({ where: { clave: { startsWith: 'ventas_pos_desde_' } } });
    await prisma.config.deleteMany({ where: { clave: 'comision_datafono_pct' } });
    jest.resetAllMocks();
  });

  async function empresa(conLlave = true, serial = 'P3F6P624J0101') {
    const e = await crearUsuarioDePrueba({ saldo: 0, nombre: 'Cool Company' });
    if (conLlave) await prisma.comercioKushkiOne.create({ data: { userId: e.id, businessCodeCif: encrypt(LLAVE) } });
    const sanJuan = await crearSubcuentaDePrueba(e.id, {});
    await prisma.terminalKushki.create({ data: { serial, alias: 'Caja 1', titularId: e.id, sedeId: sanJuan.id } });
    return { e, sanJuan };
  }
  const respuesta = (items: object[]) => http.post.mockResolvedValue({ data: { items } });
  const saldoDe = async (id: string) => Number((await prisma.wallet.findUnique({ where: { userId: id } }))!.saldo);
  const ayer = Date.now() - 86_400_000;

  it('la primera vez solo deja constancia de "desde cuándo": no acredita ventas anteriores', async () => {
    const { e } = await empresa();
    respuesta([item()]);
    const r = await sincronizarEmpresa(e.id);
    expect(r.omitida).toContain('primera sincronización');
    expect(http.post).not.toHaveBeenCalled();
    expect(await saldoDe(e.id)).toBe(0);
    expect(await prisma.config.count({ where: { clave: `ventas_pos_desde_${e.id}` } })).toBe(1);
  });

  it('desde la segunda vez consulta con la llave privada, acredita las ventas nuevas y no las repite', async () => {
    const { e } = await empresa();
    await sincronizarEmpresa(e.id); // primera: marca
    const a = item({ approved_transaction_amount: 30000, request_amount: 30000 });
    respuesta([a, item({ approved_transaction_amount: 20000, request_amount: 20000 })]);

    const r = await sincronizarEmpresa(e.id);
    expect(r).toMatchObject({ revisadas: 2, ventas: 2, errores: 0 });
    expect(await saldoDe(e.id)).toBe(50000);

    const [url, cuerpo, opciones] = http.post.mock.calls[0] as [string, any, { headers: Record<string, string> }];
    expect(url).toBe('https://api.kushkipagos.com/pos-analytics/v1/transactions/search');
    expect(opciones.headers['Private-Credential-Id']).toBe(LLAVE);
    expect(cuerpo).toMatchObject({ page: 1, size: 500 });
    expect(cuerpo.filters.start_date).toBeLessThan(cuerpo.filters.end_date);
    expect(String(cuerpo.filters.start_date)).toHaveLength(13); // milisegundos

    // la siguiente vuelta devuelve lo mismo (Kushki publica con retraso): no se acredita dos veces
    const otra = await sincronizarEmpresa(e.id);
    expect(otra).toMatchObject({ ventas: 0, repetidas: 2 });
    expect(await saldoDe(e.id)).toBe(50000);
  });

  it('si la respuesta trae el serial del aparato asigna la venta a su tienda', async () => {
    const { e, sanJuan } = await empresa();
    await sincronizarEmpresa(e.id);
    respuesta([item({ pos_details: { terminal_id: 'P3F6P624J0101' } })]);
    const r = await sincronizarEmpresa(e.id);
    expect(r).toMatchObject({ ventas: 1, sinAparato: 0, conSerial: true });
    expect((await prisma.transaction.findFirstOrThrow({ where: { categoria: 'datafono' } })).sedeId).toBe(sanJuan.id);
  });

  it('sin serial y con UNA sola tienda, la venta es de esa tienda aunque no se sepa la caja', async () => {
    const { e, sanJuan } = await empresa();
    await prisma.terminalKushki.create({ data: { serial: 'P3F6P624J0244', alias: 'Caja 4', titularId: e.id, sedeId: sanJuan.id } });
    await sincronizarEmpresa(e.id);
    respuesta([item({ approved_transaction_amount: 1000, request_amount: 1000 })]);
    expect(await sincronizarEmpresa(e.id)).toMatchObject({ ventas: 1, sinAparato: 1 });

    const tx = await prisma.transaction.findFirstOrThrow({ where: { categoria: 'datafono' } });
    expect(tx).toMatchObject({ sedeId: sanJuan.id, userId: sanJuan.id });
    const huerfano = await prisma.terminalKushki.findFirstOrThrow({ where: { serial: { startsWith: 'SIN-IDENTIFICAR' } } });
    expect(huerfano).toMatchObject({ alias: 'Datáfono sin identificar', titularId: e.id, sedeId: sanJuan.id });
    // la tienda lo ve en su historial
    const hist = await request(app).get('/api/wallet/history').set('Authorization', `Bearer ${tokenPara(sanJuan)}`);
    expect(hist.body.transacciones.filter((t: { categoria: string }) => t.categoria === 'datafono')).toHaveLength(1);
  });

  it('con varias tiendas no se adivina: la venta queda solo para la cuenta principal', async () => {
    const { e } = await empresa();
    const norte = await crearSubcuentaDePrueba(e.id, {});
    await prisma.terminalKushki.create({ data: { serial: 'P3F6P624J0354', alias: 'Caja Norte', titularId: e.id, sedeId: norte.id } });
    await sincronizarEmpresa(e.id);
    respuesta([item()]);
    await sincronizarEmpresa(e.id);
    expect((await prisma.transaction.findFirstOrThrow({ where: { categoria: 'datafono' } })).sedeId).toBeNull();
  });

  it('las ventas que ya estaban "sin identificar" pasan a la tienda cuando se descubre que hay una sola', async () => {
    const { e, sanJuan } = await empresa();
    const norte = await crearSubcuentaDePrueba(e.id, {});
    const cajaNorte = await prisma.terminalKushki.create({ data: { serial: 'P3F6P624J0354', alias: 'Caja Norte', titularId: e.id, sedeId: norte.id } });
    await sincronizarEmpresa(e.id);
    respuesta([item()]);
    await sincronizarEmpresa(e.id);
    expect((await prisma.transaction.findFirstOrThrow({ where: { categoria: 'datafono' } })).sedeId).toBeNull();

    // el administrador quita la segunda tienda: ahora solo queda San Juan
    await prisma.terminalKushki.update({ where: { id: cajaNorte.id }, data: { activo: false } });
    respuesta([item({ approved_transaction_amount: 7000, request_amount: 7000 })]);
    await sincronizarEmpresa(e.id);
    const ventas = await prisma.transaction.findMany({ where: { categoria: 'datafono' } });
    expect(ventas).toHaveLength(2);
    expect(ventas.every((v) => v.sedeId === sanJuan.id)).toBe(true); // también la anterior
    expect(await prisma.cobroDatafono.count({ where: { userId: sanJuan.id } })).toBe(2);
  });

  it('cuando la respuesta no trae ningún serial lo avisa (para saber que no se puede asignar a una tienda)', async () => {
    const { e } = await empresa();
    await sincronizarEmpresa(e.id);
    respuesta([item()]);
    const r = await sincronizarEmpresa(e.id);
    expect(r.conSerial).toBe(false);
    // y dice qué campos trae, para poder ver si alguno identifica el aparato
    expect(r.campos).toEqual(expect.arrayContaining(['transaction_reference', 'transaction_type', 'approved_transaction_amount']));
  });

  it('los reembolsos descuentan, se ligan a la venta y no mueven dinero las rechazadas ni las autorizaciones', async () => {
    const { e } = await empresa();
    await sincronizarEmpresa(e.id);
    respuesta([
      item({ approved_transaction_amount: 40000, request_amount: 40000, created: 1795207390000 }),
      item({ transaction_type: 'REFUND', approved_transaction_amount: 40000, request_amount: 40000, created: 1795207395000 }),
      item({ transaction_status: 'DECLINED' }),
      item({ transaction_type: 'PREAUTH' }),
    ]);
    const r = await sincronizarEmpresa(e.id);
    expect(r).toMatchObject({ ventas: 1, reembolsos: 1, ignoradas: 2 });
    expect(await saldoDe(e.id)).toBe(0);
    expect((await prisma.cobroDatafono.findFirstOrThrow({ where: { tipo: 'cobro' } })).estado).toBe('reembolsado');
  });

  it('procesa primero lo más viejo: un reembolso que llega antes en la lista encuentra su venta', async () => {
    const { e } = await empresa();
    await sincronizarEmpresa(e.id);
    // Kushki devuelve lo más reciente primero
    respuesta([
      item({ transaction_type: 'REFUND', approved_transaction_amount: 25000, request_amount: 25000, created: 1795207399000 }),
      item({ approved_transaction_amount: 25000, request_amount: 25000, created: 1795207391000 }),
    ]);
    await sincronizarEmpresa(e.id);
    expect(await saldoDe(e.id)).toBe(0);
    expect((await prisma.cobroDatafono.findFirstOrThrow({ where: { tipo: 'reembolso' } })).reembolsoDeId).not.toBeNull();
  });

  it('pagina cuando hay más de 500 resultados', async () => {
    const { e } = await empresa();
    await sincronizarEmpresa(e.id);
    const pagina1 = Array.from({ length: 500 }, () => item({ transaction_status: 'DECLINED' }));
    http.post.mockResolvedValueOnce({ data: { items: pagina1 } }).mockResolvedValueOnce({ data: { items: [item()] } });
    const r = await sincronizarEmpresa(e.id);
    expect(http.post).toHaveBeenCalledTimes(2);
    expect((http.post.mock.calls[1][1] as any).page).toBe(2);
    expect(r).toMatchObject({ revisadas: 501, ventas: 1 });
  });

  it('si Kushki falla la marca no avanza y lo pendiente se reintenta; los errores de una venta no frenan las demás', async () => {
    const { e } = await empresa();
    await sincronizarEmpresa(e.id);
    const antes = (await prisma.config.findUniqueOrThrow({ where: { clave: `ventas_pos_desde_${e.id}` } })).valor;

    http.post.mockRejectedValueOnce({ message: 'Forbidden', response: { status: 403, data: { message: 'Private key inválida' } } });
    await expect(sincronizarEmpresa(e.id)).rejects.toMatchObject({ status: 403 });
    expect((await prisma.config.findUniqueOrThrow({ where: { clave: `ventas_pos_desde_${e.id}` } })).valor).toBe(antes);
    expect(await saldoDe(e.id)).toBe(0);
  });

  it('una empresa sin la llave privada no consulta nada; "desde" permite revisar hacia atrás sin duplicar', async () => {
    const sin = await empresa(false, 'P3F6P624J0999');
    expect((await sincronizarEmpresa(sin.e.id)).omitida).toContain('llave privada');
    expect(http.post).not.toHaveBeenCalled();

    const { e } = await empresa();
    respuesta([item()]);
    const r = await sincronizarEmpresa(e.id, { desdeMs: ayer });
    expect(r.ventas).toBe(1);
    const otra = await sincronizarEmpresa(e.id, { desdeMs: ayer });
    expect(otra).toMatchObject({ ventas: 0, repetidas: 1 });
  });

  it('el administrador la dispara desde el panel; solo administradores, fecha válida y empresa existente', async () => {
    const { e } = await empresa();
    const admin = tokenPara(await crearUsuarioDePrueba({ rol: 'admin' }));
    const post = (token: string, id: string, cuerpo: object = {}) => request(app).post(`/api/datafonos/admin/empresas/${id}/sincronizar`).set('Authorization', `Bearer ${token}`).send(cuerpo);

    respuesta([item()]);
    const res = await post(admin, e.id, { desde: new Date(ayer).toISOString() });
    expect(res.status).toBe(200);
    expect(res.body.resumen).toMatchObject({ ventas: 1 });
    expect(await saldoDe(e.id)).toBe(50000);

    expect((await post(admin, e.id, { desde: 'no es una fecha' })).status).toBe(400);
    expect((await post(admin, '00000000-0000-4000-8000-000000000000')).status).toBe(404);
    expect((await post(tokenPara(e), e.id)).status).toBe(403);

    http.post.mockRejectedValue({ message: 'x', response: { status: 403, data: { message: 'Forbidden', code: 'K003' } } });
    const falla = await post(admin, e.id, { desde: new Date(ayer).toISOString() });
    expect(falla.status).toBe(502);
    expect(falla.body.mensaje).toContain('[K003]');
  });

  it('convive con el webhook: la misma transacción por los dos caminos se acredita una sola vez', async () => {
    const { e } = await empresa();
    await sincronizarEmpresa(e.id);
    const a = item({ pos_details: { terminal_id: 'P3F6P624J0101' } });
    respuesta([a]);
    await sincronizarEmpresa(e.id);
    // el mismo movimiento llega ahora por el webhook (con la firma de la empresa)
    const { procesarAvisoTerminal } = await import('../utils/ventasTerminal');
    const terminal = await prisma.terminalKushki.findUniqueOrThrow({ where: { serial: 'P3F6P624J0101' } });
    expect((await procesarAvisoTerminal(terminal, a)).detalle).toContain('repetida');
    expect(await saldoDe(e.id)).toBe(50000);
  });
});
