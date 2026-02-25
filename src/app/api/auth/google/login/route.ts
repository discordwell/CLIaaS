import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';

export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
  const clientId = process.env.GOOGLE_CLIENT_ID;
  if (!clientId) {
    // Redirect back to sign-up with a friendly error instead of raw JSON
    const referer = request.headers.get('referer') || '/sign-up';
    const target = new URL(referer.includes('/sign-in') ? '/sign-in' : '/sign-up', request.url);
    target.searchParams.set('error', 'Google sign-in is not configured yet. Use email/password for now.');
    return NextResponse.redirect(target.toString());
  }

  const state = crypto.randomUUID();
  const callbackUrl = `${process.env.NEXT_PUBLIC_BASE_URL || 'http://localhost:3000'}/api/auth/google/callback`;

  const url = new URL('https://accounts.google.com/o/oauth2/v2/auth');
  url.searchParams.set('response_type', 'code');
  url.searchParams.set('client_id', clientId);
  url.searchParams.set('redirect_uri', callbackUrl);
  url.searchParams.set('scope', 'openid email profile');
  url.searchParams.set('state', state);
  url.searchParams.set('access_type', 'online');
  url.searchParams.set('prompt', 'select_account');

  const cookieStore = await cookies();
  cookieStore.set('google-oauth-state', state, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    maxAge: 600,
    path: '/',
  });

  return NextResponse.redirect(url.toString());
}
