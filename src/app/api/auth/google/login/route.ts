import { NextResponse } from 'next/server';
import { SignJWT } from 'jose';
import { getJwtSecret } from '@/lib/auth';

export const dynamic = 'force-dynamic';

function publicBase(request: Request): string {
  if (process.env.NEXT_PUBLIC_BASE_URL) return process.env.NEXT_PUBLIC_BASE_URL;
  const proto = request.headers.get('x-forwarded-proto') || 'http';
  const host = request.headers.get('x-forwarded-host') || request.headers.get('host') || 'localhost:3000';
  return `${proto}://${host}`;
}

export async function GET(request: Request) {
  const base = publicBase(request);
  const clientId = process.env.GOOGLE_CLIENT_ID;

  if (!clientId) {
    const referer = request.headers.get('referer') || '';
    const page = referer.includes('/sign-in') ? '/sign-in' : '/sign-up';
    return NextResponse.redirect(
      `${base}${page}?error=${encodeURIComponent('Google sign-in is not configured yet. Use email/password for now.')}`
    );
  }

  // Sign the state as a JWT so the callback can verify it without a cookie.
  // This eliminates the race condition where two tabs overwrite each other's
  // state cookie (google_state_mismatch error).
  const nonce = crypto.randomUUID();
  const state = await new SignJWT({ nonce, purpose: 'google-oauth-state' })
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt()
    .setExpirationTime('10m')
    .sign(getJwtSecret());

  const callbackUrl = `${base}/api/auth/google/callback`;

  const url = new URL('https://accounts.google.com/o/oauth2/v2/auth');
  url.searchParams.set('response_type', 'code');
  url.searchParams.set('client_id', clientId);
  url.searchParams.set('redirect_uri', callbackUrl);
  url.searchParams.set('scope', 'openid email profile');
  url.searchParams.set('state', state);
  url.searchParams.set('access_type', 'online');
  url.searchParams.set('prompt', 'select_account');

  return NextResponse.redirect(url.toString());
}
