import request from 'supertest';
import app, { prisma } from '../index';
import { limpiarBaseDeDatos, crearUsuarioDePrueba, crearSubcuentaDePrueba, tokenPara } from '../tests/testUtils';
import { parsearCsvKushki, canalDeFila } from '../utils/importarVentas';

const URL = (id: string) => `/api/datafonos/admin/empresas/${id}/importar-ventas`;

// Reporte real de Kushki de la página web (pagos en línea): una tarjeta aprobada, una tarjeta rechazada sin número de ticket,
// un PSE aprobado y un PSE rechazado. Es el formato exacto de la consola: columnas separadas por "|" y metadata con comillas dentro.
const CABECERA = 'ticket_number|approval_code|payment_method|payment_submethod_type|channel|created|merchant_id|merchant_name|response_code|response_text|transaction_status|card_country|card_holder_name|payment_brand|transaction_type|currency_code|sale_ticket_number|masked_credit_card|approved_transaction_amount|subtotal_iva|subtotal_iva0|ice_value|iva_value|taxes|number_of_months|metadata|subscription_id|subscription_metadata|bank_name|document_number|retry|retry_count|processor_name|recap|pin|client_name|identification|issuing_bank|security_code|security_message|card_type|acquirer_bank|request_amount|processor_code|processor_message|processor_payment_point|transaction_card_id|transaction_cycle|email|phone_number|completed|principal_ticket_code|transaction_sub_type|installment_count|principal_amount';
const TARJETA_WEB = '"821795521458690131"|"065738"|"card"|"CARD NO PRESENT"||"2026-11-24T06:57:38-05:00"|"20000000100799795000"|"COOL COMPANY"|"000"|"Approved or completed successfully."|"APPROVED"|"Colombia"|"Sara Grisales"|"Mastercard"|"SALE"|"COP"|""|"530691XXXXXX6761"|"65300"|"54874"|"0"||"10426"||"0"|"{"smartlinkId":"QBhwUnJ8E","paymentId":"roNOQNkjulRDGST80huxayQ7i","id":"736dabef-2b22-4e34-ac3a-84d9f1c48c98","activationMethod":"singlePayment"}"|""|||""|||"Kushki Acquirer Processor"|"632811150235"|""|||"Bancolombia S.A."|""|""|"debit"|"Kushki"|"65300"|"000"|"Approved or completed successfully."|""|"d7a07f38-9498-437b-8501-5bb80679cc30"||"sygalo98@gmail.com"|""|"2026-11-24T06:57:38-05:00"|""|""|""|"0"';
const TARJETA_RECHAZADA = '""||"card"|"CARD NO PRESENT"||"2026-11-24T00:47:41-05:00"|"20000000100799795000"|"COOL COMPANY"|"K322"|"Transacción rechazada."|"DECLINED"|"Kazakhstan"|"Jorge mayorca"|"Mastercard"|"SALE"|"COP"|""|"526988XXXXXX6626"|"0"|"75126"|"0"||"14274"||"0"|"{"smartlinkId":"oqNko6Ind"}"|""|||""|||"Kushki Acquirer Processor"|""|""|||"Freedom Bank Kazakhstan JSC"|"K322"|"GL_B_CO_CANCEL_INTERNATIONAL_BIN"|"credit"|"Kushki"|"89400"|""|""|""|"1fcdb1d1-0d21-40ce-8fa3-1df861f69ed3"||"jorgem010x@gmail.com"|""|"2026-11-24T00:47:41-05:00"|""|""|""|"0"';
const PSE_APROBADO = '"5472389924399505"|"854102555"|"transfer"|"TRANSFER IN"||"2026-11-23T17:19:47-05:00"|"20000000100799795000"|"COOL COMPANY"|"OK"|"OK"|"APPROVED"|""||"PSE Avanza"|"SALE"|"COP"|""|"XXXXXX"|"130160"|"109378"|"0"||"20782"||"0"|"{"smartlinkId":"i6kS3qx3n","name":null,"email":"ihquezc@hotmail.com"}"|""|||"1152446854"|||"ACH Processor"|""|""|||""|""|""||""|"130160"|""|""|""|""||"ihquezc@hotmail.com"|""|"2026-11-23T17:21:24-05:00"|""|""|""|"0"';
const PSE_RECHAZADO = '"5451549727117684"|"853058849"|"transfer"|"TRANSFER IN"||"2026-11-23T11:32:27-05:00"|"20000000100799795000"|"COOL COMPANY"|"NOT_AUTHORIZED"|""|"DECLINED"|""||"PSE Avanza"|"SALE"|"COP"|""|"XXXXXX"|"70800"|"59496"|"0"||"11304"||"0"|"{"smartlinkId":"ZKGqA6h43"}"|""|||"3146035645"|||"ACH Processor"|""|""|||""|""|""||""|"70800"|"00001"|"CANCELACIÓN DEL PAGO POR PARTE DEL CLIENTE"|""|""||"ospinaescob74141@gmail.com"|""|"2026-11-23T11:42:21-05:00"|""|""|""|"0"';
const reporteWeb = [CABECERA, TARJETA_WEB, TARJETA_RECHAZADA, PSE_APROBADO, PSE_RECHAZADO].join('\n');

