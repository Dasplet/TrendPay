import axios from 'axios';
import request from 'supertest';
import app, { prisma } from '../index';
import { limpiarBaseDeDatos, crearUsuarioDePrueba, crearSubcuentaDePrueba, tokenPara } from '../tests/testUtils';
import { encrypt } from '../utils/security';
import { sincronizarTodas } from '../utils/sincronizarVentas';
import { comisionDatafonoDeEmpresa } from '../utils/datafonos';
import { procesarAvisoTerminal } from '../utils/ventasTerminal';

jest.mock('axios');
const http = axios as jest.Mocked<typeof axios>;

let n = 0;
const venta = (monto: number, extra: Record<string, unknown> = {}) => {
  n += 1;
  return { transaction_reference: `multi-${n}-${Math.random().toString(36).slice(2)}`, ticket_number: `3331${String(n).padStart(14, '0')}`, transaction_status: 'APPROVAL', transaction_type: 'SALE', approved_transaction_amount: monto, request_amount: monto, created: Date.now() - 60_000, ...extra } as Record<string, any>;
};

describe('Varias empresas a la vez', () => {
  afterAll(async () => { await limpiarBaseDeDatos(); await prisma.config.deleteMany({ where: { OR: [{ clave: { startsWith: 'ventas_pos_desde_' } }, { clave: { startsWith: 'comision_datafono_pct' } }] } }); await prisma.$disconnect(); });
  beforeEach(async () => {
    await limpiarBaseDeDatos();
    await prisma.config.deleteMany({ where: { OR: [{ clave: { startsWith: 'ventas_pos_desde_' } }, { clave: { startsWith: 'comision_datafono_pct' } }] } });
    jest.resetAllMocks();
  });

  const admin = async () => tokenPara(await crearUsuarioDePrueba({ rol: 'admin' }));
  async function empresaConCaja(nombre: string, serial: string, llave?: string) {
    const e = await crearUsuarioDePrueba({ saldo: 0, nombre });
    const tienda = await crearSubcuentaDePrueba(e.id, {});
    const caja = await prisma.terminalKushki.create({ data: { serial, alias: `Caja de ${nombre}`, titularId: e.id, sedeId: tienda.id } });
    if (llave) await prisma.comercioKushkiOne.create({ data: { userId: e.id, businessCodeCif: encrypt(llave) } });
    return { e, tienda, caja };
  }
  const saldoDe = async (id: string) => Number((await prisma.wallet.findUnique({ where: { userId: id } }))!.saldo);

  describe('comisión de datáfonos por empresa', () => {
    it('cada empresa usa la suya; la que no tiene propia usa la general', async () => {
      await prisma.config.create({ data: { clave: 'comision_datafono_pct', valor: '4' } });
      const a = await empresaConCaja('Empresa A', 'SN-A-0001');
      const b = await empresaConCaja('Empresa B', 'SN-B-0001');
      const c = await empresaConCaja('Empresa C', 'SN-C-0001');
      const token = await admin();
      const poner = (id: string, comisionPct: number | null) => request(app).put(`/api/datafonos/admin/empresas/${id}/comision`).set('Authorization', `Bearer ${token}`).send({ comisionPct });
      expect((await poner(a.e.id, 2)).body).toMatchObject({ ok: true, comisionPropia: 2, efectiva: 2 });
      expect((await poner(b.e.id, 0)).body).toMatchObject({ comisionPropia: 0, efectiva: 0 }); // 0% es una comisión válida, no "sin definir"

      for (const x of [a, b, c]) await procesarAvisoTerminal(x.caja, venta(100000));
      expect(await saldoDe(a.e.id)).toBe(98000);   // 2% propio
      expect(await saldoDe(b.e.id)).toBe(100000);  // 0% propio
      expect(await saldoDe(c.e.id)).toBe(96000);   // la general, 4%
      expect(await comisionDatafonoDeEmpresa(c.e.id)).toBe(4);

      // volver a la general
      expect((await poner(a.e.id, null)).body).toMatchObject({ comisionPropia: null, efectiva: 4 });
      await procesarAvisoTerminal(a.caja, venta(100000));
      expect(await saldoDe(a.e.id)).toBe(98000 + 96000);
    });

    it('la lista de empresas dice cuál comisión propia tiene cada una', async () => {
      const a = await empresaConCaja('Empresa A', 'SN-A-0001');
      const b = await empresaConCaja('Empresa B', 'SN-B-0001');
      const token = await admin();
      await request(app).put(`/api/datafonos/admin/empresas/${a.e.id}/comision`).set('Authorization', `Bearer ${token}`).send({ comisionPct: 1.5 });
      const lista = (await request(app).get('/api/datafonos/admin/terminales').set('Authorization', `Bearer ${token}`)).body.empresas as { titularId: string; comisionPropia: number | null }[];
      expect(lista.find((x) => x.titularId === a.e.id)!.comisionPropia).toBe(1.5);
      expect(lista.find((x) => x.titularId === b.e.id)!.comisionPropia).toBeNull();
    });

    it('valida el rango, solo para empresas y solo el administrador; queda auditado', async () => {
      const a = await empresaConCaja('Empresa A', 'SN-A-0001');
      const token = await admin();
      const poner = (t: string, id: string, comisionPct: unknown) => request(app).put(`/api/datafonos/admin/empresas/${id}/comision`).set('Authorization', `Bearer ${t}`).send({ comisionPct });
      expect((await poner(token, a.e.id, 21)).status).toBe(400);
      expect((await poner(token, a.e.id, -1)).status).toBe(400);
      expect((await poner(token, a.e.id, 'tres')).status).toBe(400);
      expect((await poner(token, a.tienda.id, 2)).status).toBe(404); // una tienda no tiene comisión propia: es de la empresa
      expect((await poner(tokenPara(a.e), a.e.id, 2)).status).toBe(403);
      expect(await prisma.config.count({ where: { clave: { startsWith: 'comision_datafono_pct:' } } })).toBe(0);

      expect((await poner(token, a.e.id, 3)).status).toBe(200);
      const log = await prisma.auditLog.findFirstOrThrow({ where: { accion: 'CAMBIAR_COMISION_DATAFONO_EMPRESA' } });
      expect(log.datos).toEqual({ antes: 'general', despues: 3 });
    });
  });

  describe('sincronización con muchas empresas', () => {
    const marcar = (ids: string[]) => prisma.config.createMany({ data: ids.map((id) => ({ clave: `ventas_pos_desde_${id}`, valor: String(Date.now() - 3_600_000) })) });
    // Kushki responde según la llave con la que se pregunta
    const porLlave = (respuestas: Record<string, object[]>) => http.post.mockImplementation(async (_u: string, _b?: any, config?: any) => {
      const llave = config?.headers?.['Private-Credential-Id'];
      if (llave === 'llave-que-falla-1234567') throw { message: 'caído', response: { status: 500, data: { message: 'caído' } } };
      return { data: { items: respuestas[llave] ?? [] } };
    });

    it('12 empresas: cada venta llega a la billetera de SU empresa y nunca a otra', async () => {
      const empresas = [];
      const respuestas: Record<string, object[]> = {};
      for (let i = 1; i <= 12; i++) {
        const x = await empresaConCaja(`Empresa ${i}`, `SN-MULTI-${String(i).padStart(4, '0')}`, `llave-privada-empresa-${String(i).padStart(2, '0')}-123456`);
        empresas.push(x);
        respuestas[`llave-privada-empresa-${String(i).padStart(2, '0')}-123456`] = [venta(i * 10000)];
      }
      await marcar(empresas.map((x) => x.e.id));
      porLlave(respuestas);

      const r = await sincronizarTodas();
      expect(r).toMatchObject({ cuentas: 12, fallidas: 0 });
      for (const [i, x] of empresas.entries()) {
        expect(await saldoDe(x.e.id)).toBe((i + 1) * 10000);
        expect(await prisma.cobroDatafono.count({ where: { terminal: { titularId: x.e.id } } })).toBe(1);
      }
    });

    it('una empresa que falla no frena a las demás, y se cuenta como fallida', async () => {
      const buena1 = await empresaConCaja('Buena 1', 'SN-OK-0001', 'llave-buena-uno-1234567');
      const mala = await empresaConCaja('Mala', 'SN-MALA-0001', 'llave-que-falla-1234567');
      const buena2 = await empresaConCaja('Buena 2', 'SN-OK-0002', 'llave-buena-dos-1234567');
      await marcar([buena1.e.id, mala.e.id, buena2.e.id]);
      porLlave({ 'llave-buena-uno-1234567': [venta(30000)], 'llave-buena-dos-1234567': [venta(50000)] });
      const r = await sincronizarTodas();
      expect(r).toMatchObject({ cuentas: 3, fallidas: 1 });
      expect(await saldoDe(buena1.e.id)).toBe(30000);
      expect(await saldoDe(buena2.e.id)).toBe(50000);
      expect(await saldoDe(mala.e.id)).toBe(0);
    });

    it('si la vuelta anterior no ha terminado, no empieza otra encima', async () => {
      const x = await empresaConCaja('Lenta', 'SN-LENTA-0001', 'llave-lenta-12345678');
      await marcar([x.e.id]);
      let liberar: () => void = () => {};
      http.post.mockImplementation(() => new Promise((resolve) => { liberar = () => resolve({ data: { items: [venta(10000)] } }); }));

      const primera = sincronizarTodas();
      await new Promise((r) => setTimeout(r, 100));
      const segunda = await sincronizarTodas();
      expect(segunda.omitida).toBe(true);
      expect(http.post).toHaveBeenCalledTimes(1);

      liberar();
      expect(await primera).toMatchObject({ cuentas: 1, fallidas: 0 });
      expect(await saldoDe(x.e.id)).toBe(10000);
      // y después de terminar, una nueva vuelta sí corre
      porLlave({ 'llave-lenta-12345678': [] });
      expect((await sincronizarTodas()).omitida).toBeUndefined();
    });
  });
});
