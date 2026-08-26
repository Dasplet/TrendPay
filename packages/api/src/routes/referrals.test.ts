import request from 'supertest';
import app, { prisma } from '../index';
import { limpiarBaseDeDatos, crearUsuarioDePrueba, tokenPara } from '../tests/testUtils';

describe('Referrals API', () => {
  afterAll(async () => {
    await limpiarBaseDeDatos();
    await prisma.$disconnect();
  });

  beforeEach(async () => {
    await limpiarBaseDeDatos();
  });

  it('GET /api/referrals/me devuelve los referidos propios con el total ganado', async () => {
    const referidor = await crearUsuarioDePrueba();
    const referido = await crearUsuarioDePrueba();
    await prisma.referral.create({
      data: { referidorId: referidor.id, referidoId: referido.id, comisionValor: 1500, status: 'pagado', pagadoAt: new Date() },
    });

    const res = await request(app).get('/api/referrals/me').set('Authorization', `Bearer ${tokenPara(referidor)}`);
    expect(res.status).toBe(200);
    expect(res.body.stats.total_ganado).toBe(1500);
    expect(res.body.referidos[0].comision_valor).toBe(1500);
  });

  it('GET /api/referrals/admin permite al admin ver todos los referidos y el total pagado', async () => {
    const admin = await crearUsuarioDePrueba({ rol: 'admin' });
    const referidor = await crearUsuarioDePrueba();
    const referido = await crearUsuarioDePrueba();
    await prisma.referral.create({
      data: { referidorId: referidor.id, referidoId: referido.id, comisionValor: 1000, status: 'pagado', pagadoAt: new Date() },
    });

    const res = await request(app).get('/api/referrals/admin').set('Authorization', `Bearer ${tokenPara(admin)}`);
    expect(res.status).toBe(200);
    expect(res.body.stats.total_pagado).toBe(1000);
  });

  it('GET /api/referrals/admin/top arma el ranking por total de referidos', async () => {
    const admin = await crearUsuarioDePrueba({ rol: 'admin' });
    const referidor = await crearUsuarioDePrueba();
    const referido1 = await crearUsuarioDePrueba();
    const referido2 = await crearUsuarioDePrueba();
    await prisma.referral.create({ data: { referidorId: referidor.id, referidoId: referido1.id, comisionValor: 1000, status: 'pagado' } });
    await prisma.referral.create({ data: { referidorId: referidor.id, referidoId: referido2.id, comisionValor: 1000, status: 'pendiente' } });

    const res = await request(app).get('/api/referrals/admin/top').set('Authorization', `Bearer ${tokenPara(admin)}`);
    expect(res.status).toBe(200);
    expect(res.body.ranking[0].total_referidos).toBe(2);
    expect(res.body.ranking[0].total_ganado).toBe(1000);
  });

  it('POST /api/referrals/admin/pagar/:id marca como pagado y acredita el saldo del referidor', async () => {
    const admin = await crearUsuarioDePrueba({ rol: 'admin' });
    const referidor = await crearUsuarioDePrueba({ saldo: 0 });
    const referido = await crearUsuarioDePrueba();
    const referral = await prisma.referral.create({
      data: { referidorId: referidor.id, referidoId: referido.id, comisionValor: 2000, status: 'pendiente' },
    });

    const res = await request(app)
      .post(`/api/referrals/admin/pagar/${referral.id}`)
      .set('Authorization', `Bearer ${tokenPara(admin)}`);
    expect(res.status).toBe(200);

    const updated = await prisma.referral.findUnique({ where: { id: referral.id } });
    expect(updated?.status).toBe('pagado');

    const wallet = await prisma.wallet.findUnique({ where: { userId: referidor.id } });
    expect(Number(wallet!.saldo)).toBe(2000);
  });
});
