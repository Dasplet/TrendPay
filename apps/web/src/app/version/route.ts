import { NextResponse } from 'next/server';

// Versión de la aplicación que está publicada ahora mismo. Las pantallas abiertas la comparan con la suya para saber que salió
// una versión nueva y actualizarse solas (ver components/NuevaVersion.tsx).
export const dynamic = 'force-dynamic';

export function GET() {
  return NextResponse.json({ version: process.env.NEXT_PUBLIC_BUILD_ID ?? 'desconocida' }, { headers: { 'Cache-Control': 'no-store, max-age=0' } });
}
