// Web NFC (solo Chrome en Android, contexto seguro). Solo permite leer y grabar
// etiquetas NDEF — no puede emular una etiqueta ni leer tarjetas de pago EMV.
// TypeScript no trae tipos para NDEFReader, así que se declaran los mínimos.

interface NdefRecordLike {
  recordType: string;
  data?: DataView;
  encoding?: string;
}

interface NdefReadingEventLike extends Event {
  message: { records: NdefRecordLike[] };
}

interface NdefReaderLike extends EventTarget {
  scan(options?: { signal?: AbortSignal }): Promise<void>;
  write(
    message: { records: Array<{ recordType: string; data: string }> },
    options?: { overwrite?: boolean; signal?: AbortSignal }
  ): Promise<void>;
}

type NdefReaderCtor = new () => NdefReaderLike;

function readerCtor(): NdefReaderCtor | null {
  if (typeof window === 'undefined' || !window.isSecureContext) return null;
  return (window as unknown as { NDEFReader?: NdefReaderCtor }).NDEFReader ?? null;
}

export function nfcDisponible(): boolean {
  return readerCtor() !== null;
}

export async function grabarUrlEnEtiqueta(url: string, signal?: AbortSignal): Promise<void> {
  const Ctor = readerCtor();
  if (!Ctor) throw new DOMException('NFC no disponible', 'NotSupportedError');
  await new Ctor().write({ records: [{ recordType: 'url', data: url }] }, { overwrite: true, signal });
}

function textoDeRegistro(record: NdefRecordLike): string | null {
  if (!record.data || !['url', 'absolute-url', 'text'].includes(record.recordType)) return null;
  return new TextDecoder(record.encoding || 'utf-8').decode(record.data);
}

// Resuelve con el texto del primer registro URL/texto que se lea.
export function leerTextoDeEtiqueta(signal: AbortSignal): Promise<string> {
  const Ctor = readerCtor();
  if (!Ctor) return Promise.reject(new DOMException('NFC no disponible', 'NotSupportedError'));

  return new Promise<string>((resolve, reject) => {
    const reader = new Ctor();
    reader.addEventListener('reading', (event) => {
      for (const record of (event as NdefReadingEventLike).message.records) {
        const texto = textoDeRegistro(record);
        if (texto) { resolve(texto); return; }
      }
      reject(new DOMException('Etiqueta sin enlace', 'DataError'));
    });
    reader.addEventListener('readingerror', () => reject(new DOMException('No se pudo leer', 'NotReadableError')));
    reader.scan({ signal }).catch(reject);
  });
}

// Solo se acepta un enlace de cobro de ESTE mismo sitio: una etiqueta ajena o
// alterada no puede mandar al usuario a otra página desde la app.
export function rutaDePagoQr(texto: string, origen: string): string | null {
  let url: URL;
  try {
    url = new URL(texto);
  } catch {
    return null;
  }
  if (url.origin !== origen) return null;
  return /^\/dashboard\/pagar-qr\/[a-f0-9]{64}$/.test(url.pathname) ? url.pathname : null;
}

export function mensajeErrorNfc(err: unknown): string {
  switch ((err as { name?: string })?.name) {
    case 'NotSupportedError':
      return 'Este celular o navegador no permite NFC. Usa Chrome en Android.';
    case 'NotAllowedError':
      return 'Permiso de NFC denegado. Actívalo en los ajustes del navegador.';
    case 'NotReadableError':
      return 'No se pudo leer la etiqueta. Acércala de nuevo.';
    case 'DataError':
      return 'Esta etiqueta no tiene un enlace de pago.';
    case 'NetworkError':
      return 'La etiqueta se alejó antes de terminar. Acércala de nuevo y mantenla quieta.';
    default:
      return 'No se pudo usar NFC. Intenta de nuevo.';
  }
}
