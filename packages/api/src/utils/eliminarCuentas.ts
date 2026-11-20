import { Prisma } from '@prisma/client';
import { prisma } from '../index';
import { encrypt } from './security';
import { logger } from './logger';

// ══════════════════════════════════════
// ELIMINACIÓN DE CUENTAS
// ══════════════════════════════════════
// - Sede o cuenta sin saldo ni operaciones en curso: se elimina al momento.
// - Cuenta con saldo: 7 días para retirarlo (en ese plazo solo puede ver el saldo y retirar). Al vencer se elimina sola,
//   pero NUNCA con saldo: si aún tiene, sigue esperando (el dinero es del cliente) y se avisa al administrador.
// - "Eliminar" borra todos los datos personales (nombre, cédula, correo, celular, PIN, cuentas bancarias, documentos,
//   sesiones, notificaciones, auditoría de la cuenta) y la cuenta desaparece de todos los listados. Los movimientos
//   financieros no se borran: quedan sin identidad para poder cuadrar con Kushki y con la contabilidad.

export const PLAZO_ELIMINACION_DIAS = 7;
const DIA_MS = 24 * 3_600_000;

export class ErrorEliminacion extends Error {
  status: number;
  constructor(mensaje: string, status = 400) {
    super(mensaje);
    this.status = status;
  }
}

export type ResultadoEliminacion =
  | { estado: 'eliminada' }
  | { estado: 'programada'; fecha: Date; motivos: string[] };

// Qué impide eliminar hoy: saldo propio y operaciones que todavía necesitan los datos de la cuenta
export async function bloqueosDeEliminacion(userId: string): Promise<string[]> {
  const [wallet, retiros, pagos, cobros] = await Promise.all([
    prisma.wallet.findUnique({ where: { userId } }),
    prisma.withdrawal.count({ where: { userId, status: { in: ['pendiente', 'en_proceso'] } } }),
    prisma.kushkiPayment.count({ where: { userId, estado: 'pendiente' } }),
    prisma.cobroDatafono.count({ where: { userId, estado: { in: ['pendiente', 'expirado'] } } }),
  ]);
  const motivos: string[] = [];
  const saldo = Number(wallet?.saldo ?? 0);
  if (saldo > 0) motivos.push(`saldo de ${saldo.toLocaleString('es-CO')} COP`);
  if (retiros > 0) motivos.push(`${retiros} retiro(s) en curso`);
  if (pagos > 0) motivos.push(`${pagos} consignación(es) en curso`);
  if (cobros > 0) motivos.push(`${cobros} cobro(s) de datáfono en curso`);
  return motivos;
}

// Pide la eliminación: inmediata si no hay nada pendiente; si no, queda programada a 7 días
export async function solicitarEliminacion(userId: string, adminId: string, ip?: string): Promise<ResultadoEliminacion> {
  const u = await prisma.user.findUnique({ where: { id: userId } });
  if (!u || u.eliminadoAt) throw new ErrorEliminacion('Usuario no encontrado', 404);
  if (u.rol === 'admin') throw new ErrorEliminacion('No se pueden eliminar cuentas de administrador');
  if (u.id === adminId) throw new ErrorEliminacion('No puedes eliminar tu propia cuenta');

  const sedes = await prisma.user.count({ where: { cuentaPadreId: u.id, eliminadoAt: null } });
  if (sedes > 0) throw new ErrorEliminacion(`Esta empresa tiene ${sedes} sede(s). Elimina primero las sedes`, 409);

  const motivos = await bloqueosDeEliminacion(u.id);
  if (motivos.length === 0) {
    await finalizarEliminacion(u.id, adminId, ip);
    return { estado: 'eliminada' };
  }

  const fecha = u.eliminacionProgramadaAt ?? new Date(Date.now() + PLAZO_ELIMINACION_DIAS * DIA_MS);
  if (!u.eliminacionProgramadaAt) {
    await prisma.user.update({ where: { id: u.id }, data: { eliminacionProgramadaAt: fecha } });
    await prisma.notification.create({
      data: {
        userId: u.id, tipo: 'warn', titulo: 'Tu cuenta será eliminada',
        mensaje: `Tu cuenta se eliminará el ${fecha.toLocaleDateString('es-CO', { day: 'numeric', month: 'long', year: 'numeric' })}. Hasta entonces solo puedes retirar tu saldo. Retíralo antes de esa fecha.`,
      },
    });
    await prisma.auditLog.create({ data: { userId: adminId, accion: 'PROGRAMAR_ELIMINACION', tabla: 'users', registroId: u.id, ip, datos: { fecha: fecha.toISOString(), motivos } } }).catch(() => {});
  }
  return { estado: 'programada', fecha, motivos };
}

