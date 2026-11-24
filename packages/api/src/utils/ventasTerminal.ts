import { Prisma } from '@prisma/client';
import type { TerminalKushki } from '@prisma/client';
import { prisma } from '../index';
import { genCodigo, decrypt } from './security';
import { logger } from './logger';
import { comisionDatafonoDeEmpresa } from './datafonos';

// ══════════════════════════════════════
// VENTAS HECHAS EN EL DATÁFONO
// ══════════════════════════════════════
// El cajero digita el valor directamente en el aparato. Kushki avisa a TrendPay (webhook de card present) cada venta y cada
// reembolso aprobados, y TrendPay los refleja: acredita (o descuenta) la billetera de la empresa y deja el movimiento visible
// en la tienda a la que pertenece el datáfono y en la cuenta principal. TrendPay nunca le manda nada al aparato.
//
// Cada aviso se autentica con la firma HMAC de Kushki (la "Webhook signature" de la consola de esa empresa), se acepta una sola
// vez (por la referencia única de la transacción) y solo cuenta si la transacción fue APROBADA.

type Aviso = Record<string, any>;

const TIPOS_VENTA = new Set(['SALE', 'DEFERRED', 'CAPTURE', 'CHARGE']);
const TIPOS_REEMBOLSO = new Set(['REFUND', 'VOID', 'REVERSE', 'REVERSAL']);

const texto = (v: unknown, max = 120): string | null => (typeof v === 'string' && v.length > 0 && v.length <= max ? v : null);

// Serial del aparato: Kushki lo manda en pos_details (serial o terminal_id según el modelo y la versión de la app)
export function serialesDelAviso(b: Aviso): string[] {
  return [b?.pos_details?.serial, b?.pos_details?.terminal_id, b?.terminal?.serial_number, b?.terminal?.serialNumber, b?.terminal_id, b?.serial]
    .map((v) => texto(v, 64))
    .filter((v): v is string => !!v);
}

// Referencia única de la transacción: sirve para no procesar dos veces el mismo aviso (Kushki reintenta)
export function claveDelAviso(b: Aviso): string | null {
  return texto(b?.transaction_reference) ?? texto(b?.transactionReference) ?? texto(b?.transaction_id) ?? texto(b?.ticket_number);
}

// Monto en pesos: lo aprobado; si no viene, lo pedido
export function montoDelAviso(b: Aviso): number | null {
  for (const c of [b?.approved_transaction_amount, b?.request_amount, b?.amount?.subtotal_iva0]) {
    const n = Number(c);
    if (Number.isFinite(n) && n > 0) return Math.round(n * 100) / 100;
  }
  return null;
}

// Cuándo se hizo la transacción según Kushki (no cuándo llegó a TrendPay): importa para los resúmenes por día y el orden del historial
export function fechaDelAviso(b: Aviso): Date {
  const crudo = b?.created ?? b?.transaction_date;
  let ms = NaN;
  if (typeof crudo === 'number') ms = crudo;
  else if (typeof crudo === 'string') ms = /^\d{10,13}$/.test(crudo) ? Number(crudo) : Date.parse(crudo);
  if (Number.isFinite(ms) && ms < 1e11) ms *= 1000; // segundos
  const ahora = Date.now();
  return Number.isFinite(ms) && ms > ahora - 400 * 86_400_000 && ms <= ahora + 5 * 60_000 ? new Date(ms) : new Date(ahora);
}

export interface OpcionesAviso { comisionPct?: number }

export type Clasificacion = { tipo: 'venta' | 'reembolso' } | { ignorar: string };

export function clasificar(b: Aviso): Clasificacion {
  if (String(b?.transaction_status ?? '').toUpperCase() !== 'APPROVAL') return { ignorar: `estado ${b?.transaction_status ?? 'desconocido'}` };
  const tipo = String(b?.transaction_type ?? '').toUpperCase();
  if (TIPOS_VENTA.has(tipo)) return { tipo: 'venta' };
  if (TIPOS_REEMBOLSO.has(tipo)) return { tipo: 'reembolso' };
  return { ignorar: `tipo ${tipo || 'desconocido'} (no mueve dinero)` };
}

// Lo que queda guardado en el registro de avisos: solo lo necesario para entender qué llegó, sin datos del chip ni de la tarjeta
export function resumenParaRegistro(b: Aviso): Record<string, unknown> {
  return {
    transaction_type: b?.transaction_type, transaction_status: b?.transaction_status, transaction_reference: b?.transaction_reference,
    ticket_number: b?.ticket_number, approved_transaction_amount: b?.approved_transaction_amount, request_amount: b?.request_amount,
    merchant_id: b?.merchant_id, merchant_name: b?.merchant_name, created: b?.created,
    pos_details: b?.pos_details ? { terminal_id: b.pos_details.terminal_id, serial: b.pos_details.serial, model: b.pos_details.model, brand: b.pos_details.brand } : undefined,
    last_four_digits: b?.last_four_digits, payment_brand: b?.payment_brand,
  };
}

