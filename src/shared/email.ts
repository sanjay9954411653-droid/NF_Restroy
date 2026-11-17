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

export type OtpPurpose = 'menu' | 'records' | 'security';

// What each code is for — shown in the email subject and body so the owner knows what they are approving.
const OTP_COPY: Record<OtpPurpose, { subject: string; heading: string; line: string }> = {
  menu: {
    subject: 'code to unlock the Menu page',
    heading: 'Unlock the Menu page',
    line: 'Use this code to unlock the Menu page and edit menu items and prices:',
  },
  records: {
    subject: 'code to edit or delete a record',
    heading: 'Edit or delete a record',
    line: 'Someone is trying to change or delete a recorded order or payment. Use this code to allow it:',
  },
  security: {
    subject: 'code to change the admin email',
    heading: 'Change the admin email',
    line: 'Use this code to change or remove the admin email that receives these codes:',
  },
};

/** Sends a 6-digit security code, worded for what it unlocks. Returns true only if the provider accepted the email. */
export async function sendOtpEmail(to: string, code: string, minutesValid = 5, purpose: OtpPurpose = 'menu'): Promise<boolean> {
  if (!isEmailConfigured()) return false;
  const c = OTP_COPY[purpose] || OTP_COPY.menu;
  const text = `${c.heading}\n\n${c.line}\n\n${code}\n\nIt is valid for ${minutesValid} minutes. If you did not ask for it, ignore this email and do not share the code.`;
  const html =
    `<div style="font-family:Arial,sans-serif;max-width:420px;margin:auto;padding:24px">` +
    `<h2 style="margin:0 0 8px">${c.heading}</h2>` +
    `<p style="color:#555;margin:0 0 16px">${c.line}</p>` +
    `<p style="font-size:32px;letter-spacing:8px;font-weight:bold;margin:0 0 16px">${code}</p>` +
    `<p style="color:#888;font-size:13px;margin:0">Valid for ${minutesValid} minutes. If you did not ask for it, ignore this email and do not share the code.</p></div>`;
  return sendEmail(to, `${code} is your ${c.subject}`, text, html);
}
