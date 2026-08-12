import nodemailer from 'nodemailer';

let transporter: nodemailer.Transporter | null = null;

function getTransporter(): nodemailer.Transporter | null {
  if (!process.env.SMTP_HOST || !process.env.SMTP_USER || !process.env.SMTP_PASS) return null;
  if (!transporter) {
    const port = parseInt(process.env.SMTP_PORT || '465', 10);
    transporter = nodemailer.createTransport({
      host: process.env.SMTP_HOST,
      port,
      secure: port === 465,
      auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS },
    });
  }
  return transporter;
}

// Devuelve true si el correo se envió, false si SMTP no está configurado (modo local/debug).
export async function sendOtpEmail(to: string, otp: string): Promise<boolean> {
  const t = getTransporter();
  if (!t) return false;

  await t.sendMail({
    from: `TrendPay <${process.env.SMTP_USER}>`,
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