// Reporte corto de datáfonos (card present) con una venta y su anulación
const CAB_POS = 'ticket_number|created|merchant_id|payment_submethod_type|transaction_status|transaction_type|sale_ticket_number|approved_transaction_amount|request_amount';
const filaPos = (ticket: string, creada: string, tipo: string, monto: number, venta = '') => [ticket, creada, '20000000105812615000', 'CARD PRESENT', 'APPROVED', tipo, venta, monto, monto].map((v) => `"${v}"`).join('|');

describe('Importar el reporte de transacciones de Kushki (.csv)', () => {
  afterAll(async () => { await limpiarBaseDeDatos(); await prisma.config.deleteMany({ where: { clave: 'comision_datafono_pct' } }); await prisma.$disconnect(); });
  beforeEach(async () => { await limpiarBaseDeDatos(); await prisma.config.deleteMany({ where: { clave: 'comision_datafono_pct' } }); });

  async function preparar() {
    const admin = await crearUsuarioDePrueba({ rol: 'admin' });
    const e = await crearUsuarioDePrueba({ saldo: 0, nombre: 'Cool Company' });
    const sanJuan = await crearSubcuentaDePrueba(e.id, { nombre: 'San Juan' } as any);
    const web = await crearSubcuentaDePrueba(e.id, { nombre: 'Página web' } as any);
    return { admin, e, sanJuan, web, token: tokenPara(admin) };
  }
  const subir = (token: string, id: string, texto: string, pct?: string) => {
    const r = request(app).post(URL(id)).set('Authorization', `Bearer ${token}`);
    if (pct !== undefined) r.field('comisionPct', pct);
    return r.attach('archivo', Buffer.from(texto, 'utf8'), 'reporte.csv');
  };
  const saldoDe = async (id: string) => Number((await prisma.wallet.findUnique({ where: { userId: id } }))!.saldo);
  const historial = async (u: { id: string; cedula: string; nombre: string; rol: string }) =>
    ((await request(app).get('/api/wallet/history').set('Authorization', `Bearer ${tokenPara(u)}`)).body.transacciones as { categoria: string }[]);

  it('lee el formato de Kushki: columnas con "|" y comillas, incluso con JSON con comillas dentro de la metadata', () => {
    const filas = parsearCsvKushki(reporteWeb);
    expect(filas).toHaveLength(4);
    expect(filas[0]).toMatchObject({ ticket_number: '821795521458690131', transaction_status: 'APPROVED', approved_transaction_amount: '65300', payment_submethod_type: 'CARD NO PRESENT' });
    expect(filas[1].ticket_number).toBe('');
    expect(filas[2]).toMatchObject({ payment_method: 'transfer', approved_transaction_amount: '130160' });
    expect(parsearCsvKushki('')).toEqual([]);
  });

  it('reconoce de dónde viene cada fila: datáfono, tarjeta no presente, PSE o efectivo', () => {
    expect(canalDeFila({ payment_submethod_type: 'CARD PRESENT' })).toBe('datafono');
    expect(canalDeFila({ payment_submethod_type: 'CARD NO PRESENT' })).toBe('web');
    expect(canalDeFila({ payment_submethod_type: 'TRANSFER IN' })).toBe('web');
    expect(canalDeFila({ payment_method: 'cash' })).toBe('web');
    expect(canalDeFila({})).toBe('datafono');
  });

  it('el reporte de la página web acredita los pagos aprobados a la cuenta web, con la comisión de datáfonos y la hora real', async () => {
    const { e, sanJuan, web, token } = await preparar();
    await prisma.config.create({ data: { clave: 'comision_datafono_pct', valor: '4' } });
    const res = await subir(token, web.id, reporteWeb);
    expect(res.status).toBe(200);
    expect(res.body.resumen).toMatchObject({ filas: 4, ventas: 2, ventasWeb: 2, ventasDatafono: 0, reembolsos: 0, errores: 0, montoVentas: 195460, ignoradas: 2 });

    // 65.300 − 4% (2.612) + 130.160 − 4% (5.206)
    expect(await saldoDe(e.id)).toBe(62688 + 124954);
    const txs = await prisma.transaction.findMany({ where: { categoria: 'pago_web' }, orderBy: { createdAt: 'asc' } });
    expect(txs.map((t) => [Number(t.montoBruto), t.sedeId, t.createdAt.toISOString()])).toEqual([
      [130160, web.id, '2026-11-23T22:19:47.000Z'], [65300, web.id, '2026-11-24T11:57:38.000Z'],
    ]);
    expect(txs[0].descripcion).toBe('Pago en la página web · Página web');

    // solo la cuenta web y la principal lo ven
    expect((await historial(web)).filter((t) => t.categoria === 'pago_web')).toHaveLength(2);
    expect((await historial(e)).filter((t) => t.categoria === 'pago_web')).toHaveLength(2);
    expect((await historial(sanJuan)).filter((t) => t.categoria === 'pago_web')).toHaveLength(0);
  });

  it('volver a subir el mismo reporte no duplica nada', async () => {
    const { e, web, token } = await preparar();
    await subir(token, web.id, reporteWeb);
    const saldo = await saldoDe(e.id);
    const otra = await subir(token, web.id, reporteWeb);
    expect(otra.body.resumen).toMatchObject({ ventas: 0, repetidas: 2 });
    expect(await saldoDe(e.id)).toBe(saldo);
    expect(await prisma.cobroDatafono.count()).toBe(2);
  });

  it('un reporte mezclado: lo de datáfono va al "sin identificar" de la tienda y lo de la web a la cuenta web, según lo que dice cada fila', async () => {
    const { e, sanJuan, token } = await preparar();
    // se acredita todo a San Juan: la fila de datáfono queda en su "sin identificar" y las de la web en su terminal web
    const res = await subir(token, sanJuan.id, [CAB_POS, filaPos('333300000001', '2026-11-23T10:00:00-05:00', 'SALE', 20000)].join('\n'));
    expect(res.body.resumen).toMatchObject({ ventas: 1, ventasDatafono: 1, ventasWeb: 0 });
    const tx = await prisma.transaction.findFirstOrThrow({ where: { categoria: 'datafono' } });
    expect(tx.sedeId).toBe(sanJuan.id);
    const buckets = await prisma.terminalKushki.findMany({ where: { serial: { startsWith: 'SIN-IDENTIFICAR' } } });
    expect(buckets.map((b) => b.sedeId)).toEqual([sanJuan.id]);

    const web = await subir(token, sanJuan.id, reporteWeb);
    expect(web.body.resumen).toMatchObject({ ventasWeb: 2 });
    expect(await prisma.transaction.count({ where: { categoria: 'pago_web', sedeId: sanJuan.id } })).toBe(2);
    expect(await saldoDe(e.id)).toBeGreaterThan(0);
  });

  it('una anulación se liga a su venta por el ticket y descuenta el monto completo', async () => {
    const { e, sanJuan, token } = await preparar();
    await prisma.config.create({ data: { clave: 'comision_datafono_pct', valor: '4' } });
    const res = await subir(token, sanJuan.id, [
      CAB_POS,
      filaPos('999900000009', '2026-11-23T10:05:00-05:00', 'VOID', 1000, '111100000001'), // la anulación viene primero en el archivo
      filaPos('111100000001', '2026-11-23T10:00:00-05:00', 'SALE', 1000),
    ].join('\n'));
    expect(res.body.resumen).toMatchObject({ ventas: 1, reembolsos: 1, montoReembolsos: 1000 });
    expect((await prisma.cobroDatafono.findFirstOrThrow({ where: { ticketNumber: '111100000001' } })).estado).toBe('reembolsado');
    expect(await saldoDe(e.id)).toBe(960 - 1000);
  });

  it('se puede indicar otra comisión para esa importación (0% a 20%)', async () => {
    const { e, web, token } = await preparar();
    await prisma.config.create({ data: { clave: 'comision_datafono_pct', valor: '4' } });
    const ok = await subir(token, web.id, reporteWeb, '2');
    expect(ok.status).toBe(200);
    expect(await saldoDe(e.id)).toBe(195460 - 1306 - 2603); // 2% de cada pago (2.603,2 → 2.603)
    expect((await subir(token, web.id, reporteWeb, '25')).status).toBe(400);
    expect((await subir(token, web.id, reporteWeb, 'abc')).status).toBe(400);
  });

  it('solo la hace un administrador y valida el archivo y la cuenta; queda auditada', async () => {
    const { e, web, token } = await preparar();
    const cliente = await crearUsuarioDePrueba({ saldo: 0 });
    expect((await subir(tokenPara(cliente), web.id, reporteWeb)).status).toBe(403);
    expect((await request(app).post(URL(web.id))).status).toBe(401);
    expect((await request(app).post(URL(web.id)).set('Authorization', `Bearer ${token}`)).status).toBe(400); // sin archivo
    expect((await subir(token, web.id, '')).status).toBe(400);
    expect((await subir(token, web.id, 'esto no es un reporte')).status).toBe(400);
    expect((await subir(token, '00000000-0000-0000-0000-000000000000', reporteWeb)).status).toBe(404);
    expect(await saldoDe(e.id)).toBe(0);

    await subir(token, web.id, reporteWeb);
    expect(await prisma.auditLog.count({ where: { accion: 'IMPORTAR_VENTAS_KUSHKI' } })).toBe(1);
  });
});
