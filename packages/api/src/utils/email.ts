import { Resend } from 'resend';

let resend: Resend | null = null;

function getClient(): Resend | null {
  if (!process.env.RESEND_API_KEY) return null;
  if (!resend) resend = new Resend(process.env.RESEND_API_KEY);
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
