import axios from 'axios';

const BASE_URL            = process.env.KUSHKI_BASE_URL || 'https://api-uat.kushkipagos.com';
const PRIVATE_MERCHANT_ID = process.env.KUSHKI_PRIVATE_MERCHANT_ID || '';

export class KushkiError extends Error {
  status: number;
  constructor(mensaje: string, status = 502) {
    super(mensaje);
    this.status = status;
  }
}

export interface KushkiChargeResult {
  ticketNumber: string;
  transactionReference: string;
}

// Cobra un token de tarjeta generado en el navegador con Kushki.js
// (kushki.requestToken) — el número de tarjeta nunca toca nuestro servidor,
// solo recibimos el token de un solo uso. Confirmado contra el sandbox UAT:
// éxito = 2xx con { ticketNumber, transactionReference }; rechazo/error =
// 4xx con { code, message }.
export async function chargeCardToken(token: string, montoCop: number): Promise<KushkiChargeResult> {
  try {
    const { data } = await axios.post(
      `${BASE_URL}/v1/charges`,
      {
        token,
        amount: { subtotalIva: 0, subtotalIva0: montoCop, iva: 0, currency: 'COP' },
      },
      { headers: { 'Private-Merchant-Id': PRIVATE_MERCHANT_ID, 'Content-Type': 'application/json' } }
    );
    return { ticketNumber: data.ticketNumber, transactionReference: data.transactionReference };
  } catch (err: any) {
    const kushkiMessage = err.response?.data?.message;
    throw new KushkiError(kushkiMessage || err.message || 'Error comunicando con Kushki', err.response?.status || 502);
  }
}
