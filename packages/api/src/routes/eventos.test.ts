import http from 'node:http';
import type { AddressInfo } from 'node:net';
import type { Request } from 'express';
import app, { prisma } from '../index';
import { limpiarBaseDeDatos, crearUsuarioDePrueba, crearSubcuentaDePrueba, tokenPara } from '../tests/testUtils';
import { totalConexiones } from '../utils/eventos';
import { esLecturaAutenticada, identidadDeLaPeticion } from '../middleware/rateLimiter';

let servidor: http.Server;
let puerto: number;

beforeAll((done) => {
  servidor = app.listen(0, '127.0.0.1', () => { puerto = (servidor.address() as AddressInfo).port; done(); });
});
afterAll(async () => {
  servidor.closeAllConnections?.();
  await new Promise((r) => servidor.close(r));
  await limpiarBaseDeDatos();
  await prisma.$disconnect();
});
beforeEach(async () => { await limpiarBaseDeDatos(); });

const esperar = (ms: number) => new Promise((r) => setTimeout(r, ms));

// Abre la conexión de tiempo real como lo hace el navegador y guarda lo que va llegando
function abrir(token?: string) {
  return new Promise<{ estado: number; cabeceras: http.IncomingHttpHeaders; texto: () => string; avisos: () => number; cerrada: () => boolean; cerrar: () => void }>((resolve, reject) => {
    let recibido = '';
    let cerrada = false;
    const req = http.request({ host: '127.0.0.1', port: puerto, path: '/api/eventos', headers: { Accept: 'text/event-stream', ...(token ? { Authorization: `Bearer ${token}` } : {}) } }, (res) => {
      res.setEncoding('utf8');
      res.on('data', (d) => { recibido += d; });
      res.on('close', () => { cerrada = true; });
      res.on('end', () => { cerrada = true; });
      resolve({
        estado: res.statusCode!, cabeceras: res.headers, texto: () => recibido,
        avisos: () => (recibido.match(/event: cambio/g) || []).length, cerrada: () => cerrada,
        cerrar: () => req.destroy(),
      });
    });
    req.on('error', (e) => { if (!cerrada) reject(e); });
    req.end();
  });
}

