import type { User } from '@/store/authStore';

// Permisos de subcuentas empresariales. Las cuentas normales (y las cuentas
// padre) no traen restricciones; si el backend no envía `permisos`, todo está
// permitido. El backend vuelve a validar cada operación — esto solo adapta la UI.
export type Permiso = 'verSaldo' | 'recargar' | 'enviar' | 'retirar';
export type Permisos = Record<Permiso, boolean>;

export function puede(user: Pick<User, 'permisos'> | null | undefined, permiso: Permiso): boolean {
  return user?.permisos?.[permiso] ?? true;
}

// Rutas del dashboard que exigen un permiso. Cobrar por QR cuenta como
// recarga (ingresa dinero); pagar por QR o NFC cuenta como envío.
const PERMISO_POR_RUTA: [string, Permiso][] = [
  ['/dashboard/consignar', 'recargar'],
  ['/dashboard/consignaciones', 'recargar'],
  ['/dashboard/cobrar-qr', 'recargar'],
  ['/dashboard/enviar', 'enviar'],
  ['/dashboard/pagar-qr', 'enviar'],
  ['/dashboard/pagar-nfc', 'enviar'],
  ['/dashboard/retirar-banco', 'retirar'],
];

export function permisoDeRuta(pathname: string): Permiso | undefined {
  return PERMISO_POR_RUTA.find(([ruta]) => pathname === ruta || pathname.startsWith(`${ruta}/`))?.[1];
}
