import dns from 'dns';
import nodemailer from 'nodemailer';

// nodemailer resuelve el host por su cuenta con dns.resolve4/resolve6 (ignora
// dns.setDefaultResultOrder). En contenedores donde esa consulta manual por A
// falla (ej. Railway con smtp.hostinger.com), termina conectando solo por
// IPv6 y falla con ENETUNREACH. Resolvemos la IPv4 nosotros mismos con
// dns.lookup (el resolver estándar, que sí funciona bien aquí) y se la
// pasamos directa a nodemailer, manteniendo el hostname real vía
// tls.servername para que la validación del certificado siga siendo correcta.
async function resolveIPv4(host: string): Promise<string> {
  const { address } = await dns.promises.lookup(host, { family: 4 });
  return address;
}

// Devuelve true si el correo se envió, false si SMTP no está configurado (modo local/debug).
export async function sendOtpEmail(to: string, otp: string): Promise<boolean> {
  const host = process.env.SMTP_HOST;
  const user = process.env.SMTP_USER;
  const pass = process.env.SMTP_PASS;
  if (!host || !user || !pass) return false;

  const port = parseInt(process.env.SMTP_PORT || '465', 10);
  const ip = await resolveIPv4(host);

  const transporter = nodemailer.createTransport({
    host: ip,
    port,
    secure: port === 465,
    auth: { user, pass },
    tls: { servername: host },
  });

  await transporter.sendMail({
    from: `TrendPay <${user}>`,
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
  return true;
}
