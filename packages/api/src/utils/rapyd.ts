import axios from 'axios';
import crypto from 'crypto';

const BASE_URL   = process.env.RAPYD_BASE_URL || 'https://sandboxapi.rapyd.net';
const ACCESS_KEY = process.env.RAPYD_ACCESS_KEY || '';
const SECRET_KEY = process.env.RAPYD_SECRET_KEY || '';

export class RapydError extends Error {
  status: number;
  constructor(mensaje: string, status = 502) {
    super(mensaje);
    this.status = status;
  }
}

function genSalt(): string {
  return crypto.randomBytes(8).toString('hex');
}

// signature = BASE64(HMAC-SHA256(method + url_path + salt + timestamp + access_key + secret_key + body_string))
function signRequest(method: string, urlPath: string, bodyString: string) {
  const salt      = genSalt();
  const timestamp = Math.floor(Date.now() / 1000).toString();
  const toSign    = method.toLowerCase() + urlPath + salt + timestamp + ACCESS_KEY + SECRET_KEY + bodyString;
  const signature = Buffer.from(
    crypto.createHmac('sha256', SECRET_KEY).update(toSign).digest('hex')
  ).toString('base64');
  return { salt, timestamp, signature };
}

export async function rapydRequest<T = any>(method: 'get' | 'post' | 'put' | 'delete', urlPath: string, body?: any): Promise<T> {
  const bodyString = body ? JSON.stringify(body) : '';
  const { salt, timestamp, signature } = signRequest(method, urlPath, bodyString);

  try {
    const { data } = await axios.request({
      method,
      url: `${BASE_URL}${urlPath}`,
      data: body || undefined,
      headers: {
        'Content-Type': 'application/json',
        access_key: ACCESS_KEY,
        salt,
        timestamp,
        signature,
      },
    });

    if (data?.status?.status && data.status.status !== 'SUCCESS') {
      throw new RapydError(data.status.message || 'Rapyd rechazó la solicitud');
    }
    return data.data as T;
  } catch (err: any) {
    if (err instanceof RapydError) throw err;
    const rapydMessage = err.response?.data?.status?.message;
    throw new RapydError(rapydMessage || err.message || 'Error comunicando con Rapyd', err.response?.status || 502);
  }
}

export function createCheckoutPage(params: {
  amount: number;
  currency: string;
  country: string;
  merchantReferenceId: string;
  completeUrl: string;
  errorUrl: string;
  metadata?: Record<string, any>;
}) {
  return rapydRequest<{ id: string; redirect_url: string }>('post', '/v1/checkout', {
    amount: params.amount,
    currency: params.currency,
    country: params.country,
    merchant_reference_id: params.merchantReferenceId,
    complete_payment_url: params.completeUrl,
    error_payment_url: params.errorUrl,
    metadata: params.metadata || {},
  });
}

export function getCheckoutPage(checkoutId: string) {
  return rapydRequest<{
    id: string;
    status: string;
    payment: { id: string | null; status: string | null; paid: boolean; merchant_reference_id?: string } | null;
  }>('get', `/v1/checkout/${checkoutId}`);
}

// signature = BASE64(HMAC-SHA256(url_path + salt + timestamp + access_key + secret_key + raw_body))
export function verifyWebhookSignature(urlPath: string, rawBody: Buffer, headers: { salt?: string; timestamp?: string; signature?: string }): boolean {
  const { salt, timestamp, signature } = headers;
  if (!salt || !timestamp || !signature) return false;

  const toSign = urlPath + salt + timestamp + ACCESS_KEY + SECRET_KEY + rawBody.toString('utf8');
  const expected = Buffer.from(
    crypto.createHmac('sha256', SECRET_KEY).update(toSign).digest('hex')
  ).toString('base64');

  const expectedBuf = Buffer.from(expected);
  const receivedBuf = Buffer.from(signature);
  if (expectedBuf.length !== receivedBuf.length) return false;
  return crypto.timingSafeEqual(expectedBuf, receivedBuf);
}
