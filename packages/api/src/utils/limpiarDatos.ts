import { prisma } from '../index';
import { logger } from './logger';
import { borrarObjeto } from './storage';

// Limpieza de datos de prueba: borra el historial financiero y deja todas las billeteras en $0.
//   SE BORRA:    movimientos, retiros, consignaciones Kushki y Rapyd, cobros de datáfono, avisos de webhook, notificaciones,
//                referidos, auditoría y los QR de cobro que no son permanentes.
//   SE CONSERVA: cuentas (usuarios, empresas, sedes), billeteras (con saldo 0), bancos y cuentas bancarias, Branch de Kushki,
//                datáfonos, configuración (comisiones), QR personales permanentes y sesiones.
//   OPCIONAL:    las vinculaciones (documentos y contratos de clientes) solo se borran si se pide expresamente, porque pueden
//                ser reales aunque el resto sea de prueba.
// IRREVERSIBLE. Solo se ejecuta desde el panel de administración con la variable PERMITIR_LIMPIEZA=1 en el servidor.

export const FRASE_LIMPIEZA = 'BORRAR TODO';

export const limpiezaPermitida = () => process.env.PERMITIR_LIMPIEZA === '1';

export interface ResumenLimpieza {
  filas: { nombre: string; cantidad: number }[];
  vinculaciones: number; // solo se borran si se pide (opción aparte)
  walletsConSaldo: number;
  saldoTotal: number;
}

export async function contarDatos(): Promise<ResumenLimpieza> {
  const [mov, ret, pagK, pagR, cobros, eventos, avisos, notif, refs, auditU, audit, qr, wallets, saldo, vinculaciones] = await Promise.all([
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
    prisma.vinculacion.count(),
  ]);
  const filas = [
    ['Movimientos', mov], ['Retiros', ret], ['Consignaciones Kushki', pagK], ['Consignaciones Rapyd', pagR],
    ['Cobros de datáfono', cobros], ['Eventos de datáfono', eventos], ['Avisos de webhook', avisos], ['Notificaciones', notif],
    ['Referidos', refs], ['Auditoría de usuarios', auditU], ['Auditoría de administración', audit], ['QR de cobro temporales', qr],
  ] as const;
  return { filas: filas.map(([nombre, cantidad]) => ({ nombre, cantidad })), vinculaciones, walletsConSaldo: wallets, saldoTotal: Number(saldo._sum.saldo ?? 0) };
}

export async function limpiarDatos(opciones: { incluirVinculaciones?: boolean } = {}): Promise<ResumenLimpieza> {
  // Los archivos de las vinculaciones pueden estar en un bucket externo: se borran primero (si falla uno, no se detiene todo)
  let archivosNoBorrados = 0;
  if (opciones.incluirVinculaciones) {
    const documentos = await prisma.vinculacionDocumento.findMany({ select: { storageKey: true } });
    for (const d of documentos) {
      try { await borrarObjeto(d.storageKey); } catch { archivosNoBorrados += 1; }
    }
  }
  await prisma.$transaction(async (tx) => {
    if (opciones.incluirVinculaciones) {
      await tx.vinculacionDocumento.deleteMany();
      await tx.vinculacion.deleteMany();
      await tx.vinculacionArchivo.deleteMany();
    }
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
  logger.warn('Limpieza de datos de prueba ejecutada', { vinculaciones: !!opciones.incluirVinculaciones, archivosNoBorrados });
  return contarDatos();
}
