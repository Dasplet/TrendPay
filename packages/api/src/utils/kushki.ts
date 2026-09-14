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

export interface KushkiTransferInitResult {
  redirectUrl: string;
  transactionReference: string;
}

export interface KushkiTransferContact {
  fullName: string;
  email: string;
  phoneNumber?: string;
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

// Confirma un token de transferencia PSE generado en el navegador (kushki.
// requestTransferToken) e inicia la transacción — a diferencia de la
// tarjeta, esto no cobra nada todavía: devuelve una redirectUrl a la que hay
// que mandar al usuario para que autorice el débito en su banco. El endpoint
// /transfer/v1/init no está en el spec no oficial ni en el SDK cliente (solo
// /transfer/v1/tokens lo está); se confirmó contra el sandbox UAT siguiendo
// la doc oficial de Kushki para "Receive Wire Transfers".
export async function initTransfer(token: string, montoCop: number, contact: KushkiTransferContact): Promise<KushkiTransferInitResult> {
  try {
    const { data } = await axios.post(
      `${BASE_URL}/transfer/v1/init`,
      {
        token,
        amount: { subtotalIva: 0, subtotalIva0: montoCop, iva: 0 },
        contactDetails: { fullName: contact.fullName, email: contact.email, phoneNumber: contact.phoneNumber },
      },
      { headers: { 'Private-Merchant-Id': PRIVATE_MERCHANT_ID, 'Content-Type': 'application/json' } }
    );
    return { redirectUrl: data.redirectUrl, transactionReference: data.transactionReference };
  } catch (err: any) {
    const kushkiMessage = err.response?.data?.message;
    throw new KushkiError(kushkiMessage || err.message || 'Error comunicando con Kushki', err.response?.status || 502);
  }
}

export type KushkiTransferState = 'aprobada' | 'pendiente' | 'rechazada';

export interface KushkiTransferStatus {
  estado: KushkiTransferState;
  ticketNumber?: string;
}

// El código de estado real que Kushki devuelve para PSE aprobado no está
// documentado con un valor exacto — solo "PENDING" fue observado en vivo en
// sandbox (la transacción de prueba tarda ~10 min en resolverse, según la
// propia doc de Kushki). Por seguridad, solo se acredita saldo si el estado
// coincide claramente con uno de estos indicadores de aprobación; cualquier
// valor no reconocido se trata como pendiente, nunca como aprobado.
const ESTADOS_APROBADOS = ['OK', 'APPROVED', 'AUTHORIZED', 'SUCCESS', 'APROBAD'];
const ESTADOS_RECHAZADOS = ['NOT_AUTHORIZED', 'DECLINED', 'FAILED', 'REJECTED', 'RECHAZAD', 'FALLID', 'EXPIRED', 'CANCELLED'];

export async function getTransferStatus(token: string): Promise<KushkiTransferStatus> {
  try {
    const { data } = await axios.get(`${BASE_URL}/transfer/v1/status/${token}`, {
      headers: { 'Private-Merchant-Id': PRIVATE_MERCHANT_ID },
    });
    const raw = String(data.processorState || data.status || '').toUpperCase();
    let estado: KushkiTransferState = 'pendiente';
    if (ESTADOS_APROBADOS.some((s) => raw.includes(s))) estado = 'aprobada';
    else if (ESTADOS_RECHAZADOS.some((s) => raw.includes(s))) estado = 'rechazada';
    return { estado, ticketNumber: data.ticketNumber };
  } catch (err: any) {
    const kushkiMessage = err.response?.data?.message;
    throw new KushkiError(kushkiMessage || err.message || 'Error comunicando con Kushki', err.response?.status || 502);
  }
}
