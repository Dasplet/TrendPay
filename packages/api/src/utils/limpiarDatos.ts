import { prisma } from '../index';
import { logger } from './logger';

// Limpieza de datos de prueba: borra el historial financiero y deja todas las billeteras en $0.
//   SE BORRA:    movimientos, retiros, consignaciones Kushki y Rapyd, cobros de datáfono, avisos de webhook, notificaciones,
//                referidos, auditoría y los QR de cobro que no son permanentes.
//   SE CONSERVA: cuentas (usuarios, empresas, sedes), billeteras (con saldo 0), bancos y cuentas bancarias, Branch de Kushki,
//                datáfonos, configuración (comisiones), QR personales permanentes, sesiones y vinculaciones.
// IRREVERSIBLE. Solo se ejecuta desde el panel de administración con la variable PERMITIR_LIMPIEZA=1 en el servidor.

export const FRASE_LIMPIEZA = 'BORRAR TODO';

export const limpiezaPermitida = () => process.env.PERMITIR_LIMPIEZA === '1';

export interface ResumenLimpieza {
  filas: { nombre: string; cantidad: number }[];
  walletsConSaldo: number;
  saldoTotal: number;
}

export async function contarDatos(): Promise<ResumenLimpieza> {
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
  const filas = [
    ['Movimientos', mov], ['Retiros', ret], ['Consignaciones Kushki', pagK], ['Consignaciones Rapyd', pagR],
    ['Cobros de datáfono', cobros], ['Eventos de datáfono', eventos], ['Avisos de webhook', avisos], ['Notificaciones', notif],
    ['Referidos', refs], ['Auditoría de usuarios', auditU], ['Auditoría de administración', audit], ['QR de cobro temporales', qr],
  ] as const;
  return { filas: filas.map(([nombre, cantidad]) => ({ nombre, cantidad })), walletsConSaldo: wallets, saldoTotal: Number(saldo._sum.saldo ?? 0) };
}

export async function limpiarDatos(): Promise<ResumenLimpieza> {
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
  logger.warn('Limpieza de datos de prueba ejecutada');
  return contarDatos();
}
