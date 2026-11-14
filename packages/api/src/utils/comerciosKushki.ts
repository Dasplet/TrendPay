import type { ComercioKushki } from '@prisma/client';
import { prisma } from '../index';
import { encrypt, decrypt } from './security';
import { AMBIENTES_KUSHKI, AmbienteKushki, CredencialesKushki } from './kushki';

// Branch de Kushki de cada cliente (cuenta padre). La llave privada se guarda cifrada y nunca sale del servidor.

export function cifrarLlavePrivada(llave: string): string {
  return encrypt(llave);
}

export function credencialesDeComercio(c: Pick<ComercioKushki, 'publicMerchantId' | 'privateMerchantIdCif' | 'ambiente'>): CredencialesKushki | null {
  const privateId = decrypt(c.privateMerchantIdCif);
  if (privateId === '****') return null; // no se pudo descifrar (llave de cifrado distinta)
  const baseUrl = AMBIENTES_KUSHKI[c.ambiente as AmbienteKushki] ?? AMBIENTES_KUSHKI.produccion;
  return { publicId: c.publicMerchantId, privateId, baseUrl };
}

// Branch activo de la cuenta padre, o null si el cliente aún no tiene uno. Sin él NO se usa el comercio de
// TrendPay: el dinero entraría a la cuenta equivocada.
export async function comercioDeTitular(titularId: string): Promise<{ comercioId: string; cred: CredencialesKushki } | null> {
  const c = await prisma.comercioKushki.findUnique({ where: { userId: titularId } });
  if (!c?.activo) return null;
  const cred = credencialesDeComercio(c);
  return cred ? { comercioId: c.id, cred } : null;
}

// Llaves con las que se creó un pago, para consultarlo o cancelarlo. Funciona aunque el Branch se haya
// desactivado después. undefined = el pago es del comercio de TrendPay (llaves por defecto).
export async function credencialesDePago(pago: { comercioId: string | null }): Promise<CredencialesKushki | undefined> {
  if (!pago.comercioId) return undefined;
  const c = await prisma.comercioKushki.findUnique({ where: { id: pago.comercioId } });
  const cred = c ? credencialesDeComercio(c) : null;
  if (!cred) throw new Error('No se pudieron recuperar las llaves del Branch de Kushki de este pago');
  return cred;
}

export function terminaEn(llave: string): string {
  return llave ? `…${llave.slice(-4)}` : '';
}
