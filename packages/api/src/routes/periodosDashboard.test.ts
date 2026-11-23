import request from 'supertest';
import app, { prisma } from '../index';
import { limpiarBaseDeDatos, crearUsuarioDePrueba, tokenPara } from '../tests/testUtils';
import { rangoDelPeriodo, construirSerie, granularidadPara, periodoDe } from '../utils/periodos';

// Miércoles 2026-11-18 15:30 en Colombia (20:30 UTC)
const AHORA = new Date('2026-11-18T20:30:00.000Z');
const bogota = (iso: string) => new Date(`${iso}-05:00`);

describe('Periodos del dashboard (hora de Colombia)', () => {
  it('calcula el inicio y el fin de cada periodo', () => {
    const r = (p: any) => rangoDelPeriodo(p, AHORA);
    expect(r('hoy').desde).toEqual(bogota('2026-11-18T00:00:00'));
    expect(r('hoy').hasta).toEqual(AHORA);
    expect(r('ayer').desde).toEqual(bogota('2026-11-17T00:00:00'));
    expect(r('ayer').hasta).toEqual(bogota('2026-11-18T00:00:00'));
    expect(r('7d').desde).toEqual(bogota('2026-11-12T00:00:00'));   // hoy y los 6 días anteriores
    expect(r('15d').desde).toEqual(bogota('2026-11-04T00:00:00'));
    expect(r('1m').desde).toEqual(bogota('2026-10-18T00:00:00'));
    expect(r('3m').desde).toEqual(bogota('2026-08-18T00:00:00'));
    expect(r('6m').desde).toEqual(bogota('2026-05-18T00:00:00'));
    expect(r('12m').desde).toEqual(bogota('2025-11-18T00:00:00'));
    expect(r('todo').desde).toBeNull();
  });

  it('"hoy" empieza a medianoche de Colombia, no del servidor (a las 02:00 UTC todavía es el día anterior)', () => {
    const r = rangoDelPeriodo('hoy', new Date('2026-11-19T02:00:00.000Z')); // 21:00 del 18 en Colombia
    expect(r.desde).toEqual(bogota('2026-11-18T00:00:00'));
  });

  it('un mes atrás respeta los meses cortos (31 de marzo → 28 de febrero)', () => {
    const r = rangoDelPeriodo('1m', new Date('2027-03-31T15:00:00.000Z'));
    expect(r.desde).toEqual(bogota('2027-02-28T00:00:00'));
  });

  it('lo que no es un periodo válido se trata como todas las operaciones', () => {
    expect(periodoDe(undefined)).toBe('todo');
    expect(periodoDe('quincena')).toBe('todo');
    expect(periodoDe('7d')).toBe('7d');
  });

  it('agrupa la gráfica según lo largo del periodo', () => {
    expect(granularidadPara(1)).toBe('hora');
    expect(granularidadPara(7)).toBe('dia');
    expect(granularidadPara(31)).toBe('dia');
    expect(granularidadPara(92)).toBe('semana');
    expect(granularidadPara(184)).toBe('mes');
  });

  it('hoy: una barra por hora hasta la hora actual; ayer: las 24 horas; las ventas caen en su hora de Colombia', () => {
    const filas = [
      { createdAt: bogota('2026-11-18T09:15:00'), volumen: 1000, comisiones: 40 },
      { createdAt: bogota('2026-11-18T09:45:00'), volumen: 500, comisiones: 20 },
      { createdAt: bogota('2026-11-18T15:10:00'), volumen: 300, comisiones: 0 },
    ];
    const hoy = construirSerie(rangoDelPeriodo('hoy', AHORA), filas);
    expect(hoy.granularidad).toBe('hora');
    expect(hoy.datos).toHaveLength(16); // 00:00 … 15:00
    expect(hoy.datos[9]).toMatchObject({ etiqueta: '09:00', volumen: 1500, comisiones: 60 });
    expect(hoy.datos[15]).toMatchObject({ etiqueta: '15:00', volumen: 300 });

    const ayer = construirSerie(rangoDelPeriodo('ayer', AHORA), []);
    expect(ayer.datos).toHaveLength(24);
    expect(ayer.datos[23].etiqueta).toBe('23:00');
  });

  it('7 días: una barra por día, con los días sin movimiento en cero', () => {
    const filas = [{ createdAt: bogota('2026-11-16T23:30:00'), volumen: 2000, comisiones: 80 }];
    const s = construirSerie(rangoDelPeriodo('7d', AHORA), filas);
    expect(s.granularidad).toBe('dia');
    expect(s.datos).toHaveLength(7);
    expect(s.datos.map((d) => d.etiqueta)).toEqual(['12 nov', '13 nov', '14 nov', '15 nov', '16 nov', '17 nov', '18 nov']);
    expect(s.datos[4]).toMatchObject({ etiqueta: '16 nov', volumen: 2000 });
    expect(s.datos.reduce((t, d) => t + d.volumen, 0)).toBe(2000);
  });

  it('3 meses: por semana (lunes); 12 meses: por mes', () => {
    const tres = construirSerie(rangoDelPeriodo('3m', AHORA), [{ createdAt: bogota('2026-11-18T10:00:00'), volumen: 100, comisiones: 0 }]);
    expect(tres.granularidad).toBe('semana');
    expect(tres.datos.at(-1)).toMatchObject({ etiqueta: '16 nov', volumen: 100 }); // el lunes de esa semana
    const doce = construirSerie(rangoDelPeriodo('12m', AHORA), [{ createdAt: bogota('2026-11-18T10:00:00'), volumen: 100, comisiones: 0 }]);
    expect(doce.granularidad).toBe('mes');
    expect(doce.datos).toHaveLength(13);
    expect(doce.datos[0].etiqueta).toBe('nov 25');
    expect(doce.datos.at(-1)).toMatchObject({ etiqueta: 'nov 26', volumen: 100 });
  });

  it('todas las operaciones: arranca en el día de la primera y se agrupa según lo que haya', () => {
    const filas = [
      { createdAt: bogota('2026-11-14T10:00:00'), volumen: 10, comisiones: 0 },
      { createdAt: bogota('2026-11-18T10:00:00'), volumen: 20, comisiones: 0 },
    ];
    const s = construirSerie(rangoDelPeriodo('todo', AHORA), filas);
    expect(s.granularidad).toBe('dia');
    expect(s.datos).toHaveLength(5);
    expect(s.datos[0]).toMatchObject({ etiqueta: '14 nov', volumen: 10 });
  });
});

