/**
 * HMAC-signed cookie helpers for portal auth.
 * Cookie format: <base64url-email>.<hmac-sha256-hex-prefix-32chars>
 */

import { createHmac, timingSafeEqual } from 'crypto';

export const PORTAL_COOKIE_NAME = 'cliaas-portal-auth';

const SECRET =
  process.env.PORTAL_COOKIE_SECRET ?? 'dev-portal-secret';

function hmac(data: string): string {
  return createHmac('sha256', SECRET).update(data).digest('hex').slice(0, 32);
}

/** Sign an email into a cookie value. */
export function sign(email: string): string {
  const encoded = Buffer.from(email).toString('base64url');
  return `${encoded}.${hmac(encoded)}`;
}

/** Verify a signed cookie value. Returns the email or null. */
export function verify(raw: string): string | null {
  const dot = raw.indexOf('.');
  if (dot < 1) return null;

  const encoded = raw.slice(0, dot);
  const sig = raw.slice(dot + 1);
  if (!encoded || !sig) return null;

  const expected = hmac(encoded);

  // Constant-time comparison
  try {
    const a = Buffer.from(sig, 'utf8');
    const b = Buffer.from(expected, 'utf8');
    if (a.length !== b.length) return null;
    if (!timingSafeEqual(a, b)) return null;
  } catch {
    return null;
  }

  try {
    return Buffer.from(encoded, 'base64url').toString('utf8');
  } catch {
    return null;
  }
}
