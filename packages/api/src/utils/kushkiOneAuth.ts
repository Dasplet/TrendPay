import { KushkiError } from './kushki';

// Autenticación y cifrado de Kushki One: cada mensaje viaja cifrado ({ data: "<iv_hex>:<cipher_hex>" }) y lleva las
// cabeceras Authorization (Basic + SHA-512) y timestamp. La clave de cifrado se deriva del Business-Code, del serial del
// terminal y de la hora. El detalle de los pasos está en la guía "Authentication and request encryption" de Kushki.

export interface SolicitudKushkiOne {
  headers: Record<string, string>;
  body: { data: string };
}

export function prepararSolicitud(_serial: string, _payload: unknown, _ahoraMs: number = Date.now()): SolicitudKushkiOne {
  throw new KushkiError('La autenticación de Kushki One todavía no está implementada', 501);
}