describe('Dashboard del administrador por periodo (API)', () => {
  afterAll(async () => { await limpiarBaseDeDatos(); await prisma.$disconnect(); });
  beforeEach(async () => { await limpiarBaseDeDatos(); });

  let n = 0;
  async function tx(userId: string, categoria: string, monto: number, comision: number, hace: { horas?: number; dias?: number }, status = 'exitosa') {
    const wallet = await prisma.wallet.findUnique({ where: { userId } });
    n += 1;
    return prisma.transaction.create({
      data: {
        walletId: wallet!.id, userId, codigo: `TX-PER-${n}-${Math.random().toString(36).slice(2, 8)}`, categoria, descripcion: 'prueba', montoBruto: monto, comisionPct: 3,
        comisionValor: comision, montoNeto: monto - comision, saldoAntes: 0, saldoDespues: 0, status,
        createdAt: new Date(Date.now() - (hace.horas ?? 0) * 3_600_000 - (hace.dias ?? 0) * 86_400_000),
      },
    });
  }
  const get = (token: string, ruta: string) => request(app).get(`/api/admin/${ruta}`).set('Authorization', `Bearer ${token}`);

  it('las métricas del volumen, comisiones y operaciones cambian con el periodo; el saldo y los clientes no', async () => {
    const admin = await crearUsuarioDePrueba({ rol: 'admin' });
    const u = await crearUsuarioDePrueba({ saldo: 5000 });
    const token = tokenPara(admin);
    await tx(u.id, 'datafono', 100000, 4000, { horas: 0 });          // ahora
    await tx(u.id, 'consigna', 50000, 1500, { dias: 3 });            // hace 3 días
    await tx(u.id, 'envio', 20000, 600, { dias: 40 });               // hace 40 días
    await tx(u.id, 'retiro', 10000, 0, { dias: 3 }, 'fallida');      // fallida hace 3 días
    await tx(u.id, 'ajuste', 999999, 0, { horas: 0 });               // los ajustes nunca cuentan

    const todo = (await get(token, 'metrics')).body.metricas;
    expect(todo).toMatchObject({ total_volumen: 180000, total_comisiones: 6100, operaciones: 4, operaciones_exitosas: 3, periodo: 'todo' });
    expect(todo.por_tipo.datafono).toEqual({ cantidad: 1, monto: 100000 });

    const sieteDias = (await get(token, 'metrics?periodo=7d')).body.metricas;
    expect(sieteDias).toMatchObject({ total_volumen: 160000, total_comisiones: 5500, operaciones: 3, operaciones_exitosas: 2, periodo: '7d' });
    expect(sieteDias.por_tipo.envio).toBeUndefined();

    const mes = (await get(token, 'metrics?periodo=1m')).body.metricas;
    expect(mes.total_volumen).toBe(160000);
    const tresMeses = (await get(token, 'metrics?periodo=3m')).body.metricas;
    expect(tresMeses.total_volumen).toBe(180000);

    // lo que no depende del periodo
    expect(sieteDias.saldo_plataforma).toBe(todo.saldo_plataforma);
    expect(sieteDias.total_usuarios).toBe(todo.total_usuarios);
  });

  it('ayer no incluye lo de hoy, y "hoy" no incluye lo de ayer', async () => {
    const admin = await crearUsuarioDePrueba({ rol: 'admin' });
    const u = await crearUsuarioDePrueba({ saldo: 0 });
    const token = tokenPara(admin);
    const r = rangoDelPeriodo('hoy');
    const inicioHoy = r.desde!.getTime();
    const wallet = await prisma.wallet.findUnique({ where: { userId: u.id } });
    const crear = (codigo: string, monto: number, cuando: number) => prisma.transaction.create({
      data: { walletId: wallet!.id, userId: u.id, codigo, categoria: 'consigna', descripcion: 'p', montoBruto: monto, comisionPct: 0, comisionValor: 0, montoNeto: monto, saldoAntes: 0, saldoDespues: 0, status: 'exitosa', createdAt: new Date(cuando) },
    });
    await crear('TX-AYER-1', 1000, inicioHoy - 3_600_000);  // ayer 23:00
    await crear('TX-HOY-1', 7000, inicioHoy + 60_000);      // hoy 00:01 (si el reloj ya pasó de esa hora)
    const ahora = Date.now();
    const hoy = (await get(token, 'metrics?periodo=hoy')).body.metricas.total_volumen;
    const ayer = (await get(token, 'metrics?periodo=ayer')).body.metricas.total_volumen;
    expect(ayer).toBe(1000);
    expect(hoy).toBe(inicioHoy + 60_000 <= ahora ? 7000 : 0);
  });

  it('la gráfica llega ya agrupada y completa, y las transacciones y los pagos Kushki también respetan el periodo', async () => {
    const admin = await crearUsuarioDePrueba({ rol: 'admin' });
    const u = await crearUsuarioDePrueba({ saldo: 0 });
    const token = tokenPara(admin);
    await tx(u.id, 'consigna', 30000, 900, { dias: 2 });
    await tx(u.id, 'consigna', 10000, 300, { dias: 20 });
    await prisma.kushkiPayment.create({ data: { userId: u.id, reference: 'tok_reciente_1234567890', metodo: 'pse', monto: 30000, estado: 'completado' } });
    await prisma.kushkiPayment.create({ data: { userId: u.id, reference: 'tok_antiguo_1234567890', metodo: 'pse', monto: 10000, estado: 'completado', createdAt: new Date(Date.now() - 20 * 86_400_000) } });

    const grafica = (await get(token, 'dashboard-chart?periodo=7d')).body;
    expect(grafica).toMatchObject({ periodo: '7d', granularidad: 'dia' });
    expect(grafica.datos).toHaveLength(7);
    expect(grafica.datos.reduce((s: number, d: any) => s + d.volumen, 0)).toBe(30000);

    const lista = (await get(token, 'transactions?periodo=7d')).body.transacciones;
    expect(lista).toHaveLength(1);
    expect((await get(token, 'transactions')).body.transacciones).toHaveLength(2);

    const pagos = (await get(token, 'kushki/pagos?periodo=7d')).body;
    expect(pagos.pagos).toHaveLength(1);
    expect(pagos.totales).toEqual([{ estado: 'completado', cantidad: 1, monto: 30000 }]);
    expect((await get(token, 'kushki/pagos')).body.pagos).toHaveLength(2);
  });

  it('un periodo desconocido no rompe nada: muestra todas las operaciones', async () => {
    const admin = await crearUsuarioDePrueba({ rol: 'admin' });
    const u = await crearUsuarioDePrueba({ saldo: 0 });
    await tx(u.id, 'consigna', 1000, 0, { dias: 100 });
    const res = await get(tokenPara(admin), 'metrics?periodo=quincena');
    expect(res.status).toBe(200);
    expect(res.body.metricas.total_volumen).toBe(1000);
  });
});