describe('Tiempo real (Server-Sent Events)', () => {
  it('sin sesión no se puede abrir', async () => {
    const c = await abrir();
    expect(c.estado).toBe(401);
  });

  it('abre un canal sin compresión y sin datos, y lo cierra y limpia al desconectarse', async () => {
    const admin = await crearUsuarioDePrueba({ rol: 'admin' });
    const antes = totalConexiones();
    const c = await abrir(tokenPara(admin));
    expect(c.estado).toBe(200);
    expect(c.cabeceras['content-type']).toContain('text/event-stream');
    expect(c.cabeceras['content-encoding']).toBeUndefined();
    expect(c.cabeceras['cache-control']).toContain('no-transform');
    expect(totalConexiones()).toBe(antes + 1);

    c.cerrar();
    await esperar(200);
    expect(totalConexiones()).toBe(antes);
  });

  it('el administrador recibe el aviso al instante de cualquier cambio, y el aviso no lleva datos', async () => {
    const admin = await crearUsuarioDePrueba({ rol: 'admin' });
    const c = await abrir(tokenPara(admin));
    await esperar(100);
    expect(c.avisos()).toBe(0);

    const cliente = await crearUsuarioDePrueba({ saldo: 0, nombre: 'Marta Gómez' });
    await prisma.transaction.create({ data: { walletId: cliente.wallet!.id, userId: cliente.id, codigo: 'TX-RT-1', categoria: 'consigna', descripcion: 'secreto', montoBruto: 777777, montoNeto: 777777, saldoAntes: 0, saldoDespues: 777777 } });
    await esperar(900);

    expect(c.avisos()).toBeGreaterThanOrEqual(1);
    expect(c.texto()).not.toContain('Marta');
    expect(c.texto()).not.toContain('777777');
    expect(c.texto()).not.toContain('secreto');
    c.cerrar();
  });

  it('una ráfaga de escrituras se agrupa en pocos avisos (no uno por escritura)', async () => {
    const admin = await crearUsuarioDePrueba({ rol: 'admin' });
    const cliente = await crearUsuarioDePrueba({ saldo: 0 });
    const c = await abrir(tokenPara(admin));
    await esperar(100);
    for (let i = 0; i < 10; i++) await prisma.notification.create({ data: { userId: cliente.id, titulo: `n${i}`, mensaje: 'm' } });
    await esperar(900);
    expect(c.avisos()).toBeGreaterThanOrEqual(1);
    expect(c.avisos()).toBeLessThan(10);
    c.cerrar();
  });

  it('un cliente solo recibe avisos de su empresa; lo de otra empresa no le llega', async () => {
    const empresaA = await crearUsuarioDePrueba({ saldo: 0, nombre: 'Empresa A' });
    const empresaB = await crearUsuarioDePrueba({ saldo: 0, nombre: 'Empresa B' });
    const a = await abrir(tokenPara(empresaA));
    await esperar(100);

    // algo ocurre en la empresa B
    await prisma.transaction.create({ data: { walletId: empresaB.wallet!.id, userId: empresaB.id, codigo: 'TX-B', categoria: 'consigna', descripcion: 'x', montoBruto: 1000, montoNeto: 1000, saldoAntes: 0, saldoDespues: 1000 } });
    await esperar(900);
    expect(a.avisos()).toBe(0);

    // ahora en la empresa A
    await prisma.transaction.create({ data: { walletId: empresaA.wallet!.id, userId: empresaA.id, codigo: 'TX-A', categoria: 'consigna', descripcion: 'x', montoBruto: 1000, montoNeto: 1000, saldoAntes: 0, saldoDespues: 1000 } });
    await esperar(900);
    expect(a.avisos()).toBeGreaterThanOrEqual(1);
    a.cerrar();
  });

  it('una sede se entera de lo que pasa en la billetera de su empresa, y la empresa de lo que hace su sede', async () => {
    const empresa = await crearUsuarioDePrueba({ saldo: 0 });
    const sede = await crearSubcuentaDePrueba(empresa.id, {});
    const cSede = await abrir(tokenPara(sede));
    const cEmpresa = await abrir(tokenPara(empresa));
    await esperar(100);

    await prisma.transaction.create({ data: { walletId: empresa.wallet!.id, userId: sede.id, codigo: 'TX-SEDE', categoria: 'datafono', descripcion: 'x', montoBruto: 5000, montoNeto: 5000, saldoAntes: 0, saldoDespues: 5000 } });
    await esperar(900);
    expect(cEmpresa.avisos()).toBeGreaterThanOrEqual(1);
    expect(cSede.avisos()).toBeGreaterThanOrEqual(1);
    cSede.cerrar();
    cEmpresa.cerrar();
  });

  it('los cambios del saldo de una billetera también avisan a su dueño', async () => {
    const cliente = await crearUsuarioDePrueba({ saldo: 0 });
    const c = await abrir(tokenPara(cliente));
    await esperar(100);
    await prisma.wallet.update({ where: { userId: cliente.id }, data: { saldo: { increment: 5000 } } });
    await esperar(900);
    expect(c.avisos()).toBeGreaterThanOrEqual(1);
    c.cerrar();
  });

  it('con demasiadas pestañas abiertas se cierra la más antigua', async () => {
    const admin = await crearUsuarioDePrueba({ rol: 'admin' });
    const token = tokenPara(admin);
    const conexiones = [];
    for (let i = 0; i < 6; i++) conexiones.push(await abrir(token));
    await esperar(200);
    expect(conexiones[0].cerrada()).toBe(true);
    expect(conexiones[5].cerrada()).toBe(false);
    conexiones.forEach((c) => c.cerrar());
  });
});

describe('Límite de consultas con sesión', () => {
  const pedir = (metodo: string, authorization?: string) => ({ method: metodo, headers: authorization ? { authorization } : {} }) as unknown as Request;
  const admin = { id: 'u-1', cedula: 'x', nombre: 'x', rol: 'admin' };

  it('las lecturas con sesión válida no gastan el límite general; todo lo demás sí', () => {
    const token = `Bearer ${tokenPara(admin)}`;
    expect(esLecturaAutenticada(pedir('GET', token))).toBe(true);
    expect(esLecturaAutenticada(pedir('POST', token))).toBe(false);   // escrituras: límite general
    expect(esLecturaAutenticada(pedir('GET'))).toBe(false);            // sin sesión
    expect(esLecturaAutenticada(pedir('GET', 'Bearer token-falso'))).toBe(false); // un token inventado no salta el límite
    expect(identidadDeLaPeticion(pedir('GET', token))).toBe('u-1');
  });
});
