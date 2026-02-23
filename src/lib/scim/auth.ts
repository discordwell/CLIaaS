/**
 * SCIM Bearer token authentication.
 * Validates the Authorization header against the configured SCIM token.
 * Uses HMAC normalization to prevent timing-based length leakage.
 */

import { createHmac, timingSafeEqual } from 'crypto';
import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { scimError } from './schema';

const HMAC_KEY = 'cliaas-scim-auth-comparison-key';

function hmacNormalize(value: string): Buffer {
  return createHmac('sha256', HMAC_KEY).update(value).digest();
}

export function validateSCIMAuth(authHeader: string | null): boolean {
  const expectedToken = process.env.SCIM_BEARER_TOKEN;
  if (!expectedToken) return false;
  if (!authHeader) return false;

  const [scheme, token] = authHeader.split(' ', 2);
  if (scheme?.toLowerCase() !== 'bearer' || !token) return false;

  try {
    const a = hmacNormalize(expectedToken);
    const b = hmacNormalize(token);
    return timingSafeEqual(a, b);
  } catch {
    return false;
  }
}

export type SCIMAuthResult =
  | { ok: true }
  | { ok: false; response: NextResponse };

export function requireSCIMAuth(request: NextRequest): SCIMAuthResult {
  if (!validateSCIMAuth(request.headers.get('authorization'))) {
    return {
      ok: false,
      response: NextResponse.json(scimError(401, 'Unauthorized'), { status: 401 }),
    };
  }
  return { ok: true };
}
