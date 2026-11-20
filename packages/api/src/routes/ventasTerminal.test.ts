import request from 'supertest';
import app, { prisma } from '../index';
import { limpiarBaseDeDatos, crearUsuarioDePrueba, crearSubcuentaDePrueba, tokenPara } from '../tests/testUtils';
import { encrypt } from '../utils/security';
import { firmarAvisoDePrueba } from '../utils/kushkiWebhook';

const SECRETO = 'firma-de-webhooks-de-prueba';
const URL = '/api/datafonos/webhooks/tarjeta-presente';

let contador = 0;
// Aviso de Kushki por una venta o reembolso hecho en el datáfono (forma tomada de su documentación)
const aviso = (extra: Record<string, unknown> = {}) => {
  contador += 1;
  return {
    transaction_type: 'SALE', transaction_status: 'APPROVAL', transaction_reference: `ref-${contador}-${Math.random().toString(36).slice(2)}`,
    ticket_number: `1117${String(contador).padStart(14, '0')}`, approved_transaction_amount: 50000, request_amount: 50000,
    merchant_id: '20000000305053342000', channel: 'POS', pos_details: { terminal_id: 'P3F6P624J0101', brand: 'SUNMI', model: 'P3' },
    card_details: { tlv: '9F2701809F1A02' }, masked_credit_card: '545195XXXXXX5480', ...extra,
  } as Record<string, any>;
};

function enviar(cuerpo: object, opciones: { secreto?: string | null; id?: string } = {}) {
  const texto = JSON.stringify(cuerpo);
  const id = opciones.id ?? '1795207388';
  const req = request(app).post(URL).set('Content-Type', 'application/json').set('X-Kushki-Id', id);
  if (opciones.secreto !== null) req.set('X-Kushki-Signature', firmarAvisoDePrueba(texto, id, opciones.secreto ?? SECRETO));
  return req.send(texto);
}

