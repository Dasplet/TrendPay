import request from 'supertest';
import app, { prisma } from '../index';
import { limpiarBaseDeDatos, crearUsuarioDePrueba, crearSubcuentaDePrueba, tokenPara } from '../tests/testUtils';
import { parsearCsvKushki } from '../utils/importarVentas';

const CABECERA = 'ticket_number|created|merchant_id|transaction_status|transaction_type|sale_ticket_number|approved_transaction_amount|request_amount|metadata';
const q = (v: string | number) => `"${v}"`;
const fila = (o: { ticket: string; creada: string; tipo?: string; estado?: string; monto: number; venta?: string; extra?: string }) =>
  [o.ticket, o.creada, '20000000105812615000', o.estado ?? 'APPROVED', o.tipo ?? 'SALE', o.venta ?? '', o.monto, o.monto, o.extra ?? ''].map(q).join('|');
const csv = (...filas: string[]) => [CABECERA, ...filas].join('\n');

const URL = (id: string) => `/api/datafonos/admin/empresas/${id}/importar-ventas`;

describe('Importar el reporte de transacciones de Kushki (.csv)', () => {
  afterAll(async () => { await limpiarBaseDeDatos(); await prisma.config.deleteMany({ where: { clave: 'comision_datafono_pct' } }); await prisma.$disconnect(); });
  beforeEach(async () => { await limpiarBaseDeDatos(); await prisma.config.deleteMany({ where: { clave: 'comision_datafono_pct' } }); });

  async function preparar() {
    const admin = await crearUsuarioDePrueba({ rol: 'admin' });
    const e = await crearUsuarioDePrueba({ saldo: 0, nombre: 'Cool Company' });
    const sanJuan = await crearSubcuentaDePrueba(e.id, {});
    await prisma.terminalKushki.create({ data: { serial: 'P3F6P624J0101', alias: 'Caja 1', titularId: e.id, sedeId: sanJuan.id } }); // la única tienda con datáfono
    return { admin, e, sanJuan, token: tokenPara(admin) };
  }
  const subir = (token: string, id: string, texto: string, pct?: string) => {
    const r = request(app).post(URL(id)).set('Authorization', `Bearer ${token}`);
    if (pct !== undefined) r.field('comisionPct', pct);
    return r.attach('archivo', Buffer.from(texto, 'utf8'), 'reporte.csv');
  };
  const saldoDe = async (id: string) => Number((await prisma.wallet.findUnique({ where: { userId: id } }))!.saldo);
  const hoy = (hora: string) => `2026-11-20T${hora}-05:00`;

  it('lee el formato de Kushki: columnas con "|" y comillas, incluso si un campo trae comillas dentro', () => {
    const filas = parsearCsvKushki(csv(fila({ ticket: '111111111111', creada: hoy('10:00:00'), monto: 5000, extra: 'dice "hola" aquí' })));
    expect(filas).toHaveLength(1);
    expect(filas[0]).toMatchObject({ ticket_number: '111111111111', transaction_type: 'SALE', approved_transaction_amount: '5000' });
    expect(parsearCsvKushki('')).toEqual([]);
    expect(parsearCsvKushki(CABECERA)).toEqual([]);
  });

  it('acredita las ventas con la comisión vigente y conserva la fecha real de cada una', async () => {
    const { e, sanJuan, token } = await preparar();
    await prisma.config.create({ data: { clave: 'comision_datafono_pct', valor: '4' } });
    const res = await subir(token, e.id, csv(
      fila({ ticket: '111111111111', creada: hoy('10:00:00'), monto: 100000 }),
      fila({ ticket: '222222222222', creada: hoy('09:00:00'), monto: 50000 }),
    ));
    expect(res.status).toBe(200);
    expect(res.body.resumen).toMatchObject({ filas: 2, ventas: 2, reembolsos: 0, repetidas: 0, errores: 0, montoVentas: 150000 });

    expect(await saldoDe(e.id)).toBe(144000); // 150.000 menos 4%
    const cobros = await prisma.cobroDatafono.findMany({ orderBy: { createdAt: 'asc' } });
    expect(cobros.map((c) => c.createdAt.toISOString())).toEqual(['2026-11-20T14:00:00.000Z', '2026-11-20T15:00:00.000Z']);
    expect(cobros[0]).toMatchObject({ origen: 'terminal', tipo: 'cobro', userId: sanJuan.id }); // única tienda de la empresa
    const tx = await prisma.transaction.findMany({ where: { categoria: 'datafono' }, orderBy: { createdAt: 'asc' } });
    expect(tx).toHaveLength(2);
    expect(tx[0].createdAt.toISOString()).toBe('2026-11-20T14:00:00.000Z');
  });

  it('una anulación se liga a la venta que anula y descuenta el monto completo devuelto', async () => {
    const { e, token } = await preparar();
    await prisma.config.create({ data: { clave: 'comision_datafono_pct', valor: '4' } });
    // La anulación viene primero en el archivo: igual se procesa después de su venta (por fecha)
    const res = await subir(token, e.id, csv(
      fila({ ticket: '999999999999', creada: hoy('10:05:00'), tipo: 'VOID', monto: 1000, venta: '111111111111' }),
      fila({ ticket: '111111111111', creada: hoy('10:00:00'), monto: 1000 }),
      fila({ ticket: '333333333333', creada: hoy('10:01:00'), monto: 1000 }), // otra venta de $1.000 que NO se anula
    ));
    expect(res.body.resumen).toMatchObject({ ventas: 2, reembolsos: 1, montoReembolsos: 1000 });

    const original = await prisma.cobroDatafono.findFirstOrThrow({ where: { ticketNumber: '111111111111' } });
    expect(original.estado).toBe('reembolsado');
    const otra = await prisma.cobroDatafono.findFirstOrThrow({ where: { ticketNumber: '333333333333' } });
    expect(otra.estado).toBe('aprobado');
    const anulacion = await prisma.cobroDatafono.findFirstOrThrow({ where: { tipo: 'reembolso' } });
    expect(anulacion.reembolsoDeId).toBe(original.id);
    // 2 ventas netas de 960 (1.000 − 4%) y una anulación de 1.000 completos
    expect(await saldoDe(e.id)).toBe(960 + 960 - 1000);
  });

  it('repetir el mismo archivo no duplica nada', async () => {
    const { e, token } = await preparar();
    const texto = csv(
      fila({ ticket: '111111111111', creada: hoy('10:00:00'), monto: 20000 }),
      fila({ ticket: '999999999999', creada: hoy('10:05:00'), tipo: 'VOID', monto: 20000, venta: '111111111111' }),
    );
    await subir(token, e.id, texto);
    const saldo = await saldoDe(e.id);
    const segunda = await subir(token, e.id, texto);
    expect(segunda.status).toBe(200);
    expect(segunda.body.resumen).toMatchObject({ ventas: 0, reembolsos: 0, repetidas: 2 });
    expect(await saldoDe(e.id)).toBe(saldo);
    expect(await prisma.cobroDatafono.count()).toBe(2);
  });

  it('no vuelve a acreditar una venta que la sincronización ya había registrado con el mismo ticket', async () => {
    const { e, token } = await preparar();
    await subir(token, e.id, csv(fila({ ticket: '555555555555', creada: hoy('11:00:00'), monto: 10000 })));
    const antes = await saldoDe(e.id);
    // Esta vez el archivo trae la misma venta más otra nueva
    const res = await subir(token, e.id, csv(
      fila({ ticket: '555555555555', creada: hoy('11:00:00'), monto: 10000 }),
      fila({ ticket: '666666666666', creada: hoy('11:30:00'), monto: 10000 }),
    ));
    expect(res.body.resumen).toMatchObject({ ventas: 1, repetidas: 1 });
    expect(await saldoDe(e.id)).toBe(antes + 10000);
  });

  it('se puede indicar otra comisión para esa importación (0% a 20%)', async () => {
    const { e, token } = await preparar();
    await prisma.config.create({ data: { clave: 'comision_datafono_pct', valor: '4' } });
    const ok = await subir(token, e.id, csv(fila({ ticket: '111111111111', creada: hoy('10:00:00'), monto: 100000 })), '2');
    expect(ok.status).toBe(200);
    expect(await saldoDe(e.id)).toBe(98000);

    expect((await subir(token, e.id, csv(fila({ ticket: '222222222222', creada: hoy('10:00:00'), monto: 1000 })), '25')).status).toBe(400);
    expect((await subir(token, e.id, csv(fila({ ticket: '222222222222', creada: hoy('10:00:00'), monto: 1000 })), 'abc')).status).toBe(400);
  });

  it('ignora las transacciones no aprobadas y las filas sin ticket válido', async () => {
    const { e, token } = await preparar();
    const res = await subir(token, e.id, csv(
      fila({ ticket: '111111111111', creada: hoy('10:00:00'), monto: 5000, estado: 'DECLINED' }),
      fila({ ticket: 'basura', creada: hoy('10:00:00'), monto: 5000 }),
      fila({ ticket: '222222222222', creada: hoy('10:00:00'), monto: 5000 }),
    ));
    expect(res.body.resumen).toMatchObject({ filas: 3, ventas: 1, ignoradas: 2 });
    expect(await saldoDe(e.id)).toBe(5000);
  });

  it('solo la hace un administrador y valida el archivo y la empresa', async () => {
    const { e, token } = await preparar();
    const texto = csv(fila({ ticket: '111111111111', creada: hoy('10:00:00'), monto: 5000 }));
    const cliente = await crearUsuarioDePrueba({ saldo: 0 });
    expect((await subir(tokenPara(cliente), e.id, texto)).status).toBe(403);
    expect((await request(app).post(URL(e.id))).status).toBe(401);
    expect((await request(app).post(URL(e.id)).set('Authorization', `Bearer ${token}`)).status).toBe(400); // sin archivo
    expect((await subir(token, e.id, '')).status).toBe(400); // vacío
    expect((await subir(token, e.id, 'esto no es un reporte')).status).toBe(400);
    expect((await subir(token, '00000000-0000-0000-0000-000000000000', texto)).status).toBe(404);
    expect(await saldoDe(e.id)).toBe(0);
  });

  it('queda auditada', async () => {
    const { e, token } = await preparar();
    await subir(token, e.id, csv(fila({ ticket: '111111111111', creada: hoy('10:00:00'), monto: 5000 })));
    expect(await prisma.auditLog.count({ where: { accion: 'IMPORTAR_VENTAS_DATAFONO' } })).toBe(1);
  });
});
