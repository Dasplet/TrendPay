// Puente entre la capa de red y la pantalla: cuando una operación sensible responde "falta el código 2FA", api.ts le pide
// el código al usuario a través de la ventana registrada aquí (components/user/CodigoOperacion.tsx) y repite la operación.
type PedirCodigo = (aviso?: string) => Promise<string | null>;

let manejador: PedirCodigo | null = null;

export function registrarPedirCodigo(fn: PedirCodigo) {
  manejador = fn;
  return () => { if (manejador === fn) manejador = null; };
}

export function pedirCodigo2fa(aviso?: string): Promise<string | null> {
  return manejador ? manejador(aviso) : Promise.resolve(null);
}
