import axios from 'axios';
import { getConfigTransferencias, solicitarTokenBreB, iniciarPagoBreB, cancelarPagoBreB, brebHabilitado, olvidarCacheBreB, KushkiError } from './kushki';

jest.mock('axios');
const http = axios as jest.Mocked<typeof axios>;

describe('Configuración de consignaciones por transferencia (Kushki Transfer In)', () => {
  it('consulta con paymentType=PAYMENT y la llave pública, e interpreta PSE y Bre-B', async () => {
    http.get.mockResolvedValue({ data: { processors: [
      { name: 'Pse Processor', currency: 'COP' },
      { name: 'Bre-B Processor', currency: 'COP', supportedFlows: [{ paymentType: 'PAYMENT', channels: ['QR'] }] },
    ] } });
    const r = await getConfigTransferencias();
    const [url, opciones] = http.get.mock.calls[0] as [string, { params: unknown; headers: Record<string, string> }];
    expect(url).toMatch(/\/transfer\/v1\/config$/);
    expect(opciones.params).toEqual({ paymentType: 'PAYMENT' });
    expect(Object.keys(opciones.headers)).toEqual(['Public-Merchant-Id']);
    expect(r.procesadores).toEqual([
      { name: 'Pse Processor', currency: 'COP', tipo: 'pse', canales: [] },
      { name: 'Bre-B Processor', currency: 'COP', tipo: 'bre-b', canales: ['QR'] },
    ]);
  });

  it('sin procesadores configurados devuelve lista vacía', async () => {
    http.get.mockResolvedValue({ data: { processors: [] } });
    expect((await getConfigTransferencias()).procesadores).toEqual([]);
  });

  it('un error de Kushki se convierte en KushkiError con el estado y la respuesta', async () => {
    http.get.mockRejectedValue({ message: 'x', response: { status: 401, data: { message: 'Unauthorized' } } });
    await expect(getConfigTransferencias()).rejects.toMatchObject({ status: 401, message: 'Unauthorized', respuesta: { message: 'Unauthorized' } });
    await expect(getConfigTransferencias()).rejects.toBeInstanceOf(KushkiError);
  });
});

