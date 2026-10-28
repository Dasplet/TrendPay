import { Router, Request, Response, NextFunction } from 'express';
import multer from 'multer';
import { createHash, randomUUID } from 'node:crypto';
import rateLimit from 'express-rate-limit';
import { prisma } from '../index';
import { logger } from '../utils/logger';
import { DOCUMENTOS_VINCULACION, buscarDocumento, detectarTipoArchivo, parsearFecha, validarVigencia } from '../utils/vinculacionDocs';
import { guardarObjeto, borrarObjeto, leerArchivoBd, leerTokenArchivo } from '../utils/storage';
import { hashToken, documentosConEstado } from '../utils/vinculaciones';

const router = Router();

const MAX_BYTES = 8 * 1024 * 1024;
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: MAX_BYTES, files: 1, fields: 4 } });

// Rutas sin sesión: se limitan por IP para evitar abuso del enlace.
const limitador = rateLimit({
  windowMs: 60 * 1000,
  max: 40,
  standardHeaders: true,
  legacyHeaders: false,
  skip: () => process.env.NODE_ENV === 'test',
  message: { ok: false, mensaje: 'Demasiadas solicitudes. Espera un momento.' },
});
router.use(limitador);

type VinculacionConDocs = NonNullable<Awaited<ReturnType<typeof buscarPorToken>>>;

function buscarPorToken(token: string) {
  return prisma.vinculacion.findUnique({ where: { tokenHash: hashToken(token) }, include: { documentos: true } });
}

// Carga la solicitud a partir del enlace; el token nunca se guarda, solo su hash.
async function cargarVinculacion(req: Request, res: Response, next: NextFunction) {
  try {
    const vinculacion = await buscarPorToken(req.params.token);
    if (!vinculacion) return res.status(404).json({ ok: false, mensaje: 'Este enlace no es válido. Solicita uno nuevo a TrendPay.' });
    const editable = vinculacion.estado === 'invitada' || vinculacion.estado === 'requiere_correccion';
    if (editable && vinculacion.expiraAt.getTime() < Date.now()) {
      return res.status(410).json({ ok: false, mensaje: 'Este enlace venció. Solicita uno nuevo a TrendPay.' });
    }
    res.locals.vinculacion = vinculacion;
    next();
  } catch (e: any) {
    logger.error('Vinculación: error cargando enlace', { error: e.message });
    res.status(500).json({ ok: false, mensaje: 'No pudimos cargar tu solicitud. Intenta de nuevo.' });
  }
}

function esEditable(v: VinculacionConDocs) {
  return v.estado === 'invitada' || v.estado === 'requiere_correccion';
}

// ══ GET /api/vinculacion/archivo/:token ══
// Descarga de un archivo guardado en la base de datos. El token lo emite el panel admin (autenticado),
// dura 2 minutos y solo sirve para ese archivo.
router.get('/archivo/:token', async (req: Request, res: Response) => {
  const permiso = leerTokenArchivo(req.params.token);
  if (!permiso) return res.status(401).json({ ok: false, mensaje: 'El enlace del documento venció. Ábrelo de nuevo desde el panel.' });
  try {
    const [doc, contenido] = await Promise.all([
      prisma.vinculacionDocumento.findFirst({ where: { storageKey: permiso.key }, select: { mime: true } }),
      leerArchivoBd(permiso.key),
    ]);
    if (!doc || !contenido) return res.status(404).json({ ok: false, mensaje: 'Documento no encontrado' });
    res.set({
      'Content-Type': doc.mime,
      'Content-Disposition': `inline; filename="${permiso.nombre}"`,
      'Cache-Control': 'private, no-store',
      'X-Content-Type-Options': 'nosniff',
      'Content-Security-Policy': "default-src 'none'; img-src 'self' data:; style-src 'unsafe-inline'; sandbox",
    });
    res.send(contenido);
  } catch (e: any) {
    logger.error('Vinculación: error leyendo archivo', { error: e.message });
    res.status(500).json({ ok: false, mensaje: 'No pudimos abrir el documento' });
  }
});

// ══ GET /api/vinculacion/:token ══
router.get('/:token', cargarVinculacion, (_req: Request, res: Response) => {
  const v: VinculacionConDocs = res.locals.vinculacion;
  res.json({
    ok: true,
    vinculacion: { razonSocial: v.razonSocial, contactoNombre: v.contactoNombre, estado: v.estado, mensaje: v.mensaje, expiraAt: v.expiraAt, enviadaAt: v.enviadaAt },
    documentos: documentosConEstado(v.documentos),
    limiteMb: MAX_BYTES / (1024 * 1024),
  });
});

function subirArchivo(req: Request, res: Response, next: NextFunction) {
  upload.single('archivo')(req, res, (err: unknown) => {
    if (!err) return next();
    const excedido = err instanceof multer.MulterError && err.code === 'LIMIT_FILE_SIZE';
    res.status(excedido ? 413 : 400).json({ ok: false, mensaje: excedido ? `El archivo supera el máximo de ${MAX_BYTES / (1024 * 1024)} MB` : 'No pudimos leer el archivo' });
  });
}

