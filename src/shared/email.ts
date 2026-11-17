/**
 * Minimal email sender (no extra npm packages — plain HTTPS calls). Choose a provider with env vars:
 *
 *   EMAIL_PROVIDER=brevo    EMAIL_API_KEY=<Brevo API key (v3)>   EMAIL_FROM=<a sender you verified in Brevo>
 *   EMAIL_PROVIDER=resend   EMAIL_API_KEY=<Resend API key>       EMAIL_FROM=<an address on a domain verified in Resend>
 *
 *   EMAIL_FROM_NAME   (optional) display name, default "AuraOS"
 *
 * Brevo is the easiest without your own domain: verify one sender address (e.g. a Gmail) and send up to
 * 300 emails/day free. With no provider set, nothing is sent: the OTP is printed in the server logs instead.
 */
const PROVIDERS = ['brevo', 'resend'];

export function isEmailConfigured(): boolean {
  return (
    PROVIDERS.includes((process.env.EMAIL_PROVIDER || '').toLowerCase()) &&
    !!process.env.EMAIL_API_KEY &&
    !!process.env.EMAIL_FROM
  );
}

async function sendEmail(to: string, subject: string, text: string, html: string): Promise<boolean> {
  const provider = (process.env.EMAIL_PROVIDER || '').toLowerCase();
  const from = process.env.EMAIL_FROM || '';
  const fromName = process.env.EMAIL_FROM_NAME || 'AuraOS';
  const key = process.env.EMAIL_API_KEY || '';

  try {
    let res: Response | null = null;
    if (provider === 'brevo') {
      res = await fetch('https://api.brevo.com/v3/smtp/email', {
        method: 'POST',
        headers: { 'api-key': key, 'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify({ sender: { name: fromName, email: from }, to: [{ email: to }], subject, textContent: text, htmlContent: html }),
        signal: AbortSignal.timeout(15000),
      });
    } else if (provider === 'resend') {
      res = await fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ from: `${fromName} <${from}>`, to: [to], subject, text, html }),
        signal: AbortSignal.timeout(15000),
      });
    }
    if (!res) return false;
    if (!res.ok) {
      console.error(`[email] ${provider} rejected the message (${res.status}):`, (await res.text().catch(() => '')).slice(0, 300));
      return false;
    }
    return true;
  } catch (err) {
    console.error('[email] send failed:', err);
    return false;
  }
}

/** Sends the 6-digit menu access code. Returns true only if the provider accepted the email. */
export async function sendOtpEmail(to: string, code: string, minutesValid = 5): Promise<boolean> {
  if (!isEmailConfigured()) return false;
  const text = `Your menu access code is ${code}.\nIt is valid for ${minutesValid} minutes. If you did not ask for it, ignore this email.`;
  const html =
    `<div style="font-family:Arial,sans-serif;max-width:420px;margin:auto;padding:24px">` +
    `<h2 style="margin:0 0 8px">Menu access code</h2>` +
    `<p style="color:#555;margin:0 0 16px">Use this code to unlock the Menu page:</p>` +
    `<p style="font-size:32px;letter-spacing:8px;font-weight:bold;margin:0 0 16px">${code}</p>` +
    `<p style="color:#888;font-size:13px;margin:0">Valid for ${minutesValid} minutes. If you did not ask for it, ignore this email.</p></div>`;
  return sendEmail(to, `${code} is your menu access code`, text, html);
}