describe('Bre-B: token, init y disponibilidad', () => {
  const CONFIG = { data: { processors: [
    { name: 'Pse Processor', currency: 'COP' },
    { name: 'Bre-B Credibanco Processor', currency: 'COP', supportedFlows: [{ paymentType: 'PAYMENT', channels: ['QR'] }] },
  ] } };
  const QR = 'data:image/png;base64,iVBORw0KGgo=';
  const posts = () => http.post.mock.calls as unknown as [string, any, any][];

  beforeEach(() => { olvidarCacheBreB(); http.get.mockReset(); http.post.mockReset(); });

  it('el token copia nombre y canal de la configuración (no están escritos a mano)', async () => {
    http.get.mockResolvedValue(CONFIG);
    http.post.mockResolvedValue({ data: { token: 'tok_breb' } });
    const r = await solicitarTokenBreB(30900);
    expect(r.token).toBe('tok_breb');
    const [url, cuerpo, opciones] = posts()[0];
    expect(url).toMatch(/\/transfer\/v1\/tokens$/);
    expect(cuerpo).toEqual({ amount: { subtotalIva: 0, subtotalIva0: 30900, iva: 0 }, currency: 'COP', processor: { name: 'Bre-B Credibanco Processor', channel: 'QR' } });
    expect(Object.keys(opciones.headers)).toContain('Public-Merchant-Id');
    expect(JSON.stringify(cuerpo)).not.toContain('bankId');
  });

  it('sin Bre-B en el comercio no llega a pedir token y explica qué hacer', async () => {
    http.get.mockResolvedValue({ data: { processors: [{ name: 'Pse Processor', currency: 'COP' }] } });
    await expect(solicitarTokenBreB(10000)).rejects.toMatchObject({ status: 422, message: expect.stringContaining('Bre-B') });
    expect(http.post).not.toHaveBeenCalled();
  });

  it('iniciarPagoBreB: token y luego init con la llave privada; devuelve el QR', async () => {
    http.get.mockResolvedValue(CONFIG);
    http.post.mockImplementation(async (url: string) => String(url).endsWith('/tokens')
      ? { data: { token: 'tok_breb' } }
      : { data: { qr: QR, ticketNumber: 'T1', transactionReference: 'ref-1' } });
    const r = await iniciarPagoBreB(30900);
    expect(r).toEqual({ token: 'tok_breb', qr: QR, ticketNumber: 'T1', transactionReference: 'ref-1' });
    const [url, cuerpo, opciones] = posts()[1];
    expect(url).toMatch(/\/transfer\/v1\/init$/);
    expect(cuerpo).toEqual({ token: 'tok_breb', amount: { subtotalIva: 0, subtotalIva0: 30900, iva: 0 } });
    expect(Object.keys(opciones.headers)).toContain('Private-Merchant-Id');
  });

  it('rechaza un "qr" que no sea una imagen en data URI (va a un atributo src)', async () => {
    http.get.mockResolvedValue(CONFIG);
    http.post.mockImplementation(async (url: string) => String(url).endsWith('/tokens')
      ? { data: { token: 'tok_breb' } }
      : { data: { qr: 'javascript:alert(1)' } });
    await expect(iniciarPagoBreB(10000)).rejects.toMatchObject({ status: 502, message: expect.stringContaining('QR') });
  });

  it('errores de Kushki en el init (E046 / E049) se propagan con su código y estado', async () => {
    http.get.mockResolvedValue(CONFIG);
    http.post.mockImplementation(async (url: string) => {
      if (String(url).endsWith('/tokens')) return { data: { token: 'tok_breb' } };
      throw { message: 'x', response: { status: 422, data: { code: 'E046', message: 'Token y procesador no coinciden' } } };
    });
    await expect(iniciarPagoBreB(10000)).rejects.toMatchObject({ status: 422, codigo: 'E046' });
  });

  it('cancelarPagoBreB: PATCH con la llave privada; 204 = cancelado, T023 = ya terminó, otro error se propaga', async () => {
    const patch = jest.fn();
    (http as any).patch = patch;
    patch.mockResolvedValueOnce({ status: 204 });
    expect(await cancelarPagoBreB('tok/abc')).toBe(true);
    const [url, cuerpo, opciones] = patch.mock.calls[0];
    expect(url).toMatch(/\/transfer\/v1\/cancel\/tok%2Fabc$/);
    expect(cuerpo).toBeUndefined();
    expect(Object.keys(opciones.headers)).toEqual(['Private-Merchant-Id']);

    patch.mockRejectedValueOnce({ message: 'x', response: { status: 400, data: { code: 'T023', message: 'ya final' } } });
    expect(await cancelarPagoBreB('tok_abc')).toBe(false);

    patch.mockRejectedValueOnce({ message: 'x', response: { status: 500, data: { message: 'boom' } } });
    await expect(cancelarPagoBreB('tok_abc')).rejects.toMatchObject({ status: 500 });
  });

  it('brebHabilitado: true/false según la configuración, y recuerda la respuesta', async () => {
    http.get.mockResolvedValue(CONFIG);
    expect(await brebHabilitado()).toBe(true);
    expect(await brebHabilitado()).toBe(true);
    expect(http.get).toHaveBeenCalledTimes(1);
    olvidarCacheBreB();
    http.get.mockResolvedValue({ data: { processors: [] } });
    expect(await brebHabilitado()).toBe(false);
  });

  it('brebHabilitado: si Kushki falla devuelve false sin guardar el resultado', async () => {
    http.get.mockRejectedValue(new Error('timeout'));
    expect(await brebHabilitado()).toBe(false);
    http.get.mockResolvedValue(CONFIG);
    expect(await brebHabilitado()).toBe(true);
  });
});
