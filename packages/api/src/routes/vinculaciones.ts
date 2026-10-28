import { Router, Request, Response } from 'express';
import { z } from 'zod';
import { prisma } from '../index';
import { authenticate, requireAdmin } from '../middleware/auth';
import { logger } from '../utils/logger';
import { sendVinculacionEmail, MotivoCorreoVinculacion } from '../utils/email';
import { almacenamientoConfigurado, urlTemporal, borrarObjeto } from '../utils/storage';
import { DOCUMENTOS_VINCULACION, buscarDocumento } from '../utils/vinculacionDocs';
import { DIAS_VIGENCIA_ENLACE, documentosConEstado, enlaceVinculacion, fechaEnDias, generarToken } from '../utils/vinculaciones';

const router = Router();
router.use(authenticate, requireAdmin);

const requeridos = DOCUMENTOS_VINCULACION.filter(d => d.requerido);

function auditar(req: Request, accion: string, registroId: string, datos?: object) {
  return prisma.auditLog.create({ data: { userId: req.user!.id, accion, tabla: 'vinculaciones', registroId, ip: req.ip, datos } }).catch(() => {});
}

function fechaLarga(d: Date) {
  return d.toLocaleDateString('es-CO', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'America/Bogota' });
}

// Los correos son un apoyo: si Resend falla, el administrador igual puede copiar el enlace.
async function enviarCorreo(
  v: { contactoNombre: string; contactoCorreo: string; razonSocial: string },
  motivo: MotivoCorreoVinculacion,
  extra: { token?: string; expiraAt?: Date; mensaje?: string | null } = {},
): Promise<boolean> {
  try {
    return await sendVinculacionEmail(v.contactoCorreo, {
      motivo,
      nombreContacto: v.contactoNombre,
      empresa: v.razonSocial,
      enlace: extra.token ? enlaceVinculacion(extra.token) : undefined,
      venceEn: extra.expiraAt ? fechaLarga(extra.expiraAt) : undefined,
      mensaje: extra.mensaje,
    });
  } catch (e: any) {
    logger.error('Vinculación: no se pudo enviar el correo', { motivo, error: e.message });
    return false;
  }
}

function resumen(v: any) {
  const docs = v.documentos ?? [];
  return {
    id: v.id,
    razonSocial: v.razonSocial,
    nit: v.nit,
    contactoNombre: v.contactoNombre,
    contactoCorreo: v.contactoCorreo,
    estado: v.estado,
    mensaje: v.mensaje,
    expiraAt: v.expiraAt,
    enviadaAt: v.enviadaAt,
    decididaAt: v.decididaAt,
    createdAt: v.createdAt,
    documentosSubidos: docs.length,
    documentosAprobados: docs.filter((d: any) => d.estado === 'aprobado').length,
    documentosTotales: requeridos.length,
  };
}

const crearSchema = z.object({
  razonSocial: z.string().trim().min(2).max(160),
  nit: z.string().trim().max(30).optional(),
  contactoNombre: z.string().trim().min(2).max(120),
  contactoCorreo: z.string().trim().toLowerCase().email().max(160),
});

// ══ POST /api/admin/vinculaciones ══
router.post('/', async (req: Request, res: Response) => {
  const parse = crearSchema.safeParse(req.body);
  if (!parse.success) return res.status(400).json({ ok: false, mensaje: parse.error.errors[0].message });
  try {
    const { token, tokenHash } = generarToken();
    const expiraAt = fechaEnDias(DIAS_VIGENCIA_ENLACE);
    const v = await prisma.vinculacion.create({
      data: { ...parse.data, nit: parse.data.nit || null, tokenHash, expiraAt, creadaPor: req.user!.id },
    });
    await auditar(req, 'CREAR_VINCULACION', v.id, { razonSocial: v.razonSocial, contactoCorreo: v.contactoCorreo });
    const correoEnviado = await enviarCorreo(v, 'invitacion', { token, expiraAt });
    res.status(201).json({ ok: true, vinculacion: resumen({ ...v, documentos: [] }), enlace: enlaceVinculacion(token), correoEnviado });
  } catch (e: any) { res.status(500).json({ ok: false, mensaje: e.message }); }
});

// ══ GET /api/admin/vinculaciones ══
router.get('/', async (_req: Request, res: Response) => {
  try {
    const lista = await prisma.vinculacion.findMany({ orderBy: { createdAt: 'desc' }, take: 200, include: { documentos: true } });
    res.json({ ok: true, vinculaciones: lista.map(resumen), almacenamiento: almacenamientoConfigurado() });
  } catch (e: any) { res.status(500).json({ ok: false, mensaje: e.message }); }
});

