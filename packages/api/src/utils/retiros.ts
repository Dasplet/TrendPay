import type { Prisma, Withdrawal } from '@prisma/client';
import { prisma } from '../index';
import { genCodigo } from './security';
import { getPayoutStatus } from './kushki';
import { logger } from './logger';

export type EstadoRetiro = 'procesado' | 'rechazado' | 'en_proceso';

// Devuelve el dinero de un retiro a la billetera titular y lo marca rechazado.
// `desde` es el estado que debe tener el retiro: el cambio es un UPDATE
// condicional, así que si otra ejecución (admin o conciliación) ya lo resolvió
// no se devuelve el saldo dos veces. Retorna false si perdió esa carrera.
export async function revertirRetiro(
  tx: Prisma.TransactionClient,
  withdrawal: Withdrawal,
  opts: { desde: string[]; motivo: string; actorId: string; ip?: string | null }
): Promise<boolean> {
  const reclamo = await tx.withdrawal.updateMany({
    where: { id: withdrawal.id, status: { in: opts.desde } },
    data: { status: 'rechazado', notasAdmin: opts.motivo, aprobadoPor: opts.actorId, aprobadoAt: new Date() },
  });
  if (reclamo.count === 0) return false;

  const solicitante = await tx.user.findUnique({ where: { id: withdrawal.userId }, select: { cuentaPadreId: true } });
  const wallet = await tx.wallet.findUnique({ where: { userId: solicitante?.cuentaPadreId ?? withdrawal.userId } });
  if (!wallet) throw new Error('Billetera no encontrada');

  const monto = Number.parseFloat(withdrawal.monto.toString());
  const walletAfter = await tx.wallet.update({ where: { id: wallet.id }, data: { saldo: { increment: monto } } });
  const saldoDespues = Number.parseFloat(walletAfter.saldo.toString());

  await tx.transaction.create({
    data: {
      walletId: wallet.id,
      userId: withdrawal.userId,
      codigo: genCodigo('REV'),
      categoria: 'retiro',
      descripcion: `Reverso de retiro rechazado · ${withdrawal.bancoNombre}`,
      montoBruto: monto,
      comisionPct: 0,
      comisionValor: 0,
      montoNeto: monto,
      saldoAntes: saldoDespues - monto,
      saldoDespues,
      status: 'exitosa',
    },
  });

  await tx.notification.create({
    data: {
      userId: withdrawal.userId,
      tipo: 'warning',
      titulo: 'Retiro rechazado',
      mensaje: `Tu retiro de ${monto.toLocaleString('es-CO')} COP fue rechazado y el saldo fue devuelto a tu billetera`,
    },
  });

  await tx.auditLog.create({
    data: {
      userId: opts.actorId, accion: 'RETIRO_RECHAZADO', tabla: 'withdrawals', registroId: withdrawal.id, ip: opts.ip || null,
      datos: { motivo: opts.motivo, monto, banco: withdrawal.bancoNombre, antes: { status: opts.desde[0] }, despues: { status: 'rechazado' } },
    },
  });
  return true;
}

// Marca como procesado un retiro cuyo dinero ya llegó (o se transfirió a mano).
export async function completarRetiro(
  tx: Prisma.TransactionClient,
  withdrawal: Withdrawal,
  opts: { desde: string[]; actorId: string; ip?: string | null }
): Promise<boolean> {
  const reclamo = await tx.withdrawal.updateMany({
    where: { id: withdrawal.id, status: { in: opts.desde } },
    data: { status: 'procesado', aprobadoPor: opts.actorId, aprobadoAt: new Date() },
  });
  if (reclamo.count === 0) return false;

  await tx.transaction.updateMany({
    where: { metadata: { path: ['withdrawalId'], equals: withdrawal.id } },
    data: { status: 'exitosa' },
  });
  await tx.notification.create({
    data: {
      userId: withdrawal.userId,
      tipo: 'ok',
      titulo: 'Retiro enviado',
      mensaje: `Tu retiro de ${Number.parseFloat(withdrawal.monto.toString()).toLocaleString('es-CO')} COP fue enviado a ${withdrawal.bancoNombre}`,
    },
  });
  await tx.auditLog.create({
    data: {
      userId: opts.actorId, accion: 'RETIRO_APROBADO', tabla: 'withdrawals', registroId: withdrawal.id, ip: opts.ip || null,
      datos: { monto: Number.parseFloat(withdrawal.monto.toString()), banco: withdrawal.bancoNombre, antes: { status: opts.desde[0] }, despues: { status: 'procesado' } },
    },
  });
  return true;
}

// Consulta a Kushki cómo terminó la dispersión de un retiro en proceso y lo
// cierra: aprobada → procesado; rechazada → se devuelve el saldo. Cualquier otra
// respuesta lo deja en proceso para volver a consultarlo después.
export async function resolverRetiroEnProceso(withdrawal: Withdrawal): Promise<EstadoRetiro> {
  if (!withdrawal.payoutTicket || withdrawal.status !== 'en_proceso') return 'en_proceso';

  const estado = await getPayoutStatus(withdrawal.payoutTicket);
  if (estado === 'pendiente') return 'en_proceso';

  const actorId = withdrawal.aprobadoPor ?? withdrawal.userId;
  if (estado === 'aprobada') {
    await prisma.$transaction((tx) => completarRetiro(tx, withdrawal, { desde: ['en_proceso'], actorId }));
    return 'procesado';
  }

  await prisma.$transaction((tx) => revertirRetiro(tx, withdrawal, { desde: ['en_proceso'], motivo: 'Rechazado por el banco o por Kushki', actorId }));
  return 'rechazado';
}

export interface ResumenRetiros {
  revisados: number;
  procesados: number;
  rechazados: number;
  enProceso: number;
  errores: number;
}

// Revisa las dispersiones que siguen en proceso. Los ACH a otros bancos pueden
// tardar hasta 72 horas hábiles, por eso el tope es de 5 días.
export async function conciliarRetirosEnProceso(limite = 50): Promise<ResumenRetiros> {
  const retiros = await prisma.withdrawal.findMany({
    where: { status: 'en_proceso', payoutTicket: { not: null }, createdAt: { gte: new Date(Date.now() - 5 * 86_400_000) } },
    orderBy: { createdAt: 'asc' },
    take: limite,
  });

  const resumen: ResumenRetiros = { revisados: 0, procesados: 0, rechazados: 0, enProceso: 0, errores: 0 };
  for (const retiro of retiros) {
    resumen.revisados += 1;
    try {
      const estado = await resolverRetiroEnProceso(retiro);
      if (estado === 'procesado') resumen.procesados += 1;
      else if (estado === 'rechazado') resumen.rechazados += 1;
      else resumen.enProceso += 1;
    } catch (err: any) {
      resumen.errores += 1;
      logger.error('Error conciliando retiro', { err: err.message, id: retiro.id });
    }
  }

  if (resumen.revisados > 0) logger.info('Conciliación de retiros en proceso', { ...resumen });
  return resumen;
}