export async function cancelarEliminacion(userId: string, adminId: string, ip?: string): Promise<void> {
  const u = await prisma.user.findUnique({ where: { id: userId } });
  if (!u || u.eliminadoAt) throw new ErrorEliminacion('Usuario no encontrado', 404);
  if (!u.eliminacionProgramadaAt) throw new ErrorEliminacion('Esta cuenta no tiene una eliminación programada');
  await prisma.user.update({ where: { id: u.id }, data: { eliminacionProgramadaAt: null } });
  await prisma.notification.create({ data: { userId: u.id, tipo: 'ok', titulo: 'Eliminación cancelada', mensaje: 'Tu cuenta ya no se eliminará. Volviste a tener acceso completo.' } });
  await prisma.auditLog.create({ data: { userId: adminId, accion: 'CANCELAR_ELIMINACION', tabla: 'users', registroId: u.id, ip } }).catch(() => {});
}

// Borra los datos personales y saca la cuenta del sistema. Si la cuenta nunca tuvo movimientos, se borra la fila entera;
// si los tuvo, queda una fila sin ningún dato personal (para no romper el historial financiero) que ningún listado muestra.
export async function finalizarEliminacion(userId: string, adminId: string | null, ip?: string): Promise<void> {
  const u = await prisma.user.findUnique({ where: { id: userId } });
  if (!u || u.eliminadoAt) return;

  await prisma.$transaction(async (tx) => {
    const wallet = await tx.wallet.findUnique({ where: { userId } });

    // Datos personales y todo lo que cuelga solo de la persona
    await tx.session.deleteMany({ where: { userId } });
    await tx.notification.deleteMany({ where: { userId } });
    await tx.userAuditLog.deleteMany({ where: { userId } });
    await tx.bankAccount.deleteMany({ where: { userId } });
    await tx.referral.deleteMany({ where: { OR: [{ referidorId: userId }, { referidoId: userId }] } });
    await tx.user.updateMany({ where: { referidoPorId: userId }, data: { referidoPorId: null } });
    if (wallet) await tx.qrCode.deleteMany({ where: { walletId: wallet.id } });
    await tx.comercioKushki.deleteMany({ where: { userId } });
    await tx.comercioKushkiOne.deleteMany({ where: { userId } });
    await tx.terminalKushki.updateMany({ where: { sedeId: userId }, data: { sedeId: null } });
    await tx.terminalKushki.updateMany({ where: { titularId: userId }, data: { activo: false } });

    // Retiros: se conserva el monto y los números de Kushki para cuadrar, pero sin los datos del titular ni de la cuenta
    const anonimo = encrypt('[eliminado]');
    await tx.withdrawal.updateMany({
      where: { userId },
      data: { nombreTitular: '[eliminado]', numeroCuenta: anonimo, cedulaTitular: anonimo, tipoCuenta: '[eliminado]', bancoNombre: '[eliminado]', payoutRespuestas: Prisma.DbNull, notasAdmin: null, motivo: null },
    });
    await tx.transaction.updateMany({ where: { userId }, data: { metadata: Prisma.DbNull } });

    // Auditoría de la cuenta (lo que se hizo sobre ella): no queda nada de esta persona
    await tx.auditLog.deleteMany({ where: { tabla: 'users', registroId: userId } });

    // ¿Queda algo que dependa de esta fila? Si no, se borra entera
    const [movs, retiros, pagos, rapyd, cobros, acciones, terminales] = await Promise.all([
      tx.transaction.count({ where: { userId } }),
      tx.withdrawal.count({ where: { userId } }),
      tx.kushkiPayment.count({ where: { userId } }),
      tx.rapydPayment.count({ where: { userId } }),
      tx.cobroDatafono.count({ where: { userId } }),
      tx.auditLog.count({ where: { userId } }),
      tx.terminalKushki.count({ where: { titularId: userId } }),
    ]);
    const walletTieneMovs = wallet ? (await tx.transaction.count({ where: { walletId: wallet.id } })) > 0 : false;

    if (movs + retiros + pagos + rapyd + cobros + acciones + terminales === 0 && !walletTieneMovs) {
      if (wallet) await tx.wallet.delete({ where: { id: wallet.id } });
      await tx.user.delete({ where: { id: userId } });
    } else {
      await tx.user.update({
        where: { id: userId },
        data: {
          cedula: `DEL-${userId}`, correo: `${userId}@eliminado.local`, nombre: 'Cuenta eliminada',
          celular: null, ciudad: null, pinHash: '!eliminado', codigoReferido: null, referidoPorId: null,
          kycNivel: 1, kycVerificado: false, bloqueado: true, bloqueadoHasta: null, requiere2fa: false, ultimoLogin: null,
          cuentaPadreId: null, permisoVerSaldo: false, permisoRecargar: false, permisoEnviar: false, permisoRetirar: false,
          eliminacionProgramadaAt: null, eliminadoAt: new Date(),
        },
      });
    }
  });

  // Única constancia: quién eliminó y cuándo, sin ningún dato de la cuenta eliminada
  if (adminId) {
    await prisma.auditLog.create({ data: { userId: adminId, accion: 'ELIMINAR_CUENTA', tabla: 'users', ip, datos: { eliminacion: 'definitiva' } } }).catch(() => {});
  }
  logger.info('Cuenta eliminada');
}

