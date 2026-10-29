import { Resend } from 'resend';

let resend: Resend | null = null;

function getClient(): Resend | null {
  if (!process.env.RESEND_API_KEY) return null;
  resend ??= new Resend(process.env.RESEND_API_KEY);
  return resend;
}

// Devuelve true si el correo se envió, false si Resend no está configurado (modo local/debug).
export async function sendOtpEmail(to: string, otp: string): Promise<boolean> {
  const client = getClient();
  if (!client) return false;

  const from = process.env.RESEND_FROM || 'TrendPay <noreply@trendpay.com.co>';

  const { error } = await client.emails.send({
    from,
    to,
    subject: 'Tu código de verificación — TrendPay',
    html: `
      <div style="font-family: sans-serif; max-width: 420px; margin: 0 auto;">
        <h2 style="color:#5a1a8a;">TrendPay</h2>
        <p>Tu código de verificación es:</p>
        <p style="font-size: 32px; font-weight: 900; letter-spacing: 6px; color: #852EC7;">${otp}</p>
        <p>Vence en 10 minutos. Si no solicitaste este código, ignora este mensaje.</p>
      </div>
    `,
  });

  if (error) throw new Error(error.message);
  return true;
}

function escapar(texto: string): string {
  return texto.replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c] as string));
}

export type MotivoCorreoVinculacion = 'invitacion' | 'correccion' | 'aprobada' | 'rechazada' | 'contrato' | 'contrato_correccion' | 'completada';

const TEXTOS_VINCULACION: Record<MotivoCorreoVinculacion, { asunto: string; titulo: string; cuerpo: string; boton?: string }> = {
  invitacion: {
    asunto: 'Vinculación a TrendPay: sube tus documentos',
    titulo: 'Te damos la bienvenida a TrendPay',
    cuerpo: 'Para completar la vinculación de {empresa} solo debes subir 5 documentos en nuestro portal seguro. Nuestro equipo los revisará y te avisaremos el resultado.',
    boton: 'Subir documentos',
  },
  correccion: {
    asunto: 'Vinculación a TrendPay: necesitamos corregir un documento',
    titulo: 'Necesitamos que corrijas algo',
    cuerpo: 'Revisamos los documentos de {empresa} y algunos requieren una corrección. Entra al portal para ver el detalle y volver a subirlos.',
    boton: 'Corregir documentos',
  },
  aprobada: {
    asunto: 'Documentos aprobados: sigue el contrato',
    titulo: '¡Tus documentos fueron aprobados!',
    cuerpo: 'Los documentos de {empresa} fueron aprobados. El siguiente paso es el contrato: en breve te lo enviaremos por este mismo medio para que lo firmes.',
  },
  contrato: {
    asunto: 'Tu contrato con TrendPay está listo para firma',
    titulo: 'Firma tu contrato',
    cuerpo: 'Ya está listo el contrato de {empresa}: descárgalo desde el portal, fírmalo (a mano o con firma digital) y sube el PDF firmado.',
    boton: 'Ver y firmar el contrato',
  },
  contrato_correccion: {
    asunto: 'Tu contrato firmado necesita una corrección',
    titulo: 'Necesitamos corregir el contrato',
    cuerpo: 'Revisamos el contrato firmado de {empresa} y necesita una corrección. Entra al portal para ver el detalle y subirlo de nuevo.',
    boton: 'Subir el contrato de nuevo',
  },
  completada: {
    asunto: '¡Vinculación a TrendPay completada!',
    titulo: '¡Vinculación completada!',
    cuerpo: 'Recibimos y validamos el contrato firmado de {empresa}: tu vinculación con TrendPay está completa y nuestro equipo se pondrá en contacto contigo para activar tu cuenta.',
  },
  rechazada: {
    asunto: 'Vinculación a TrendPay: resultado de la evaluación',
    titulo: 'No pudimos continuar con la vinculación',
    cuerpo: 'Después de revisar los documentos de {empresa}, no fue posible aprobar la vinculación en este momento.',
  },
};

// Devuelve true si el correo se envió, false si Resend no está configurado (modo local/debug).
export async function sendVinculacionEmail(
  to: string,
  datos: { motivo: MotivoCorreoVinculacion; nombreContacto: string; empresa: string; enlace?: string; mensaje?: string | null; venceEn?: string },
): Promise<boolean> {
  const client = getClient();
  if (!client) return false;

  const t = TEXTOS_VINCULACION[datos.motivo];
  const from = process.env.RESEND_FROM || 'TrendPay <noreply@trendpay.com.co>';
  const boton = t.boton && datos.enlace
    ? `<p style="margin:28px 0;"><a href="${escapar(datos.enlace)}" style="background:#852EC7;color:#ffffff;text-decoration:none;font-weight:700;padding:14px 28px;border-radius:10px;display:inline-block;">${t.boton}</a></p>`
    : '';
  const mensaje = datos.mensaje
    ? `<div style="background:#f6f1fb;border-left:4px solid #852EC7;padding:12px 16px;border-radius:6px;margin:16px 0;color:#3b2a4d;">${escapar(datos.mensaje)}</div>`
    : '';
  const vence = datos.enlace && datos.venceEn ? `<p style="color:#6b5b78;font-size:13px;">Este enlace es personal y vence el ${escapar(datos.venceEn)}. No lo compartas.</p>` : '';

  const { error } = await client.emails.send({
    from,
    to,
    subject: t.asunto,
    html: `
      <div style="font-family:-apple-system,Segoe UI,sans-serif;max-width:520px;margin:0 auto;color:#241b2f;">
        <h2 style="color:#5a1a8a;margin-bottom:4px;">TrendPay</h2>
        <h3 style="margin-top:24px;">${t.titulo}</h3>
        <p>Hola ${escapar(datos.nombreContacto)},</p>
        <p>${t.cuerpo.replace('{empresa}', `<strong>${escapar(datos.empresa)}</strong>`)}</p>
        ${mensaje}
        ${boton}
        ${vence}
        <p style="color:#6b5b78;font-size:12px;margin-top:32px;">Si no esperabas este mensaje, puedes ignorarlo.</p>
      </div>
    `,
  });

  if (error) throw new Error(error.message);
  return true;
}
