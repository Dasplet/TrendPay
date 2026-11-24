// Logo de TrendPay (símbolo + nombre). Es una imagen transparente que se usa como "máscara": el color lo pone la página, así
// sale blanco en el modo oscuro y morado en el modo claro sin tener dos archivos. `color` fuerza uno (por ejemplo, en pantallas
// que siempre tienen fondo oscuro).
const PROPORCION = 798 / 103; // ancho / alto de /trendpay-logo.png

export function Logo({ height = 28, color, className = '' }: Readonly<{ height?: number; color?: string; className?: string }>) {
  return (
    <span
      role="img"
      aria-label="TrendPay"
      className={`tp-logo-mark ${className}`}
      style={{ height, width: Math.round(height * PROPORCION), ...(color ? { backgroundColor: color } : {}) }}
    />
  );
}
