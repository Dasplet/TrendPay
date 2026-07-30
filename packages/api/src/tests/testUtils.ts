import jwt from 'jsonwebtoken';
import bcrypt from 'bcryptjs';
import { prisma } from '../index';

// Orden pensado para respetar las foreign keys del schema.
export async function limpiarBaseDeDatos() {
  await prisma.transaction.deleteMany();
  await prisma.qrCode.deleteMany();
  await prisma.withdrawal.deleteMany();
  await prisma.rapydPayment.deleteMany();
  await prisma.bankAccount.deleteMany();
  await prisma.notification.deleteMany();
  await prisma.userAuditLog.deleteMany();
  await prisma.auditLog.deleteMany();
  await prisma.referral.deleteMany();
  await prisma.session.deleteMany();
  await prisma.wallet.deleteMany();
  await prisma.user.deleteMany();
}

let contador = 0;

export async function crearUsuarioDePrueba(opts: { saldo?: number; nombre?: string; rol?: string } = {}) {
  contador += 1;
  const sufijo = `${Date.now()}${contador}`.slice(-10);
  const pinHash = await bcrypt.hash('1234', 4);
  return prisma.user.create({
    data: {
      cedula: `T${sufijo}`,
      nombre: opts.nombre || `Usuario Prueba ${sufijo}`,
      correo: `test${sufijo}@trendpay.test`,
      pinHash,
      rol: opts.rol || 'usuario',
      wallet: { create: { saldo: opts.saldo ?? 0 } },
    },
    include: { wallet: true },
  });
}

export function tokenPara(user: { id: string; cedula: string; nombre: string; rol: string; subRol?: string | null }) {
  return jwt.sign(
    { id: user.id, cedula: user.cedula, nombre: user.nombre, rol: user.rol, subRol: user.subRol ?? null },
    process.env.JWT_SECRET!,
    { expiresIn: '15m' }
  );
}
