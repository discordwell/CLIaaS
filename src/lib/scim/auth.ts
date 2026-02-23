/**
 * SCIM Bearer token authentication.
 * Validates the Authorization header against the configured SCIM token.
 */

import { timingSafeEqual } from 'crypto';

export function validateSCIMAuth(authHeader: string | null): boolean {
  const expectedToken = process.env.SCIM_BEARER_TOKEN;
  if (!expectedToken) return false;
  if (!authHeader) return false;

  const [scheme, token] = authHeader.split(' ', 2);
  if (scheme?.toLowerCase() !== 'bearer' || !token) return false;

  try {
    const a = Buffer.from(expectedToken, 'utf-8');
    const b = Buffer.from(token, 'utf-8');
    if (a.length !== b.length) return false;
    return timingSafeEqual(a, b);
  } catch {
    return false;
  }
}