// ══ GET /api/admin/vinculaciones/:id ══
router.get('/:id', async (req: Request, res: Response) => {
  try {
    const v = await prisma.vinculacion.findUnique({ where: { id: req.params.id }, include: { documentos: true } });
    if (!v) return res.status(404).json({ ok: false, mensaje: 'Solicitud no encontrada' });
    res.json({ ok: true, vinculacion: resumen(v), documentos: documentosConEstado(v.documentos) });
  } catch (e: any) { res.status(500).json({ ok: false, mensaje: e.message }); }
});

// ══ GET /api/admin/vinculaciones/:id/documentos/:tipo/archivo ══
// Enlace temporal (2 minutos) al archivo privado; cada apertura queda en la auditoría.
router.get('/:id/documentos/:tipo/archivo', async (req: Request, res: Response) => {
  try {
    const doc = await prisma.vinculacionDocumento.findUnique({ where: { vinculacionId_tipo: { vinculacionId: req.params.id, tipo: req.params.tipo } } });
    if (!doc) return res.status(404).json({ ok: false, mensaje: 'Documento no encontrado' });
    if (!almacenamientoConfigurado()) return res.status(503).json({ ok: false, mensaje: 'El almacenamiento de documentos no está configurado' });
    const url = await urlTemporal(doc.storageKey, doc.nombreOriginal);
    await auditar(req, 'VER_DOCUMENTO_VINCULACION', req.params.id, { tipo: doc.tipo });
    res.json({ ok: true, url, nombre: doc.nombreOriginal, mime: doc.mime });
  } catch (e: any) { res.status(500).json({ ok: false, mensaje: e.message }); }
});

const revisionSchema = z.object({
  estado: z.enum(['aprobado', 'rechazado']),
  motivo: z.string().trim().max(300).optional(),
});

// ══ PUT /api/admin/vinculaciones/:id/documentos/:tipo ══
router.put('/:id/documentos/:tipo', async (req: Request, res: Response) => {
  const parse = revisionSchema.safeParse(req.body);
  if (!parse.success) return res.status(400).json({ ok: false, mensaje: parse.error.errors[0].message });
  const { estado, motivo } = parse.data;
  if (estado === 'rechazado' && !motivo) return res.status(400).json({ ok: false, mensaje: 'Indica el motivo del rechazo para que el cliente sepa qué corregir' });
  if (!buscarDocumento(req.params.tipo)) return res.status(404).json({ ok: false, mensaje: 'Documento no reconocido' });

  try {
    const v = await prisma.vinculacion.findUnique({ where: { id: req.params.id } });
    if (!v) return res.status(404).json({ ok: false, mensaje: 'Solicitud no encontrada' });
    if (v.estado !== 'en_revision') return res.status(409).json({ ok: false, mensaje: 'Solo se pueden revisar documentos de solicitudes en revisión' });

    const actualizado = await prisma.vinculacionDocumento.updateMany({
      where: { vinculacionId: v.id, tipo: req.params.tipo },
      data: { estado, motivo: estado === 'rechazado' ? motivo : null },
    });
    if (actualizado.count === 0) return res.status(404).json({ ok: false, mensaje: 'El cliente aún no ha cargado este documento' });
    await auditar(req, 'REVISAR_DOCUMENTO_VINCULACION', v.id, { tipo: req.params.tipo, estado, motivo });
    res.json({ ok: true });
  } catch (e: any) { res.status(500).json({ ok: false, mensaje: e.message }); }
});

const decisionSchema = z.object({
  decision: z.enum(['aprobar', 'solicitar_correccion', 'rechazar']),
  mensaje: z.string().trim().max(500).optional(),
});

