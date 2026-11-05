import axios from 'axios';
import { iniciarDispersion, webhooksDeInit, EVENTOS_WEBHOOK_DISPERSION } from './kushki';

jest.mock('axios');
const http = axios as jest.Mocked<typeof axios>;

const URL_WEBHOOK = 'https://api.trendpay.test/api/kushki/webhooks/payout';
const datos = { bancoNombre: 'Bancolombia', tipoCuenta: 'Ahorros', numeroCuenta: '1234567890', cedulaTitular: '123456789', monto: 50000 };

describe('Webhook de la dispersión (init de Kushki)', () => {
  const original = process.env.KUSHKI_WEBHOOK_URL;
  afterEach(() => {
    if (original === undefined) delete process.env.KUSHKI_WEBHOOK_URL; else process.env.KUSHKI_WEBHOOK_URL = original;
    jest.clearAllMocks();
  });

  beforeEach(() => {
    http.get.mockResolvedValue({ data: [{ code: '000007', name: 'BANCOLOMBIA' }] });
    http.post.mockImplementation(async (url: string) =>
      url.endsWith('/tokens')
        ? { data: { token: 'tok_123' } }
        : { data: { ticketNumber: 'T-1', transactionReference: 'ref-1', status: 'INITIALIZED' } });
  });

  const cuerpoDe = (ruta: string) => (http.post.mock.calls.find(([url]) => String(url).endsWith(ruta)) as unknown[])[1] as Record<string, unknown>;

  it('sin KUSHKI_WEBHOOK_URL el init queda exactamente como hasta ahora', async () => {
    delete process.env.KUSHKI_WEBHOOK_URL;
    await iniciarDispersion(datos);
    expect(cuerpoDe('/init')).toEqual({ token: 'tok_123', amount: { subtotalIva: 0, subtotalIva0: 50000, iva: 0 } });
  });

  it('con KUSHKI_WEBHOOK_URL agrega el campo webhooks con la forma que documenta Kushki', async () => {
    process.env.KUSHKI_WEBHOOK_URL = URL_WEBHOOK;
    await iniciarDispersion(datos);
    expect(cuerpoDe('/init')).toEqual({
      token: 'tok_123',
      amount: { subtotalIva: 0, subtotalIva0: 50000, iva: 0 },
      webhooks: [{ events: ['approvedTransaction', 'declinedTransaction'], urls: [URL_WEBHOOK] }],
    });
  });

  it('el token no cambia: el webhook solo viaja en el init', async () => {
    process.env.KUSHKI_WEBHOOK_URL = URL_WEBHOOK;
    await iniciarDispersion(datos);
    expect(cuerpoDe('/tokens')).toEqual({
      documentType: 'CC', documentNumber: '123456789', accountType: 'CA', accountNumber: '1234567890',
      bankId: '000007', totalAmount: 50000, currency: 'COP',
    });
  });

  it('ignora valores que no son una URL http(s) y acepta comillas o espacios de más', () => {
    process.env.KUSHKI_WEBHOOK_URL = 'trendpay.com/webhook';
    expect(webhooksDeInit()).toEqual({});
    process.env.KUSHKI_WEBHOOK_URL = '   ';
    expect(webhooksDeInit()).toEqual({});
    process.env.KUSHKI_WEBHOOK_URL = `  "${URL_WEBHOOK}" `;
    expect(webhooksDeInit().webhooks?.[0].urls).toEqual([URL_WEBHOOK]);
    expect(EVENTOS_WEBHOOK_DISPERSION).toEqual(['approvedTransaction', 'declinedTransaction']);
  });
});
