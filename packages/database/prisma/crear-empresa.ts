import { PrismaClient } from '@prisma/client';
import bcrypt from 'bcryptjs';
import { createInterface } from 'node:readline/promises';

// Crea solo la empresa con subcuentas (Empresa Padre + Hijo 1 + Hijo 2) en la
// base de datos a la que apunte DATABASE_URL — pensado para producción, donde
// no se corre el seed. Los PIN se piden por consola (o se leen de PIN_PADRE,
// PIN_HIJO1 y PIN_HIJO2) para que nunca queden escritos en el repo.
// La billetera del padre arranca en 0. Si alguna cédula o correo ya existe,
// no crea nada.

const prisma = new PrismaClient();

const PADRE = { cedula: '900100200', nombre: 'Empresa Padre', correo: 'empresa.padre@trendpay.co', codigoReferido: 'REF-100200' };
const HIJOS = [
  // Hijo 1: solo recarga, no ve el saldo
  { clave: 'PIN_HIJO1', cedula: '900100201', nombre: 'Empresa Hijo 1', correo: 'empresa.hijo1@trendpay.co', codigoReferido: 'REF-100201',
    permisoVerSaldo: false, permisoRecargar: true, permisoEnviar: false, permisoRetirar: false },
  // Hijo 2: ve el saldo y solo retira
  { clave: 'PIN_HIJO2', cedula: '900100202', nombre: 'Empresa Hijo 2', correo: 'empresa.hijo2@trendpay.co', codigoReferido: 'REF-100202',
    permisoVerSaldo: true, permisoRecargar: false, permisoEnviar: false, permisoRetirar: true },
];

async function pedirPin(clave: string, nombre: string): Promise<string> {
  let pin = process.env[clave];
  if (!pin) {
    const rl = createInterface({ input: process.stdin, output: process.stdout });
    pin = (await rl.question(`PIN de 4 dígitos para ${nombre}: `)).trim();
    rl.close();
  }
  if (!/^\d{4}$/.test(pin)) throw new Error(`El PIN de ${nombre} debe tener exactamente 4 dígitos`);
  return pin;
}

async function main() {
  const host = new URL(process.env.DATABASE_URL ?? '').host;
  console.log(`Base de datos destino: ${host}`);

  const cedulas = [PADRE.cedula, ...HIJOS.map((h) => h.cedula)];
  const correos = [PADRE.correo, ...HIJOS.map((h) => h.correo)];
  const existentes = await prisma.user.findMany({
    where: { OR: [{ cedula: { in: cedulas } }, { correo: { in: correos } }] },
    select: { cedula: true, correo: true },
  });
  if (existentes.length > 0) {
    throw new Error(`Ya existen usuarios con estas cédulas/correos, no se creó nada: ${existentes.map((u) => `${u.cedula} (${u.correo})`).join(', ')}`);
  }

  const rounds = Number.parseInt(process.env.BCRYPT_ROUNDS || '12');
  const pinPadre = await bcrypt.hash(await pedirPin('PIN_PADRE', PADRE.nombre), rounds);
  const pinesHijos: string[] = [];
  for (const hijo of HIJOS) pinesHijos.push(await bcrypt.hash(await pedirPin(hijo.clave, hijo.nombre), rounds));

  await prisma.$transaction(async (tx) => {
    const padre = await tx.user.create({
      data: { ...PADRE, pinHash: pinPadre, wallet: { create: { saldo: 0 } } },
    });
    for (const [i, { clave: _clave, ...hijo }] of HIJOS.entries()) {
      await tx.user.create({ data: { ...hijo, pinHash: pinesHijos[i], cuentaPadreId: padre.id } });
    }
  });

  console.log('✅ Empresa creada:');
  console.log(`   ${PADRE.nombre} · cédula ${PADRE.cedula}`);
  for (const h of HIJOS) console.log(`   ${h.nombre} · cédula ${h.cedula} (subcuenta)`);
}

main()
  .catch((e) => { console.error(`❌ ${e.message}`); process.exitCode = 1; })
  .finally(() => prisma.$disconnect());
