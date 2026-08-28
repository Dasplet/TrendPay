import { PrismaClient } from '@prisma/client';
import bcrypt from 'bcryptjs';
import { randomUUID } from 'node:crypto';

const prisma = new PrismaClient();

async function main() {
  console.log('🌱 Seeding database...');

  // Seed banks
  const banks = [
    { id: 'nubank',      nombre: 'Nubank',            nuevo: true,  orden: 1  },
    { id: 'bancolombia', nombre: 'Bancolombia',        nuevo: false, orden: 2  },
    { id: 'nequi',       nombre: 'Nequi',              nuevo: false, orden: 3  },
    { id: 'bbva',        nombre: 'BBVA',               nuevo: false, orden: 4  },
    { id: 'bogota',      nombre: 'Banco de Bogotá',    nuevo: false, orden: 5  },
    { id: 'davivienda',  nombre: 'DAVI Bank',          nuevo: false, orden: 6  },
    { id: 'falabella',   nombre: 'Banco Falabella',    nuevo: false, orden: 7  },
    { id: 'occidente',   nombre: 'Banco de Occidente', nuevo: false, orden: 8  },
    { id: 'popular',     nombre: 'Banco Popular',      nuevo: false, orden: 9  },
    { id: 'av-villas',   nombre: 'AV Villas',          nuevo: false, orden: 10 },
    { id: 'itau',        nombre: 'Banco Itaú',         nuevo: false, orden: 11 },
  ];

  for (const bank of banks) {
    await prisma.bank.upsert({
      where: { id: bank.id },
      update: {},
      create: bank,
    });
  }
  console.log('✅ Banks seeded');

  // Default config
  const configs = [
    { clave: 'comision_pct',       valor: '3'    },
    { clave: 'comision_referido',  valor: '1000' },
    { clave: 'limite_diario',      valor: '3000000' },
    { clave: 'limite_mensual',     valor: '20000000' },
    { clave: 'monto_minimo_retiro', valor: '10000' },
  ];

  for (const config of configs) {
    await prisma.config.upsert({
      where: { clave: config.clave },
      update: {},
      create: config,
    });
  }
  console.log('✅ Configs seeded');

  // Admin user
  const adminPin  = await bcrypt.hash('0000', 12);
  const adminId   = randomUUID();
  const adminCode = 'REF-000001';

  const admin = await prisma.user.upsert({
    where: { cedula: '1000000001' },
    update: {},
    create: {
      id: adminId,
      cedula: '1000000001',
      nombre: 'Admin TrendPay',
      correo: 'admin@trendpay.co',
      celular: '3001234567',
      ciudad: 'Medellín',
      pinHash: adminPin,
      rol: 'admin',
      subRol: 'super_admin',
      kycVerificado: true,
      codigoReferido: adminCode,
      wallet: {
        create: { saldo: 5000000 },
      },
    },
  });
  console.log('✅ Admin user seeded:', admin.correo);

  // Demo user
  const userPin  = await bcrypt.hash('1234', 12);
  const userId   = randomUUID();
  const userCode = 'REF-456789';

  const user = await prisma.user.upsert({
    where: { cedula: '1023456789' },
    update: {},
    create: {
      id: userId,
      cedula: '1023456789',
      nombre: 'Juan García Martínez',
      correo: 'juan.garcia@email.com',
      celular: '3001234567',
      ciudad: 'Medellín',
      pinHash: userPin,
      rol: 'usuario',
      kycVerificado: true,
      codigoReferido: userCode,
      wallet: {
        create: { saldo: 285400 },
      },
    },
  });
  console.log('✅ Demo user seeded:', user.correo);

  console.log('\n🎉 Seed completed!\n');
  console.log('Admin:    cedula 1000000001 · PIN 0000');
  console.log('Usuario:  cedula 1023456789 · PIN 1234');
}

main()
  .catch((e) => { console.error(e); process.exit(1); })
  .finally(() => prisma.$disconnect());
