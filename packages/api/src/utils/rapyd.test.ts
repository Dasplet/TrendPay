import crypto from 'node:crypto';
import { verifyWebhookSignature } from './rapyd';

// Firma un payload de la misma forma en que lo haría Rapyd, de forma
// independiente a la implementación bajo prueba (para no simplemente
// reflejar un posible bug de verifyWebhookSignature).
function firmarComoRapyd(urlPath: string, body: string, accessKey: string, secretKey: string) {
  const salt = crypto.randomBytes(8).toString('hex');
  const timestamp = Math.floor(Date.now() / 1000).toString();
  const toSign = urlPath + salt + timestamp + accessKey + secretKey + body;
  const signature = Buffer.from(
    crypto.createHmac('sha256', secretKey).update(toSign).digest('hex')
  ).toString('base64');
  return { salt, timestamp, signature };
}

const ACCESS_KEY = process.env.RAPYD_ACCESS_KEY!;
const SECRET_KEY = process.env.RAPYD_SECRET_KEY!;
const URL_PATH = '/api/rapyd/webhook';

describe('verifyWebhookSignature', () => {
  it('acepta un payload firmado correctamente', () => {
    const body = JSON.stringify({ type: 'PAYMENT_COMPLETED', data: { id: 'payment_1' } });
    const headers = firmarComoRapyd(URL_PATH, body, ACCESS_KEY, SECRET_KEY);
    expect(verifyWebhookSignature(URL_PATH, Buffer.from(body), headers)).toBe(true);
  });

  it('rechaza el payload si el body fue alterado después de firmarlo', () => {
    const body = JSON.stringify({ type: 'PAYMENT_COMPLETED', data: { id: 'payment_1' } });
    const headers = firmarComoRapyd(URL_PATH, body, ACCESS_KEY, SECRET_KEY);
    const bodyAlterado = JSON.stringify({ type: 'PAYMENT_COMPLETED', data: { id: 'payment_2' } });
    expect(verifyWebhookSignature(URL_PATH, Buffer.from(bodyAlterado), headers)).toBe(false);
  });

  it('rechaza una firma calculada con la secret key incorrecta', () => {
    const body = JSON.stringify({ type: 'PAYMENT_COMPLETED' });
    const headers = firmarComoRapyd(URL_PATH, body, ACCESS_KEY, 'otra-secret-key-cualquiera');
    expect(verifyWebhookSignature(URL_PATH, Buffer.from(body), headers)).toBe(false);
  });

  it('rechaza si falta algún header requerido', () => {
    const body = JSON.stringify({ type: 'PAYMENT_COMPLETED' });
    expect(verifyWebhookSignature(URL_PATH, Buffer.from(body), { salt: 'x', timestamp: '123' })).toBe(false);
    expect(verifyWebhookSignature(URL_PATH, Buffer.from(body), {})).toBe(false);
  });

  it('rechaza si el url_path no coincide (p. ej. reenvío a otra ruta)', () => {
    const body = JSON.stringify({ type: 'PAYMENT_COMPLETED' });
    const headers = firmarComoRapyd(URL_PATH, body, ACCESS_KEY, SECRET_KEY);
    expect(verifyWebhookSignature('/api/rapyd/otra-ruta', Buffer.from(body), headers)).toBe(false);
  });
});
