/**
 * Minimal SMS sender. Choose a provider with env vars (no extra npm packages needed):
 *
 *   SMS_PROVIDER=msg91     SMS_API_KEY=<authkey>  MSG91_TEMPLATE_ID=<otp template id>
 *   SMS_PROVIDER=fast2sms  SMS_API_KEY=<api key>
 *   SMS_PROVIDER=twilio    TWILIO_ACCOUNT_SID=...  TWILIO_AUTH_TOKEN=...  TWILIO_FROM=+1...
 *
 * With no provider set, nothing is sent: the OTP is printed in the server logs instead.
 */
export function isSmsConfigured(): boolean {
  return ['msg91', 'fast2sms', 'twilio'].includes((process.env.SMS_PROVIDER || '').toLowerCase());
}

/** `purpose` finishes the sentence "Your code to ___ is 123456" — say what the code is for. */
export async function sendOtpSms(phoneE164: string, code: string, purpose = 'verify your phone number'): Promise<boolean> {
  const provider = (process.env.SMS_PROVIDER || '').toLowerCase();
  const digits = phoneE164.replace(/\D/g, '');
  const local10 = digits.slice(-10);

  try {
    if (provider === 'msg91') {
      const url = `https://control.msg91.com/api/v5/otp?template_id=${encodeURIComponent(process.env.MSG91_TEMPLATE_ID || '')}&mobile=${digits}&authkey=${encodeURIComponent(process.env.SMS_API_KEY || '')}&otp=${code}`;
      const r = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' });
      return r.ok;
    }
    if (provider === 'fast2sms') {
      const r = await fetch('https://www.fast2sms.com/dev/bulkV2', {
        method: 'POST',
        headers: { authorization: process.env.SMS_API_KEY || '', 'Content-Type': 'application/json' },
        body: JSON.stringify({ route: 'otp', variables_values: code, numbers: local10 }),
      });
      return r.ok;
    }
    if (provider === 'twilio') {
      const sid = process.env.TWILIO_ACCOUNT_SID || '';
      const auth = Buffer.from(`${sid}:${process.env.TWILIO_AUTH_TOKEN || ''}`).toString('base64');
      const body = new URLSearchParams({ To: phoneE164, From: process.env.TWILIO_FROM || '', Body: `Your code to ${purpose} is ${code}. Valid for 5 minutes. Do not share it.` });
      const r = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${sid}/Messages.json`, {
        method: 'POST',
        headers: { Authorization: `Basic ${auth}`, 'Content-Type': 'application/x-www-form-urlencoded' },
        body,
      });
      return r.ok;
    }
  } catch (err) {
    console.error('[sms] send failed:', err);
    return false;
  }
  return false;
}