export async function webhookSecretDeTitular(titularId: string): Promise<string | null> {
  const c = await prisma.comercioKushkiOne.findUnique({ where: { userId: titularId } });
  if (!c?.activo || !c.webhookSecretCif) return null;
  const secreto = decrypt(c.webhookSecretCif);
  return secreto === '****' ? null : secreto; // no se pudo descifrar (llave de cifrado distinta)
}

export async function terminalDelAviso(b: Aviso): Promise<TerminalKushki | null> {
  const seriales = serialesDelAviso(b);
  if (seriales.length === 0) return null;
  return prisma.terminalKushki.findFirst({ where: { serial: { in: seriales } } });
}

export interface ResultadoAviso { http: number; detalle: string }

const esDuplicado = (err: any) => err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002';

// La "terminal" WEB es la página web de la tienda: mismos movimientos que un datáfono, con otra categoría y otros textos
const esWeb = (t: TerminalKushki) => t.modelo === 'WEB';

// ── Venta aprobada en el datáfono: acredita el neto en la billetera de la empresa ──
async function registrarVenta(terminal: TerminalKushki, b: Aviso, clave: string, monto: number, opciones: OpcionesAviso = {}): Promise<ResultadoAviso> {
  const pct = opciones.comisionPct ?? await comisionDatafonoDeEmpresa(terminal.titularId);
  const fecha = fechaDelAviso(b);
  const comision = Math.round((monto * pct) / 100);
  const neto = monto - comision;
  const userId = terminal.sedeId ?? terminal.titularId; // quién "cobró": la tienda del datáfono, o la empresa si no tiene tienda

  try {
    await prisma.$transaction(async (tx) => {
      const cobro = await tx.cobroDatafono.create({
        data: {
          terminalId: terminal.id, userId, clientTransactionId: `terminal:${clave}`, monto, comisionPct: pct, estado: 'aprobado',
          estadoTerminal: 'APPROVAL', origen: 'terminal', tipo: 'cobro', createdAt: fecha,
          transactionReference: texto(b.transaction_reference) ?? clave, ticketNumber: texto(b.ticket_number, 40),
        },
      });
      const wallet = await tx.wallet.findUnique({ where: { userId: terminal.titularId } });
      if (!wallet) throw new Error('Billetera no encontrada');
      const actualizada = await tx.wallet.update({ where: { id: wallet.id }, data: { saldo: { increment: neto } } });
      const saldoDespues = Number.parseFloat(actualizada.saldo.toString());
      await tx.transaction.create({
        data: {
          walletId: wallet.id, userId, sedeId: terminal.sedeId, createdAt: fecha, codigo: genCodigo(esWeb(terminal) ? 'WEB' : 'DTF'), categoria: esWeb(terminal) ? 'pago_web' : 'datafono',
          descripcion: esWeb(terminal) ? `Pago en la página web · ${terminal.alias}` : `Cobro con datáfono · ${terminal.alias}`, montoBruto: monto, comisionPct: pct, comisionValor: comision, montoNeto: neto,
          saldoAntes: saldoDespues - neto, saldoDespues, status: 'exitosa',
          metadata: { terminal: terminal.serial, cobroId: cobro.id, referencia: clave, ticketNumber: texto(b.ticket_number, 40) ?? null, origen: 'terminal' },
        },
      });
      for (const destino of new Set([terminal.sedeId, terminal.titularId].filter((x): x is string => !!x))) {
        await tx.notification.create({ data: { userId: destino, tipo: 'ok', titulo: esWeb(terminal) ? 'Pago web aprobado' : 'Cobro con datáfono aprobado', mensaje: `Se acreditaron ${neto.toLocaleString('es-CO')} COP por ${esWeb(terminal) ? 'un pago en' : 'un cobro en'} ${terminal.alias}` } });
      }
    });
  } catch (err) {
    if (esDuplicado(err)) return { http: 200, detalle: 'venta repetida (ya registrada)' };
    throw err;
  }
  logger.info('Venta de datáfono registrada', { terminal: terminal.serial, neto });
  return { http: 200, detalle: `venta aprobada · acreditado ${neto}` };
}

