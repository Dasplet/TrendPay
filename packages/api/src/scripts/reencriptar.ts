import 'dotenv/config';
import { PrismaClient } from '@prisma/client';
import { cargarSecretosAws } from '../utils/awsBootstrap';

// Re-cifra con la llave de KMS (v2) todo lo que sigue cifrado con la llave antigua (v1):
// cuentas bancarias, retiros, enlaces de vinculación y archivos guardados en la base de datos.
// Es seguro repetirlo: lo que ya está en v2 se salta. Por defecto solo SIMULA; con --aplicar escribe.
//   npx tsx src/scripts/reencriptar.ts            (simulación)
//   npx tsx src/scripts/reencriptar.ts --aplicar  (cambia los datos)
// Requiere las mismas variables que el servidor (DATABASE_URL, ENCRYPTION_KEY, AWS_*, KMS_WRAPPED_KEY).
async function main() {
  const aplicar = process.argv.includes('--aplicar');
  await cargarSecretosAws();
  // Se importa después de cargar la llave v2: security.ts la lee al cargarse
  const { cifradoV2Activo, esCifradoV2, encrypt, decrypt, encryptBuffer, decryptBuffer } = await import('../utils/security');
  if (!cifradoV2Activo()) throw new Error('No hay llave v2: falta KMS_WRAPPED_KEY (o AWS_SECRETS_ID que la contenga)');

  const prisma = new PrismaClient();
  const resumen: Record<string, { migrados: number; yaV2: number; fallidos: number }> = {};

  const texto = async (
    nombre: string,
    filas: { id: string; valores: Record<string, string | null> }[],
    guardar: (id: string, datos: Record<string, string>) => Promise<unknown>,
  ) => {
    const r = (resumen[nombre] = { migrados: 0, yaV2: 0, fallidos: 0 });
    for (const fila of filas) {
      const cambios: Record<string, string> = {};
      let fallo = false;
      for (const [campo, valor] of Object.entries(fila.valores)) {
        if (!valor) continue;
        if (esCifradoV2(valor)) continue;
        const plano = decrypt(valor);
        if (plano === '****') { fallo = true; break; }
        cambios[campo] = encrypt(plano);
        if (decrypt(cambios[campo]) !== plano) { fallo = true; break; } // comprobación antes de escribir
      }
      if (fallo) { r.fallidos += 1; continue; }
      if (Object.keys(cambios).length === 0) { r.yaV2 += 1; continue; }
      if (aplicar) await guardar(fila.id, cambios);
      r.migrados += 1;
    }
  };

  const cuentas = await prisma.bankAccount.findMany({ select: { id: true, numeroCuenta: true, cedulaTitular: true } });
  await texto('cuentas bancarias', cuentas.map((c) => ({ id: c.id, valores: { numeroCuenta: c.numeroCuenta, cedulaTitular: c.cedulaTitular } })),
    (id, data) => prisma.bankAccount.update({ where: { id }, data }));

  const retiros = await prisma.withdrawal.findMany({ select: { id: true, numeroCuenta: true, cedulaTitular: true } });
  await texto('retiros', retiros.map((w) => ({ id: w.id, valores: { numeroCuenta: w.numeroCuenta, cedulaTitular: w.cedulaTitular } })),
    (id, data) => prisma.withdrawal.update({ where: { id }, data }));

  const vinculaciones = await prisma.vinculacion.findMany({ select: { id: true, tokenCifrado: true } });
  await texto('enlaces de vinculación', vinculaciones.map((v) => ({ id: v.id, valores: { tokenCifrado: v.tokenCifrado } })),
    (id, data) => prisma.vinculacion.update({ where: { id }, data }));

  const archivos = await prisma.vinculacionArchivo.findMany({ select: { key: true } });
  const rA = (resumen['archivos en la base de datos'] = { migrados: 0, yaV2: 0, fallidos: 0 });
  for (const { key } of archivos) {
    const fila = await prisma.vinculacionArchivo.findUnique({ where: { key } });
    if (!fila) continue;
    const bytes = Buffer.from(fila.contenido);
    if (esCifradoV2(bytes)) { rA.yaV2 += 1; continue; }
    try {
      const nuevo = encryptBuffer(decryptBuffer(bytes));
      decryptBuffer(nuevo); // comprobación antes de escribir
      if (aplicar) await prisma.vinculacionArchivo.update({ where: { key }, data: { contenido: nuevo } });
      rA.migrados += 1;
    } catch {
      rA.fallidos += 1;
    }
  }

  console.log(aplicar ? '\nRe-cifrado APLICADO:' : '\nSIMULACIÓN (no se cambió nada; usa --aplicar para escribir):');
  console.table(resumen);
  if (Object.values(resumen).some((r) => r.fallidos > 0)) {
    console.log('Hay registros "fallidos": no se pudieron descifrar con la llave antigua. No se tocaron. Revisa ENCRYPTION_KEY antes de continuar.');
  }
  await prisma.$disconnect();
}

main().catch((err) => {
  console.error('Error:', err.message);
  process.exit(1);
});
