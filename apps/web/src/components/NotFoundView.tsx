import Link from 'next/link';

// Dígito con efecto 3D: varias copias desplazadas en un tono oscuro y encima la cara principal.
function Digito({ x, texto, cara, lado }: Readonly<{ x: number; texto: string; cara: string; lado: string }>) {
  const capas = Array.from({ length: 9 }, (_, i) => 9 - i);
  const base = { fontFamily: "'Arial Black', Impact, 'Helvetica Neue', sans-serif", fontWeight: 900, fontSize: 230, textAnchor: 'middle' as const };
  return (
    <g transform={`skewX(-6)`}>
      {capas.map((d) => (
        <text key={d} x={x + d * 1.5} y={252 + d * 1.1} fill={lado} {...base}>{texto}</text>
      ))}
      <text x={x} y={252} fill={cara} {...base}>{texto}</text>
    </g>
  );
}

function Persona({ children }: Readonly<{ children: React.ReactNode }>) {
  return <g strokeLinecap="round" strokeLinejoin="round">{children}</g>;
}

export function NotFoundView() {
  return (
    <main className="min-h-screen tp-login-bg flex flex-col items-center justify-center px-5 py-10 overflow-hidden">
      <svg viewBox="0 0 660 340" className="w-full max-w-[640px]" role="img" aria-label="Error 404: página no encontrada">
        <defs>
          <linearGradient id="nf-nube" x1="0" y1="0" x2="1" y2="1">
            <stop offset="0%" stopColor="#B36BF0" stopOpacity="0.45" />
            <stop offset="100%" stopColor="#B36BF0" stopOpacity="0" />
          </linearGradient>
        </defs>

        {/* Nubes y adornos */}
        <path d="M20 210 C70 180 130 205 190 230 C120 245 70 250 20 210Z" fill="url(#nf-nube)" />
        <path d="M470 250 C520 215 590 205 640 220 C590 255 520 262 470 250Z" fill="url(#nf-nube)" />
        <path d="M70 40 C110 15 170 30 215 70 C160 70 110 70 70 40Z" fill="url(#nf-nube)" />
        <path d="M470 25 C510 5 570 15 610 45 C560 50 510 50 470 25Z" fill="url(#nf-nube)" />
        <circle cx="94" cy="108" r="6" fill="#B36BF0" />
        <circle cx="610" cy="118" r="5" fill="#6CC998" />
        <circle cx="64" cy="170" r="3" fill="#9B35E7" />
        <circle cx="590" cy="190" r="3.5" fill="#B36BF0" />
        <circle cx="236" cy="92" r="3" fill="#852EC7" opacity="0.7" />
        <circle cx="500" cy="96" r="4" fill="#9B35E7" />
        <circle cx="140" cy="300" r="4" fill="#6CC998" />

        {/* Hilo + dígito 1 */}
        <g className="nf-swing" style={{ transformOrigin: '170px 0px' }}>
          <line x1="170" y1="0" x2="170" y2="84" stroke="var(--tp-muted)" strokeWidth="1.2" />
          <Digito x={170} texto="4" cara="#5B1FA8" lado="#2E0F5E" />
          <rect x="140" y="236" width="9" height="40" rx="4.5" fill="#B36BF0" />
          <rect x="146" y="236" width="9" height="16" rx="4.5" fill="#B36BF0" />
          <Persona>
            <circle cx="118" cy="82" r="8" fill="#F2C7A5" />
            <path d="M110 80 C110 70 126 70 126 80 C122 76 114 76 110 80Z" fill="#2B2A4C" />
            <rect x="109" y="90" width="17" height="24" rx="6" fill="#B36BF0" />
            <path d="M112 112 L100 124 L112 132" stroke="#1F1E3A" strokeWidth="6" fill="none" />
            <path d="M122 112 L134 118" stroke="#1F1E3A" strokeWidth="6" fill="none" />
            <rect x="124" y="94" width="18" height="12" rx="2" fill="#E8EAF2" transform="rotate(-16 133 100)" />
          </Persona>
        </g>

        {/* Hilo + dígito 0 con persona bailando */}
        <g className="nf-swing nf-swing-b" style={{ transformOrigin: '340px 0px' }}>
          <line x1="340" y1="0" x2="340" y2="52" stroke="var(--tp-muted)" strokeWidth="1.2" />
          <Digito x={345} texto="0" cara="#9B35E7" lado="#5D1CA9" />
          <rect x="352" y="238" width="9" height="62" rx="4.5" fill="#6CC998" />
          <rect x="357" y="238" width="9" height="20" rx="4.5" fill="#6CC998" />
          <Persona>
            <circle cx="342" cy="34" r="9" fill="#F2C7A5" />
            <path d="M333 32 C333 20 351 20 351 32 C346 27 338 27 333 32Z" fill="#2B2A4C" />
            <rect x="332" y="44" width="20" height="26" rx="7" fill="#6CC998" />
            <path d="M334 48 L318 24" stroke="#6CC998" strokeWidth="6" fill="none" />
            <path d="M350 48 L366 22" stroke="#6CC998" strokeWidth="6" fill="none" />
            <circle cx="317" cy="21" r="4" fill="#F2C7A5" />
            <circle cx="367" cy="19" r="4" fill="#F2C7A5" />
            <rect x="364" y="10" width="6" height="10" rx="1.5" fill="#2B2A4C" />
            <path d="M338 68 L330 94" stroke="#B36BF0" strokeWidth="7" fill="none" />
            <path d="M348 68 L362 92" stroke="#B36BF0" strokeWidth="7" fill="none" />
          </Persona>
        </g>

        {/* Hilo + dígito 2 */}
        <g className="nf-swing nf-swing-c" style={{ transformOrigin: '520px 0px' }}>
          <line x1="520" y1="0" x2="520" y2="74" stroke="var(--tp-muted)" strokeWidth="1.2" />
          <Digito x={510} texto="4" cara="#6CC998" lado="#3E8F6B" />
          <rect x="520" y="232" width="9" height="48" rx="4.5" fill="#9B35E7" />
          <rect x="525" y="232" width="9" height="14" rx="4.5" fill="#9B35E7" />
          <Persona>
            <circle cx="470" cy="82" r="8" fill="#F2C7A5" />
            <path d="M462 80 C462 70 478 70 478 80 C474 75 466 75 462 80Z" fill="#7A3E1F" />
            <rect x="461" y="90" width="17" height="24" rx="6" fill="#6CC998" />
            <path d="M464 112 L456 132" stroke="#852EC7" strokeWidth="6" fill="none" />
            <path d="M475 112 L488 126" stroke="#852EC7" strokeWidth="6" fill="none" />
            <path d="M476 96 L486 88" stroke="#6CC998" strokeWidth="5" fill="none" />
          </Persona>
        </g>
      </svg>

      <div className="text-center mt-2">
        <h1 className="text-[13px] sm:text-sm font-extrabold tracking-[0.32em] text-[var(--tp-text)] uppercase">
          ¡Ups! Página no encontrada
        </h1>
        <p className="text-sm text-[var(--tp-muted)] mt-3 max-w-xs mx-auto">
          La página que buscas no existe o fue movida.
        </p>
        <Link href="/" className="nf-boton inline-block mt-8 px-9 py-3.5 rounded-full font-bold text-white text-[11px] tracking-[0.2em] uppercase">
          Volver al inicio
        </Link>
      </div>
    </main>
  );
}
