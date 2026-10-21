import type { KushkiPayment } from '@prisma/client';
import { prisma } from '../index';
import { genCodigo } from './security';
import { getTransferStatus } from './kushki';
import { logger } from './logger';
import { conciliarRetirosEnProceso } from './retiros';

export type EstadoPago = 'completado' | 'pendiente' | 'rechazado';

export interface ResultadoPago {
  estado: EstadoPago;
  saldo?: number;
}

// Consulta el estado real en Kushki y, si el banco aprobó, acredita el saldo.
// Lo usan tanto la confirmación al volver del banco como la conciliación
// periódica, así que debe ser seguro ante llamadas simultáneas: el pago se
// "reclama" con un UPDATE condicional (solo si sigue pendiente) dentro de la
// misma transacción que mueve el saldo, de modo que dos ejecuciones a la vez
// nunca acreditan dos veces.
export async function resolverPagoPse(pago: KushkiPayment): Promise<ResultadoPago> {
  const status = await getTransferStatus(pago.reference);

  if (status.estado === 'pendiente') return { estado: 'pendiente' };

  if (status.estado === 'rechazada') {
    await prisma.kushkiPayment.updateMany({ where: { id: pago.id, estado: 'pendiente' }, data: { estado: 'rechazado' } });
    return { estado: 'rechazado' };
  }

  const monto = Number(pago.monto);
  const comisionValor = Math.ceil(monto * 0.03);

  const resultado = await prisma.$transaction(async (tx): Promise<ResultadoPago> => {
    const reclamo = await tx.kushkiPayment.updateMany({
      where: { id: pago.id, estado: 'pendiente' },
      data: { estado: 'completado', ticketNumber: status.ticketNumber },
    });
    if (reclamo.count === 0) {
      const actual = await tx.kushkiPayment.findUnique({ where: { id: pago.id } });
      return { estado: (actual?.estado as EstadoPago) ?? 'pendiente' };
    }

    // Si quien consignó es una subcuenta, el dinero va a la billetera de su padre.
    const pagador = await tx.user.findUnique({ where: { id: pago.userId }, select: { cuentaPadreId: true } });
    const wallet = await tx.wallet.findUnique({ where: { userId: pagador?.cuentaPadreId ?? pago.userId } });
    if (!wallet) throw new Error('Billetera no encontrada');

    const updated = await tx.wallet.update({ where: { id: wallet.id }, data: { saldo: { increment: monto } } });
    const saldoDespues = Number.parseFloat(updated.saldo.toString());

    await tx.transaction.create({
      data: {
        walletId: wallet.id,
        userId: pago.userId,
        codigo: genCodigo('DEP'),
        categoria: 'consigna',
        descripcion: 'Consignación PSE vía Kushki',
        montoBruto: monto,
        comisionPct: 3,
        comisionValor,
        montoNeto: monto,
        saldoAntes: saldoDespues - monto,
        saldoDespues,
        status: 'exitosa',
      },
    });

    await tx.notification.create({
      data: {
        userId: pago.userId,
        tipo: 'ok',
        titulo: 'Consignación exitosa',
        mensaje: `Se acreditaron ${monto.toLocaleString('es-CO')} COP a tu billetera`,
      },
    });

    return { estado: 'completado', saldo: saldoDespues };
  });

  if (resultado.saldo !== undefined) {
    logger.info('Consignación con PSE acreditada', { reference: pago.reference, ticketNumber: status.ticketNumber, userId: pago.userId });
  }
  return resultado;
}

export interface ResumenConciliacion {
  revisados: number;
  completados: number;
  rechazados: number;
  pendientes: number;
  errores: number;
}

// Revisa los PSE que siguen pendientes. Cubre el caso en que el usuario cierra
// el navegador en el banco y nunca vuelve a TrendPay: sin esto su pago quedaría
// pendiente para siempre aunque el banco lo haya aprobado. Kushki recomienda
// reconsultar a los ~10 minutos, por eso por defecto se ignoran los muy
// recientes (el usuario aún puede estar en el banco) y los de más de 24 h.
export async function conciliarPagosPendientes(
  opts: { minEdadMin?: number; maxEdadHoras?: number; limite?: number } = {}
): Promise<ResumenConciliacion> {
  const { minEdadMin = 2, maxEdadHoras = 24, limite = 50 } = opts;
  const ahora = Date.now();

  const pagos = await prisma.kushkiPayment.findMany({
    where: {
      metodo: 'pse',
      estado: 'pendiente',
      createdAt: {
        lte: new Date(ahora - minEdadMin * 60_000),
        gte: new Date(ahora - maxEdadHoras * 3_600_000),
      },
    },
    orderBy: { createdAt: 'asc' },
    take: limite,
  });

  const resumen: ResumenConciliacion = { revisados: 0, completados: 0, rechazados: 0, pendientes: 0, errores: 0 };

  for (const pago of pagos) {
    resumen.revisados += 1;
    try {
      const { estado } = await resolverPagoPse(pago);
      if (estado === 'completado') resumen.completados += 1;
      else if (estado === 'rechazado') resumen.rechazados += 1;
      else resumen.pendientes += 1;
    } catch (err: any) {
      resumen.errores += 1;
      logger.error('Error conciliando pago PSE', { err: err.message, id: pago.id });
    }
  }

  if (resumen.revisados > 0) logger.info('Conciliación de pagos PSE', { ...resumen });
  return resumen;
}

const INTERVALO_CONCILIACION_MS = 5 * 60_000;

export function iniciarConciliacionKushki(): void {
  if (process.env.NODE_ENV === 'test' || !process.env.KUSHKI_PRIVATE_MERCHANT_ID) return;

  const timer = setInterval(() => {
    conciliarPagosPendientes().catch((err: any) => logger.error('Falló la conciliación de PSE', { err: err.message }));
    conciliarRetirosEnProceso().catch((err: any) => logger.error('Falló la conciliación de retiros', { err: err.message }));
  }, INTERVALO_CONCILIACION_MS);
  timer.unref();
  logger.info('🔁 Conciliación de pagos PSE y retiros activa (cada 5 minutos)');
}
