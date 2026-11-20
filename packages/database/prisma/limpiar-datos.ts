import { PrismaClient } from '@prisma/client';
import { createInterface } from 'node:readline/promises';

// Limpieza de datos de prueba: borra el historial financiero y deja todas las billeteras en $0.
//
//   SE BORRA:    movimientos, retiros, consignaciones Kushki y Rapyd, cobros de datáfono, avisos de webhook,
//                notificaciones, referidos, auditoría y los QR de cobro que no son permanentes.
//   SE CONSERVA: cuentas (usuarios, empresas, sedes), billeteras (con saldo 0), bancos y cuentas bancarias, Branch de
//                Kushki, datáfonos, configuración (comisiones), QR personales permanentes, sesiones y vinculaciones.
//
// IRREVERSIBLE. Sin --confirmar solo muestra qué borraría (simulacro) y no toca nada. Con --confirmar pide escribir
// una frase antes de borrar. Hacer antes un respaldo de la base.
//
//   Simulacro:  npx ts-node prisma/limpiar-datos.ts
//   Borrar:     npx ts-node prisma/limpiar-datos.ts --confirmar

const prisma = new PrismaClient();
const FRASE = 'BORRAR TODO';

async function contar() {
  const [mov, ret, pagK, pagR, cobros, eventos, avisos, notif, refs, auditU, audit, qr, wallets, saldo] = await Promise.all([
    prisma.transaction.count(),
    prisma.withdrawal.count(),
    prisma.kushkiPayment.count(),
    prisma.rapydPayment.count(),
    prisma.cobroDatafono.count(),
    prisma.eventoDatafono.count(),
    prisma.kushkiWebhookLog.count(),
    prisma.notification.count(),
    prisma.referral.count(),
    prisma.userAuditLog.count(),
    prisma.auditLog.count(),
    prisma.qrCode.count({ where: { permanente: false } }),
    prisma.wallet.count({ where: { saldo: { not: 0 } } }),
    prisma.wallet.aggregate({ _sum: { saldo: true } }),
  ]);
  return {
    filas: [
      ['Movimientos (transactions)', mov], ['Retiros', ret], ['Consignaciones Kushki', pagK], ['Consignaciones Rapyd', pagR],
      ['Cobros de datáfono', cobros], ['Eventos de datáfono', eventos], ['Avisos de webhook', avisos], ['Notificaciones', notif],
      ['Referidos', refs], ['Auditoría de usuarios', auditU], ['Auditoría de administración', audit], ['QR de cobro no permanentes', qr],
    ] as [string, number][],
    walletsConSaldo: wallets,
    saldoTotal: Number(saldo._sum.saldo ?? 0),
  };
}

async function main() {
  const url = new URL(process.env.DATABASE_URL ?? '');
  console.log(`\nBase de datos: ${url.host}${url.pathname}`);

  const c = await contar();
  console.log('\nSe borraría:');
  for (const [nombre, n] of c.filas) console.log(`  ${String(n).padStart(6)}  ${nombre}`);
  console.log(`\nBilleteras que quedarían en $0: ${c.walletsConSaldo} con saldo (suman $${c.saldoTotal.toLocaleString('es-CO')}) — ese dinero desaparece.`);
  console.log('Se conservan: cuentas, bancos, Branch de Kushki, datáfonos, comisiones, QR permanentes, vinculaciones.');

  if (!process.argv.includes('--confirmar')) {
    console.log('\nSIMULACRO: no se borró nada. Para borrar de verdad, vuelve a correrlo con --confirmar.');
    return;
  }

  let frase = process.env.LIMPIAR_CONFIRMACION;
  if (!frase) {
    const rl = createInterface({ input: process.stdin, output: process.stdout });
    frase = (await rl.question(`\nEsto es IRREVERSIBLE y borra datos de ${url.host}.\nEscribe exactamente "${FRASE}" para continuar: `)).trim();
    rl.close();
  }
  if (frase !== FRASE) throw new Error('La frase no coincide: no se borró nada');

  await prisma.$transaction(async (tx) => {
    await tx.eventoDatafono.deleteMany();
    await tx.cobroDatafono.deleteMany();
    await tx.kushkiWebhookLog.deleteMany();
    await tx.transaction.deleteMany();
    await tx.withdrawal.deleteMany();
    await tx.kushkiPayment.deleteMany();
    await tx.rapydPayment.deleteMany();
    await tx.referral.deleteMany();
    await tx.notification.deleteMany();
    await tx.userAuditLog.deleteMany();
    await tx.auditLog.deleteMany();
    await tx.qrCode.deleteMany({ where: { permanente: false } });
    await tx.wallet.updateMany({ data: { saldo: 0 } });
  }, { timeout: 120_000 });

  const despues = await contar();
  console.log('\n✅ Limpieza terminada. Quedó:');
  for (const [nombre, n] of despues.filas) console.log(`  ${String(n).padStart(6)}  ${nombre}`);
  console.log(`  Billeteras con saldo: ${despues.walletsConSaldo} (total $${despues.saldoTotal.toLocaleString('es-CO')})`);
}

main()
  .catch((e) => { console.error(`❌ ${e.message}`); process.exitCode = 1; })
  .finally(() => prisma.$disconnect());
