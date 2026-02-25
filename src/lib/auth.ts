import { SignJWT, jwtVerify } from 'jose';
import { cookies } from 'next/headers';
import type { Role } from '@/lib/api-auth';
import { trackToken, consumeToken } from '@/lib/auth/mfa-token-store';

let _jwtSecret: Uint8Array | null = null;

export function getJwtSecret(): Uint8Array {
  if (!_jwtSecret) {
    const secret = process.env.AUTH_SECRET;
    if (!secret && process.env.NODE_ENV === 'production') {
      throw new Error('AUTH_SECRET environment variable is required in production');
    }
    _jwtSecret = new TextEncoder().encode(secret || 'cliaas-dev-secret-change-in-production');
  }
  return _jwtSecret;
}

export const COOKIE_NAME = 'cliaas-session';

export interface SessionUser {
  id: string;
  email: string;
  name: string;
  role: Role;
  workspaceId: string;
  tenantId: string;
}

export async function createToken(user: SessionUser): Promise<string> {
  return new SignJWT({ ...user })
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt()
    .setExpirationTime('7d')
    .sign(getJwtSecret());
}

export async function verifyToken(token: string): Promise<SessionUser | null> {
  try {
    const { payload } = await jwtVerify(token, getJwtSecret());
    // Reject intermediate MFA tokens — they cannot be used as full sessions
    if (payload.mfaPending) return null;
    return payload as unknown as SessionUser;
  } catch {
    return null;
  }
}

export async function getSession(): Promise<SessionUser | null> {
  try {
    const cookieStore = await cookies();
    const token = cookieStore.get(COOKIE_NAME)?.value;
    if (!token) return null;
    return verifyToken(token);
  } catch {
    return null;
  }
}

export const INDICATOR_COOKIE = 'cliaas-logged-in';

export async function setSessionCookie(token: string) {
  const cookieStore = await cookies();
  const cookieOpts = {
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax' as const,
    maxAge: 7 * 24 * 60 * 60,
    path: '/',
  };
  cookieStore.set(COOKIE_NAME, token, { ...cookieOpts, httpOnly: true });
  // Non-httpOnly indicator so client JS can detect login state
  cookieStore.set(INDICATOR_COOKIE, '1', { ...cookieOpts, httpOnly: false });
}

export async function clearSessionCookie() {
  const cookieStore = await cookies();
  cookieStore.delete(COOKIE_NAME);
  cookieStore.delete(INDICATOR_COOKIE);
}

/**
 * Create a short-lived intermediate token for MFA pending state.
 * This token cannot be used for API access — only for completing MFA verification.
 * Includes a JTI (JWT ID) for single-use enforcement.
 */
export async function createIntermediateToken(user: SessionUser): Promise<string> {
  const jti = crypto.randomUUID();
  const expiresAt = Date.now() + 5 * 60 * 1000; // 5 minutes
  trackToken(jti, expiresAt);

  return new SignJWT({ ...user, mfaPending: true })
    .setProtectedHeader({ alg: 'HS256' })
    .setJti(jti)
    .setIssuedAt()
    .setExpirationTime('5m')
    .sign(getJwtSecret());
}

/**
 * Verify an intermediate MFA token. Returns the user payload only if
 * the token has mfaPending: true, is still valid, and has not been used before.
 * Consumes the JTI to prevent replay attacks.
 */
export async function verifyIntermediateToken(token: string): Promise<SessionUser | null> {
  try {
    const { payload } = await jwtVerify(token, getJwtSecret());
    if (!payload.mfaPending) return null;

    // Enforce single-use via JTI — reject tokens without a JTI
    if (!payload.jti || !consumeToken(payload.jti)) return null;

    return {
      id: payload.id as string,
      email: payload.email as string,
      name: payload.name as string,
      role: payload.role as Role,
      workspaceId: payload.workspaceId as string,
      tenantId: payload.tenantId as string,
    };
  } catch {
    return null;
  }
}
