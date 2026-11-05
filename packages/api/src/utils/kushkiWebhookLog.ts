import { Request } from 'express';
import { prisma } from '../index';
import { logger } from './logger';
import { sanitizarWebhook } from './kushkiWebhook';

const MAX_REGISTROS = 300;
const CABECERAS_OMITIDAS = new Set(['cookie', 'authorization', 'x-kushki-signature', 'x-kushki-simplesignature']);

// Deja constancia de cada llamada al webhook de Kushki, válida o no, para poder ver desde el panel si
// Kushki está llamando y por qué se rechaza. Nunca debe romper la respuesta al webhook.
export async function registrarWebhook(
  req: Request,
  datos: { ticket?: string | null; firmaValida: boolean; estadoHttp: number; detalle: string },
): Promise<void> {
  try {
    const cabeceras = {
      nombres: Object.keys(req.headers).filter(n => !CABECERAS_OMITIDAS.has(n)).sort(),
      conFirma: !!req.get('x-kushki-signature'),
      conFirmaSimple: !!req.get('x-kushki-simplesignature'),
      kushkiId: req.get('x-kushki-id') ?? null,
      userAgent: req.get('user-agent')?.slice(0, 120) ?? null,
    };
    const cuerpo = req.body && typeof req.body === 'object' ? sanitizarWebhook(req.body) : undefined;
    await prisma.kushkiWebhookLog.create({
      data: {
        ticket: datos.ticket ?? null,
        firmaValida: datos.firmaValida,
        estadoHttp: datos.estadoHttp,
        detalle: datos.detalle,
        ip: req.ip ?? null,
        cabeceras,
        cuerpo: cuerpo as object | undefined,
      },
    });
    // Conserva solo los últimos registros para que nadie pueda llenar la base llamando al endpoint
    const sobrantes = await prisma.kushkiWebhookLog.findMany({ orderBy: { createdAt: 'desc' }, skip: MAX_REGISTROS, select: { id: true } });
    if (sobrantes.length) await prisma.kushkiWebhookLog.deleteMany({ where: { id: { in: sobrantes.map(s => s.id) } } });
  } catch (e: any) {
    logger.warn('No se pudo registrar el webhook de Kushki', { error: e.message });
  }
}
