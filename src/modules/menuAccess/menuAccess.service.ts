import crypto from 'crypto';
import jwt from 'jsonwebtoken';
import { query } from '@/config/database';
import { env } from '@/config/env';
import { BadRequestError, ForbiddenError } from '@/shared/errors/AppError';
import { isEmailConfigured, sendOtpEmail } from '@/shared/email';

const OTP_TTL_SECONDS = 300;      // code valid 5 minutes
const RESEND_GAP_SECONDS = 30;
const MAX_ATTEMPTS = 5;
const TOKEN_TTL = '60m';          // menu stays unlocked for 60 minutes

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

function mask(email: string): string {
  const [name, domain] = email.split('@');
  if (!domain) return email;
  return `${name.slice(0, Math.min(2, name.length))}••••@${domain}`;
}

function hashCode(restaurantId: string, code: string): string {
  return crypto.createHash('sha256').update(`${restaurantId}:${code}:${env.JWT_SECRET}`).digest('hex');
}

export async function getMenuOtpEmail(restaurantId: string): Promise<string | null> {
  const r = await query('SELECT menu_otp_email FROM restaurants WHERE id = $1', [restaurantId]);
  return r.rows[0]?.menu_otp_email || null;
}

export function isMenuTokenValid(token: string | undefined, userId: string, restaurantId: string): boolean {
  if (!token) return false;
  try {
    const p = jwt.verify(token, env.JWT_SECRET, { algorithms: ['HS256'] }) as any;
    return p.typ === 'menu-otp' && p.uid === userId && p.rid === restaurantId;
  } catch {
    return false;
  }
}

export const menuAccessService = {
  async status(userId: string, restaurantId: string, token?: string) {
    const email = await getMenuOtpEmail(restaurantId);
    return {
      required: Boolean(email),
      verified: !email || isMenuTokenValid(token, userId, restaurantId),
      email_masked: email ? mask(email) : null,
      email_configured: isEmailConfigured(),
    };
  },

  async requestOtp(userId: string, restaurantId: string) {
    const email = await getMenuOtpEmail(restaurantId);
    if (!email) throw new BadRequestError('No security email is set for the menu');

    const last = await query(
      `SELECT created_at FROM menu_access_otps WHERE restaurant_id = $1 AND user_id = $2 ORDER BY created_at DESC LIMIT 1`,
      [restaurantId, userId],
    );
    if (last.rows[0] && Date.now() - new Date(last.rows[0].created_at).getTime() < RESEND_GAP_SECONDS * 1000) {
      throw new BadRequestError(`Please wait ${RESEND_GAP_SECONDS} seconds before requesting another code`);
    }

    const code = String(crypto.randomInt(0, 1_000_000)).padStart(6, '0');
    await query(`UPDATE menu_access_otps SET consumed_at = NOW() WHERE restaurant_id = $1 AND user_id = $2 AND consumed_at IS NULL`, [restaurantId, userId]);
    await query(
      `INSERT INTO menu_access_otps (restaurant_id, user_id, code_hash, expires_at)
       VALUES ($1, $2, $3, NOW() + INTERVAL '${OTP_TTL_SECONDS} seconds')`,
      [restaurantId, userId, hashCode(restaurantId, code)],
    );

    const sent = isEmailConfigured() ? await sendOtpEmail(email, code, OTP_TTL_SECONDS / 60) : false;
    if (!sent) {
      // No (working) email provider: print in the server logs so the owner is never locked out.
      console.log(`[menu-otp] ${email} -> ${code}`);
    }
    return {
      email_masked: mask(email),
      sent,
      note: sent ? undefined : 'Email is not set up on the server or failed. The code was printed in the server logs.',
    };
  },

  async verify(userId: string, restaurantId: string, code: string) {
    const r = await query(
      `SELECT id, code_hash, attempts FROM menu_access_otps
       WHERE restaurant_id = $1 AND user_id = $2 AND consumed_at IS NULL AND expires_at > NOW()
       ORDER BY created_at DESC LIMIT 1`,
      [restaurantId, userId],
    );
    const row = r.rows[0];
    if (!row) throw new BadRequestError('Code expired. Please request a new one.');
    if (row.attempts >= MAX_ATTEMPTS) {
      await query(`UPDATE menu_access_otps SET consumed_at = NOW() WHERE id = $1`, [row.id]);
      throw new BadRequestError('Too many wrong attempts. Please request a new code.');
    }
    const expected = Buffer.from(row.code_hash);
    const actual = Buffer.from(hashCode(restaurantId, code));
    if (expected.length !== actual.length || !crypto.timingSafeEqual(expected, actual)) {
      await query(`UPDATE menu_access_otps SET attempts = attempts + 1 WHERE id = $1`, [row.id]);
      throw new BadRequestError('Incorrect code');
    }
    await query(`UPDATE menu_access_otps SET consumed_at = NOW() WHERE id = $1`, [row.id]);
    const token = jwt.sign({ typ: 'menu-otp', uid: userId, rid: restaurantId }, env.JWT_SECRET, { expiresIn: TOKEN_TTL as any, algorithm: 'HS256' });
    return { token, expires_in_minutes: 60 };
  },

  /** Set / change / remove the security email. Changing or removing an existing one needs a verified token. */
  async setEmail(userId: string, restaurantId: string, rawEmail: string, token?: string) {
    const existing = await getMenuOtpEmail(restaurantId);
    if (existing && !isMenuTokenValid(token, userId, restaurantId)) {
      throw new ForbiddenError('Verify with an OTP first to change the security email');
    }
    const trimmed = (rawEmail || '').trim().toLowerCase();
    if (!trimmed) {
      await query('UPDATE restaurants SET menu_otp_email = NULL WHERE id = $1', [restaurantId]);
      return { email_masked: null };
    }
    if (!EMAIL_RE.test(trimmed) || trimmed.length > 255) throw new BadRequestError('Enter a valid email address');
    await query('UPDATE restaurants SET menu_otp_email = $2 WHERE id = $1', [restaurantId, trimmed]);
    return { email_masked: mask(trimmed) };
  },
};