describe('Ventas y reembolsos hechos en el datáfono (webhook de card present)', () => {
  afterAll(async () => { await limpiarBaseDeDatos(); await prisma.config.deleteMany({ where: { clave: 'comision_datafono_pct' } }); await prisma.$disconnect(); });
  beforeEach(async () => { await limpiarBaseDeDatos(); await prisma.config.deleteMany({ where: { clave: 'comision_datafono_pct' } }); });

  async function empresa(opciones: { firma?: boolean } = {}) {
    const e = await crearUsuarioDePrueba({ saldo: 0, nombre: 'Cool Company' });
    if (opciones.firma !== false) await prisma.comercioKushkiOne.create({ data: { userId: e.id, webhookSecretCif: encrypt(SECRETO) } });
    const sanJuan = await crearSubcuentaDePrueba(e.id, {});
    const norte = await crearSubcuentaDePrueba(e.id, {});
    const caja1 = await prisma.terminalKushki.create({ data: { serial: 'P3F6P624J0101', alias: 'Caja 1', titularId: e.id, sedeId: sanJuan.id } });
    const caja2 = await prisma.terminalKushki.create({ data: { serial: 'P3F6P624J0354', alias: 'Caja 2', titularId: e.id, sedeId: norte.id } });
    return { e, sanJuan, norte, caja1, caja2 };
  }
  const saldoDe = async (id: string) => Number((await prisma.wallet.findUnique({ where: { userId: id } }))!.saldo);
  const historial = async (u: { id: string; cedula: string; nombre: string; rol: string }) =>
    ((await request(app).get('/api/wallet/history').set('Authorization', `Bearer ${tokenPara(u)}`)).body.transacciones as { categoria: string; descripcion: string }[]);
  const registros = () => prisma.kushkiWebhookLog.findMany({ orderBy: { createdAt: 'desc' } });

  describe('ventas', () => {
    it('una venta aprobada acredita la billetera de la empresa y queda en la tienda del datáfono y en la cuenta principal', async () => {
      const { e, sanJuan, norte } = await empresa();
      const res = await enviar(aviso());
      expect(res.status).toBe(200);

      expect(await saldoDe(e.id)).toBe(50000);
      const tx = await prisma.transaction.findFirstOrThrow({ where: { categoria: 'datafono' } });
      expect(tx).toMatchObject({ sedeId: sanJuan.id, status: 'exitosa', userId: sanJuan.id });
      expect(Number(tx.montoNeto)).toBe(50000);
      const cobro = await prisma.cobroDatafono.findFirstOrThrow();
      expect(cobro).toMatchObject({ origen: 'terminal', tipo: 'cobro', estado: 'aprobado', userId: sanJuan.id });

      expect((await historial(e)).filter((t) => t.categoria === 'datafono')).toHaveLength(1);
      expect((await historial(sanJuan)).filter((t) => t.categoria === 'datafono')).toHaveLength(1);
      expect((await historial(norte)).filter((t) => t.categoria === 'datafono')).toHaveLength(0);
      expect(await prisma.notification.count({ where: { userId: e.id, titulo: 'Cobro con datáfono aprobado' } })).toBe(1);
    });

    it('descuenta la comisión configurada y acredita el neto', async () => {
      const { e } = await empresa();
      await prisma.config.create({ data: { clave: 'comision_datafono_pct', valor: '2.5' } });
      await enviar(aviso({ approved_transaction_amount: 40000, request_amount: 40000 }));
      expect(await saldoDe(e.id)).toBe(39000);
      const tx = await prisma.transaction.findFirstOrThrow({ where: { categoria: 'datafono' } });
      expect([Number(tx.montoBruto), Number(tx.comisionValor), Number(tx.comisionPct)]).toEqual([40000, 1000, 2.5]);
    });

    it('el mismo aviso repetido (Kushki reintenta) no acredita dos veces', async () => {
      const { e } = await empresa();
      const a = aviso();
      expect((await enviar(a)).status).toBe(200);
      expect((await enviar(a)).status).toBe(200);
      expect((await enviar(a)).status).toBe(200);
      expect(await saldoDe(e.id)).toBe(50000);
      expect(await prisma.cobroDatafono.count()).toBe(1);
      expect(await prisma.transaction.count({ where: { categoria: 'datafono' } })).toBe(1);
    });

    it('encuentra el aparato por pos_details.serial o terminal_id, y usa el monto aprobado (o el pedido si falta)', async () => {
      const { e } = await empresa();
      await enviar(aviso({ pos_details: { serial: 'P3F6P624J0354', terminal_id: 'otro-id' }, approved_transaction_amount: undefined, request_amount: 12000 }));
      expect(await saldoDe(e.id)).toBe(12000);
      expect((await prisma.transaction.findFirstOrThrow({ where: { categoria: 'datafono' } })).sedeId).toBe((await prisma.terminalKushki.findUniqueOrThrow({ where: { serial: 'P3F6P624J0354' } })).sedeId);
    });

    it('un datáfono sin tienda deja el movimiento solo en la cuenta principal', async () => {
      const { e, sanJuan } = await empresa();
      await prisma.terminalKushki.update({ where: { serial: 'P3F6P624J0101' }, data: { sedeId: null } });
      await enviar(aviso());
      expect((await prisma.transaction.findFirstOrThrow({ where: { categoria: 'datafono' } })).sedeId).toBeNull();
      expect((await historial(e)).filter((t) => t.categoria === 'datafono')).toHaveLength(1);
      expect((await historial(sanJuan)).filter((t) => t.categoria === 'datafono')).toHaveLength(0);
    });

    it('no mueve dinero: rechazadas, autorizaciones sin captura, montos inválidos y avisos sin referencia', async () => {
      const { e } = await empresa();
      for (const extra of [
        { transaction_status: 'DECLINED' },
        { transaction_type: 'PREAUTH' },
        { approved_transaction_amount: 0, request_amount: 0 },
        { transaction_reference: undefined, transactionReference: undefined, transaction_id: undefined, ticket_number: undefined },
      ]) {
        expect((await enviar(aviso(extra))).status).toBe(200);
      }
      expect(await saldoDe(e.id)).toBe(0);
      expect(await prisma.cobroDatafono.count()).toBe(0);
    });
  });

  describe('seguridad', () => {
    it('sin firma, con firma falsa o con el cuerpo alterado se rechaza con 401 y no se acredita nada', async () => {
      const { e } = await empresa();
      expect((await enviar(aviso(), { secreto: null })).status).toBe(401);
      expect((await enviar(aviso(), { secreto: 'otra-firma' })).status).toBe(401);

      // firma de un cuerpo, pero se envía otro monto
      const original = aviso({ approved_transaction_amount: 1000 });
      const alterado = JSON.stringify({ ...original, approved_transaction_amount: 9999999 });
      const res = await request(app).post(URL).set('Content-Type', 'application/json').set('X-Kushki-Id', '1795207388')
        .set('X-Kushki-Signature', firmarAvisoDePrueba(JSON.stringify(original), '1795207388', SECRETO)).send(alterado);
      expect(res.status).toBe(401);
      expect(await saldoDe(e.id)).toBe(0);
    });

    it('la firma de una empresa no sirve para acreditar en el datáfono de otra', async () => {
      const a = await empresa();
      const otra = await crearUsuarioDePrueba({ saldo: 0 });
      await prisma.comercioKushkiOne.create({ data: { userId: otra.id, webhookSecretCif: encrypt('firma-de-la-otra-empresa') } });
      await prisma.terminalKushki.create({ data: { serial: 'P3F6P624J0999', alias: 'Caja ajena', titularId: otra.id } });
      // el aviso es del aparato de la otra empresa pero está firmado con la firma de la primera
      expect((await enviar(aviso({ pos_details: { terminal_id: 'P3F6P624J0999' } }))).status).toBe(401);
      expect(await saldoDe(otra.id)).toBe(0);
      expect(await saldoDe(a.e.id)).toBe(0);
    });

    it('si la empresa todavía no tiene la firma configurada responde 503 (Kushki reintenta) y no acredita', async () => {
      const { e } = await empresa({ firma: false });
      expect((await enviar(aviso())).status).toBe(503);
      expect(await saldoDe(e.id)).toBe(0);
    });

    it('un aparato que no está registrado se responde 200 y queda en el registro con su serial, sin guardar datos del chip', async () => {
      await empresa();
      const res = await enviar(aviso({ pos_details: { terminal_id: 'SERIAL-DESCONOCIDO-1' } }));
      expect(res.status).toBe(200);
      const [log] = await registros();
      expect(log.detalle).toContain('aparato no registrado');
      expect(log.detalle).toContain('SERIAL-DESCONOCIDO-1');
      expect(JSON.stringify(log.cuerpo)).not.toContain('tlv');
      expect(JSON.stringify(log.cuerpo)).not.toContain('9F2701');
      expect(await prisma.cobroDatafono.count()).toBe(0);
    });

    it('un datáfono desactivado no acredita', async () => {
      const { e } = await empresa();
      await prisma.terminalKushki.update({ where: { serial: 'P3F6P624J0101' }, data: { activo: false } });
      expect((await enviar(aviso())).status).toBe(200);
      expect(await saldoDe(e.id)).toBe(0);
    });

    it('cada aviso queda en el registro del panel con su resultado', async () => {
      await empresa();
      await enviar(aviso());
      const [log] = await registros();
      expect(log).toMatchObject({ firmaValida: true, estadoHttp: 200 });
      expect(log.detalle).toContain('Datáfono · venta aprobada');
    });
  });

  describe('reembolsos', () => {
    it('un reembolso del mismo monto se liga a la venta, descuenta lo que se había acreditado y aparece en la tienda y en la principal', async () => {
      const { e, sanJuan, norte } = await empresa();
      await prisma.config.create({ data: { clave: 'comision_datafono_pct', valor: '2' } });
      await enviar(aviso({ approved_transaction_amount: 50000, request_amount: 50000 }));
      expect(await saldoDe(e.id)).toBe(49000); // 50.000 menos 2% de comisión

      // la comisión cambia después: el reembolso devuelve lo que se había acreditado con la comisión original
      await prisma.config.update({ where: { clave: 'comision_datafono_pct' }, data: { valor: '5' } });
      const res = await enviar(aviso({ transaction_type: 'REFUND', approved_transaction_amount: 50000, request_amount: 50000 }));
      expect(res.status).toBe(200);
      expect(await saldoDe(e.id)).toBe(0);

      const venta = await prisma.cobroDatafono.findFirstOrThrow({ where: { tipo: 'cobro' } });
      const reembolso = await prisma.cobroDatafono.findFirstOrThrow({ where: { tipo: 'reembolso' } });
      expect(venta.estado).toBe('reembolsado');
      expect(reembolso).toMatchObject({ origen: 'terminal', estado: 'aprobado', reembolsoDeId: venta.id });
      const tx = await prisma.transaction.findFirstOrThrow({ where: { categoria: 'reembolso_datafono' } });
      expect(Number(tx.montoNeto)).toBe(-49000);
      expect(tx.sedeId).toBe(sanJuan.id);

      expect((await historial(e)).filter((t) => t.categoria === 'reembolso_datafono')).toHaveLength(1);
      expect((await historial(sanJuan)).filter((t) => t.categoria === 'reembolso_datafono')).toHaveLength(1);
      expect((await historial(norte)).filter((t) => t.categoria === 'reembolso_datafono')).toHaveLength(0);
    });

    it('el mismo aviso de reembolso repetido no descuenta dos veces', async () => {
      const { e } = await empresa();
      await enviar(aviso());
      const r = aviso({ transaction_type: 'REFUND' });
      await enviar(r); await enviar(r); await enviar(r);
      expect(await saldoDe(e.id)).toBe(0);
      expect(await prisma.transaction.count({ where: { categoria: 'reembolso_datafono' } })).toBe(1);
    });

    it('un reembolso que no coincide con ninguna venta (por ejemplo parcial) igual descuenta el monto y no rompe', async () => {
      const { e } = await empresa();
      await enviar(aviso({ approved_transaction_amount: 50000, request_amount: 50000 }));
      await enviar(aviso({ transaction_type: 'REFUND', approved_transaction_amount: 20000, request_amount: 20000 }));
      expect(await saldoDe(e.id)).toBe(30000);
      const reembolso = await prisma.cobroDatafono.findFirstOrThrow({ where: { tipo: 'reembolso' } });
      expect(reembolso.reembolsoDeId).toBeNull();
      expect((await prisma.cobroDatafono.findFirstOrThrow({ where: { tipo: 'cobro' } })).estado).toBe('aprobado'); // la venta sigue en pie
    });

    it('las anulaciones (VOID) y reversos también descuentan', async () => {
      const { e } = await empresa();
      await enviar(aviso({ approved_transaction_amount: 10000, request_amount: 10000 }));
      await enviar(aviso({ transaction_type: 'VOID', approved_transaction_amount: 10000, request_amount: 10000 }));
      expect(await saldoDe(e.id)).toBe(0);
    });

    it('un reembolso rechazado no mueve dinero', async () => {
      const { e } = await empresa();
      await enviar(aviso());
      await enviar(aviso({ transaction_type: 'REFUND', transaction_status: 'DECLINED' }));
      expect(await saldoDe(e.id)).toBe(50000);
    });

    it('si el dinero ya se retiró, la billetera puede quedar en negativo (el dinero ya salió hacia el comprador)', async () => {
      const { e } = await empresa();
      await enviar(aviso());
      await prisma.wallet.update({ where: { userId: e.id }, data: { saldo: 10000 } });
      await enviar(aviso({ transaction_type: 'REFUND' }));
      expect(await saldoDe(e.id)).toBe(-40000);
    });
  });

  describe('resumen de ventas', () => {
    it('cuenta las ventas y resta los reembolsos que no se pudieron ligar; una venta reembolsada deja de contar', async () => {
      const { e } = await empresa();
      await enviar(aviso({ approved_transaction_amount: 50000, request_amount: 50000 }));  // se reembolsa completa
      await enviar(aviso({ approved_transaction_amount: 30000, request_amount: 30000 }));  // se queda
      await enviar(aviso({ transaction_type: 'REFUND', approved_transaction_amount: 50000, request_amount: 50000 })); // ligado
      await enviar(aviso({ transaction_type: 'REFUND', approved_transaction_amount: 5000, request_amount: 5000 }));   // sin venta: resta

      const res = await request(app).get('/api/datafonos/resumen?periodo=mes').set('Authorization', `Bearer ${tokenPara(e)}`);
      expect(res.status).toBe(200);
      expect(res.body.total).toMatchObject({ cobros: 1, bruto: 25000 }); // 30.000 de la venta que queda − 5.000 del reembolso suelto
    });
  });

  describe('administración de la firma', () => {
    const admin = async () => tokenPara(await crearUsuarioDePrueba({ rol: 'admin' }));

    it('el administrador guarda la firma de webhooks de una empresa; queda cifrada y no se devuelve', async () => {
      const e = await crearUsuarioDePrueba({ saldo: 0, nombre: 'Cool Company' });
      const token = await admin();
      const res = await request(app).put(`/api/datafonos/admin/empresas/${e.id}/business-code`).set('Authorization', `Bearer ${token}`).send({ webhookSecret: 'firma-secreta-de-kushki-1234' });
      expect(res.status).toBe(200);
      expect(JSON.stringify(res.body)).not.toContain('firma-secreta');
      const fila = await prisma.comercioKushkiOne.findUniqueOrThrow({ where: { userId: e.id } });
      expect(fila.webhookSecretCif).not.toContain('firma-secreta');
      expect(fila.businessCodeCif).toBeNull(); // el Business-Code ya no es obligatorio
      expect(JSON.stringify(await prisma.auditLog.findMany())).not.toContain('firma-secreta');

      const lista = await request(app).get('/api/datafonos/admin/terminales').set('Authorization', `Bearer ${token}`);
      expect(lista.body.empresas.find((x: { titularId: string }) => x.titularId === e.id)).toMatchObject({ firma: true });
      expect(JSON.stringify(lista.body)).not.toContain('firma-secreta');
    });

    it('exige al menos la firma o el Business-Code y rechaza firmas con espacios', async () => {
      const e = await crearUsuarioDePrueba({ saldo: 0 });
      const token = await admin();
      const put = (cuerpo: object) => request(app).put(`/api/datafonos/admin/empresas/${e.id}/business-code`).set('Authorization', `Bearer ${token}`).send(cuerpo);
      expect((await put({})).status).toBe(400);
      expect((await put({ webhookSecret: 'tiene espacios en medio' })).status).toBe(400);
      expect((await put({ webhookSecret: 'corta' })).status).toBe(400);
    });
  });
});