// ── Reembolso aprobado en el datáfono: descuenta de la billetera el monto completo devuelto al cliente ──
async function registrarReembolso(terminal: TerminalKushki, b: Aviso, clave: string, monto: number): Promise<ResultadoAviso> {
  const fecha = fechaDelAviso(b);
  // Kushki no dice a qué venta corresponde el reembolso: se liga a la más reciente de ese datáfono con el mismo monto
  // Si el aviso trae el ticket de la venta que se anula (los reportes de Kushki lo traen) se liga exactamente a esa venta.
  const ticketVenta = texto(b.sale_ticket_number, 40);
  const original = ticketVenta
    ? await prisma.cobroDatafono.findFirst({ where: { ticketNumber: ticketVenta, tipo: 'cobro', estado: 'aprobado', terminal: { titularId: terminal.titularId } } })
    : await prisma.cobroDatafono.findFirst({ where: { terminalId: terminal.id, tipo: 'cobro', estado: 'aprobado', monto }, orderBy: { createdAt: 'desc' } });
  // El cliente recibe de vuelta el monto completo y TrendPay conserva la comisión de la venta: a la billetera se le descuenta TODO lo
  // devuelto (la empresa asume la comisión). El reembolso no lleva comisión propia ni devuelve la de la venta.
  const pct = 0;
  const comision = 0;
  const neto = monto;
  const userId = terminal.sedeId ?? terminal.titularId;

  try {
    const saldoDespues = await prisma.$transaction(async (tx) => {
      let ligado = false;
      if (original) {
        const r = await tx.cobroDatafono.updateMany({ where: { id: original.id, estado: 'aprobado' }, data: { estado: 'reembolsado', reembolsadoAt: new Date() } });
        ligado = r.count === 1;
      }
      const cobro = await tx.cobroDatafono.create({
        data: {
          terminalId: terminal.id, userId, clientTransactionId: `terminal:${clave}`, monto, comisionPct: pct, estado: 'aprobado',
          estadoTerminal: 'APPROVAL', origen: 'terminal', tipo: 'reembolso', createdAt: fecha, reembolsoDeId: ligado ? original!.id : null,
          transactionReference: texto(b.transaction_reference) ?? clave, ticketNumber: texto(b.ticket_number, 40),
        },
      });
      const wallet = await tx.wallet.findUnique({ where: { userId: terminal.titularId } });
      if (!wallet) throw new Error('Billetera no encontrada');
      const actualizada = await tx.wallet.update({ where: { id: wallet.id }, data: { saldo: { decrement: neto } } });
      const despues = Number.parseFloat(actualizada.saldo.toString());
      await tx.transaction.create({
        data: {
          walletId: wallet.id, userId, sedeId: terminal.sedeId, createdAt: fecha, codigo: genCodigo(esWeb(terminal) ? 'RWB' : 'RDT'), categoria: esWeb(terminal) ? 'reembolso_web' : 'reembolso_datafono',
          descripcion: esWeb(terminal) ? `Reembolso de pago en la página web · ${terminal.alias}` : `Reembolso de cobro con datáfono · ${terminal.alias}`, montoBruto: monto, comisionPct: pct, comisionValor: comision, montoNeto: -neto,
          saldoAntes: despues + neto, saldoDespues: despues, status: 'exitosa',
          metadata: { terminal: terminal.serial, cobroId: cobro.id, referencia: clave, ligadoA: ligado ? original!.id : null, origen: 'terminal' },
        },
      });
      for (const destino of new Set([terminal.sedeId, terminal.titularId].filter((x): x is string => !!x))) {
        await tx.notification.create({ data: { userId: destino, tipo: 'warn', titulo: esWeb(terminal) ? 'Reembolso de un pago web' : 'Reembolso de un cobro con datáfono', mensaje: `Se descontaron ${neto.toLocaleString('es-CO')} COP de la billetera por un reembolso en ${terminal.alias}` } });
      }
      return despues;
    });
    // El dinero ya salió hacia el comprador: si la billetera queda en negativo no se frena, pero se deja constancia
    if (saldoDespues < 0) logger.warn('La billetera quedó con saldo negativo por un reembolso de datáfono', { titularId: terminal.titularId });
  } catch (err) {
    if (esDuplicado(err)) return { http: 200, detalle: 'reembolso repetido (ya registrado)' };
    throw err;
  }
  return { http: 200, detalle: `reembolso aprobado · descontado ${neto}${original ? ' (ligado a una venta)' : ' (sin venta que coincida)'}` };
}

// Procesa un aviso ya autenticado de un terminal conocido
export async function procesarAvisoTerminal(terminal: TerminalKushki, b: Aviso, opciones: OpcionesAviso = {}): Promise<ResultadoAviso> {
  const clasificacion = clasificar(b);
  if ('ignorar' in clasificacion) return { http: 200, detalle: `ignorado: ${clasificacion.ignorar}` };
  const clave = claveDelAviso(b);
  const monto = montoDelAviso(b);
  if (!clave) return { http: 200, detalle: 'ignorado: el aviso no trae referencia de la transacción' };
  if (monto === null) return { http: 200, detalle: 'ignorado: el aviso no trae un monto válido' };
  return clasificacion.tipo === 'venta' ? registrarVenta(terminal, b, clave, monto, opciones) : registrarReembolso(terminal, b, clave, monto);
}