// ══ POST /api/vinculacion/:token/documentos/:tipo ══
router.post('/:token/documentos/:tipo', cargarVinculacion, subirArchivo, async (req: Request, res: Response) => {
  const v: VinculacionConDocs = res.locals.vinculacion;
  try {
    if (!esEditable(v)) return res.status(409).json({ ok: false, mensaje: 'Tu solicitud ya está en revisión y no admite cambios' });

    const def = buscarDocumento(req.params.tipo);
    if (!def) return res.status(404).json({ ok: false, mensaje: 'Documento no reconocido' });

    const previo = v.documentos.find(d => d.tipo === def.tipo);
    if (previo?.estado === 'aprobado') return res.status(409).json({ ok: false, mensaje: 'Este documento ya fue aprobado y no se puede reemplazar' });

    if (!req.file) return res.status(400).json({ ok: false, mensaje: 'Selecciona un archivo' });
    const detectado = detectarTipoArchivo(req.file.buffer);
    if (!detectado) return res.status(400).json({ ok: false, mensaje: 'Solo se aceptan archivos PDF, JPG o PNG' });

    const fecha = parsearFecha(req.body?.fechaExpedicion);
    const errorFecha = validarVigencia(def, fecha);
    if (errorFecha) return res.status(400).json({ ok: false, mensaje: errorFecha, campo: 'fechaExpedicion' });

    const storageKey = await guardarObjeto(`vinculaciones/${v.id}/${def.tipo}/${randomUUID()}.${detectado.ext}`, req.file.buffer, detectado.mime);

    const datos = {
      storageKey,
      nombreOriginal: req.file.originalname.slice(0, 200),
      mime: detectado.mime,
      tamano: req.file.size,
      sha256: createHash('sha256').update(req.file.buffer).digest('hex'),
      fechaExpedicion: def.fecha.tipo === 'ninguna' ? null : fecha,
      estado: 'pendiente',
      motivo: null,
    };
    await prisma.vinculacionDocumento.upsert({
      where: { vinculacionId_tipo: { vinculacionId: v.id, tipo: def.tipo } },
      create: { vinculacionId: v.id, tipo: def.tipo, ...datos },
      update: datos,
    });
    if (previo) await borrarObjeto(previo.storageKey).catch(e => logger.warn('Vinculación: no se pudo borrar el archivo anterior', { error: e.message }));

    res.json({ ok: true, mensaje: 'Documento cargado' });
  } catch (e: any) {
    logger.error('Vinculación: error subiendo documento', { error: e.message, vinculacionId: v.id });
    res.status(500).json({ ok: false, mensaje: 'No pudimos guardar el documento. Intenta de nuevo.' });
  }
});

// ══ POST /api/vinculacion/:token/enviar ══
router.post('/:token/enviar', cargarVinculacion, async (_req: Request, res: Response) => {
  const v: VinculacionConDocs = res.locals.vinculacion;
  try {
    if (!esEditable(v)) return res.status(409).json({ ok: false, mensaje: 'Tu solicitud ya fue enviada' });

    for (const def of DOCUMENTOS_VINCULACION.filter(d => d.requerido)) {
      const doc = v.documentos.find(d => d.tipo === def.tipo);
      if (!doc) return res.status(400).json({ ok: false, mensaje: `Falta cargar: ${def.nombre}` });
      if (doc.estado === 'rechazado') return res.status(400).json({ ok: false, mensaje: `Debes volver a cargar: ${def.nombre}` });
      const errorFecha = validarVigencia(def, doc.fechaExpedicion);
      if (errorFecha) return res.status(400).json({ ok: false, mensaje: `${def.nombre}: ${errorFecha}` });
    }

    // Reclamo atómico: dos clics seguidos no envían la solicitud dos veces
    const reclamo = await prisma.vinculacion.updateMany({
      where: { id: v.id, estado: { in: ['invitada', 'requiere_correccion'] } },
      data: { estado: 'en_revision', enviadaAt: new Date(), mensaje: null },
    });
    if (reclamo.count === 0) return res.status(409).json({ ok: false, mensaje: 'Tu solicitud ya fue enviada' });

    const admins = await prisma.user.findMany({ where: { rol: 'admin', bloqueado: false }, select: { id: true } });
    if (admins.length) {
      await prisma.notification.createMany({
        data: admins.map(a => ({ userId: a.id, tipo: 'info', titulo: 'Vinculación lista para revisar', mensaje: `${v.razonSocial} envió sus documentos para evaluación` })),
      });
    }
    res.json({ ok: true, mensaje: 'Recibimos tus documentos. Te avisaremos el resultado por correo.' });
  } catch (e: any) {
    logger.error('Vinculación: error enviando a revisión', { error: e.message, vinculacionId: v.id });
    res.status(500).json({ ok: false, mensaje: 'No pudimos enviar tu solicitud. Intenta de nuevo.' });
  }
});

export default router;