// ══ PUT /api/admin/vinculaciones/:id/decision ══
router.put('/:id/decision', async (req: Request, res: Response) => {
  const parse = decisionSchema.safeParse(req.body);
  if (!parse.success) return res.status(400).json({ ok: false, mensaje: parse.error.errors[0].message });
  const { decision, mensaje } = parse.data;

  try {
    const v = await prisma.vinculacion.findUnique({ where: { id: req.params.id }, include: { documentos: true } });
    if (!v) return res.status(404).json({ ok: false, mensaje: 'Solicitud no encontrada' });
    if (v.estado !== 'en_revision') return res.status(409).json({ ok: false, mensaje: 'La solicitud no está en revisión' });

    const rechazados = v.documentos.filter(d => d.estado === 'rechazado');

    if (decision === 'aprobar') {
      const sinAprobar = requeridos.filter(def => v.documentos.find(d => d.tipo === def.tipo)?.estado !== 'aprobado');
      if (sinAprobar.length) return res.status(400).json({ ok: false, mensaje: `Aún falta aprobar: ${sinAprobar.map(d => d.nombre).join(', ')}` });
    }
    if (decision === 'solicitar_correccion' && rechazados.length === 0) {
      return res.status(400).json({ ok: false, mensaje: 'Rechaza al menos un documento (con su motivo) antes de pedir correcciones' });
    }
    if (decision === 'rechazar' && !mensaje) return res.status(400).json({ ok: false, mensaje: 'Escribe el motivo para el cliente' });

    // Al pedir correcciones se emite un enlace nuevo: el anterior deja de servir
    const nuevo = decision === 'solicitar_correccion' ? generarToken() : null;
    const expiraAt = nuevo ? fechaEnDias(DIAS_VIGENCIA_ENLACE) : v.expiraAt;
    const estadoNuevo = { aprobar: 'aprobada', solicitar_correccion: 'requiere_correccion', rechazar: 'rechazada' }[decision];

    const reclamo = await prisma.vinculacion.updateMany({
      where: { id: v.id, estado: 'en_revision' },
      data: {
        estado: estadoNuevo,
        mensaje: mensaje || null,
        decididaAt: decision === 'solicitar_correccion' ? null : new Date(),
        ...(nuevo ? { tokenHash: nuevo.tokenHash, expiraAt } : {}),
      },
    });
    if (reclamo.count === 0) return res.status(409).json({ ok: false, mensaje: 'La solicitud ya fue decidida' });

    await auditar(req, 'DECIDIR_VINCULACION', v.id, { decision, mensaje, rechazados: rechazados.map(d => d.tipo) });
    const motivoCorreo = ({ aprobar: 'aprobada', solicitar_correccion: 'correccion', rechazar: 'rechazada' } as const)[decision];
    const correoEnviado = await enviarCorreo(v, motivoCorreo, { token: nuevo?.token, expiraAt: nuevo ? expiraAt : undefined, mensaje });
    res.json({ ok: true, estado: estadoNuevo, correoEnviado, enlace: nuevo ? enlaceVinculacion(nuevo.token) : undefined });
  } catch (e: any) { res.status(500).json({ ok: false, mensaje: e.message }); }
});

// ══ POST /api/admin/vinculaciones/:id/enlace ══
// Emite un enlace nuevo (el anterior queda inválido) y lo reenvía por correo.
router.post('/:id/enlace', async (req: Request, res: Response) => {
  try {
    const v = await prisma.vinculacion.findUnique({ where: { id: req.params.id } });
    if (!v) return res.status(404).json({ ok: false, mensaje: 'Solicitud no encontrada' });
    if (v.estado !== 'invitada' && v.estado !== 'requiere_correccion') {
      return res.status(409).json({ ok: false, mensaje: 'Esta solicitud ya no admite documentos nuevos' });
    }
    const { token, tokenHash } = generarToken();
    const expiraAt = fechaEnDias(DIAS_VIGENCIA_ENLACE);
    await prisma.vinculacion.update({ where: { id: v.id }, data: { tokenHash, expiraAt } });
    await auditar(req, 'REENVIAR_ENLACE_VINCULACION', v.id);
    const correoEnviado = await enviarCorreo(v, v.estado === 'invitada' ? 'invitacion' : 'correccion', { token, expiraAt, mensaje: v.mensaje });
    res.json({ ok: true, enlace: enlaceVinculacion(token), correoEnviado });
  } catch (e: any) { res.status(500).json({ ok: false, mensaje: e.message }); }
});

// ══ DELETE /api/admin/vinculaciones/:id ══
// Solo para solicitudes que nunca se enviaron o ya terminaron; borra también los archivos.
router.delete('/:id', async (req: Request, res: Response) => {
  try {
    const v = await prisma.vinculacion.findUnique({ where: { id: req.params.id }, include: { documentos: true } });
    if (!v) return res.status(404).json({ ok: false, mensaje: 'Solicitud no encontrada' });
    if (v.estado === 'en_revision') return res.status(409).json({ ok: false, mensaje: 'No se puede eliminar una solicitud en revisión' });
    if (almacenamientoConfigurado()) {
      await Promise.all(v.documentos.map(d => borrarObjeto(d.storageKey).catch(e => logger.warn('Vinculación: archivo no borrado', { error: e.message }))));
    }
    await prisma.vinculacion.delete({ where: { id: v.id } });
    await auditar(req, 'ELIMINAR_VINCULACION', v.id, { razonSocial: v.razonSocial });
    res.json({ ok: true });
  } catch (e: any) { res.status(500).json({ ok: false, mensaje: e.message }); }
});

export default router;