// Revisa a diario las cuentas con plazo vencido. Sin saldo ni operaciones en curso se eliminan; con saldo nunca
export async function eliminarCuentasVencidas(): Promise<{ eliminadas: number; esperando: number }> {
  const vencidas = await prisma.user.findMany({ where: { eliminacionProgramadaAt: { lte: new Date() }, eliminadoAt: null }, select: { id: true } });
  let eliminadas = 0;
  let esperando = 0;
  for (const { id } of vencidas) {
    try {
      const motivos = await bloqueosDeEliminacion(id);
      if (motivos.length === 0) { await finalizarEliminacion(id, null); eliminadas += 1; continue; }
      esperando += 1;
      logger.warn('Cuenta con plazo de eliminación vencido que aún no se puede eliminar', { motivos: motivos.join(', ') });
      const admins = await prisma.user.findMany({ where: { rol: 'admin', eliminadoAt: null }, select: { id: true } });
      const desde = new Date(Date.now() - DIA_MS);
      for (const a of admins) {
        const yaAvisado = await prisma.notification.count({ where: { userId: a.id, titulo: 'Eliminación pendiente de una cuenta', createdAt: { gte: desde } } });
        if (yaAvisado === 0) {
          await prisma.notification.create({ data: { userId: a.id, tipo: 'warn', titulo: 'Eliminación pendiente de una cuenta', mensaje: `Venció el plazo de eliminación de una cuenta, pero aún tiene: ${motivos.join(', ')}. Se eliminará sola cuando quede en cero.` } });
        }
      }
    } catch (err: any) {
      logger.error('No se pudo eliminar una cuenta vencida', { err: err.message });
    }
  }
  return { eliminadas, esperando };
}

export function iniciarEliminacionDeCuentas(): void {
  if (process.env.NODE_ENV === 'test') return;
  const timer = setInterval(() => {
    eliminarCuentasVencidas().catch((err: any) => logger.error('Falló la eliminación de cuentas vencidas', { err: err.message }));
  }, 3_600_000);
  timer.unref();
  logger.info('🗑️ Eliminación de cuentas con plazo vencido activa (cada hora)');
}
