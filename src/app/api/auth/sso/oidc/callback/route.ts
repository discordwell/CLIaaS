import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { getProvider } from '@/lib/auth/sso-config';
import { exchangeCode, verifyIdToken, fetchUserInfo } from '@/lib/auth/oidc';
import { handleSsoLogin } from '@/lib/auth/sso-session';

export const dynamic = 'force-dynamic';

const COOKIE_OPTIONS = {
  httpOnly: true,
  secure: process.env.NODE_ENV === 'production',
  sameSite: 'lax' as const,
  maxAge: 7 * 24 * 60 * 60,
  path: '/',
};

/**
 * GET /api/auth/sso/oidc/callback?code=xxx&state=yyy
 *
 * Handles the OIDC authorization code callback:
 *  1. Validates state against the oidc-state cookie
 *  2. Exchanges the code for tokens
 *  3. Verifies the ID token or fetches userinfo
 *  4. Creates a session and redirects to /dashboard
 */
export async function GET(request: NextRequest) {
  try {
    const { searchParams } = request.nextUrl;
    const code = searchParams.get('code');
    const stateParam = searchParams.get('state');
    const error = searchParams.get('error');

    // Handle IdP error responses
    if (error) {
      const errorDescription = searchParams.get('error_description') || error;
      return NextResponse.json(
        { error: `IdP returned an error: ${errorDescription}` },
        { status: 400 }
      );
    }

    if (!code || !stateParam) {
      return NextResponse.json(
        { error: 'Missing code or state parameter' },
        { status: 400 }
      );
    }

    // Validate state cookie
    const stateCookie = request.cookies.get('oidc-state')?.value;
    if (!stateCookie) {
      return NextResponse.json(
        { error: 'Missing OIDC state cookie — session may have expired' },
        { status: 400 }
      );
    }

    let storedState: { state: string; providerId: string };
    try {
      storedState = JSON.parse(stateCookie);
    } catch {
      return NextResponse.json(
        { error: 'Invalid OIDC state cookie' },
        { status: 400 }
      );
    }

    if (storedState.state !== stateParam) {
      return NextResponse.json(
        { error: 'OIDC state mismatch — possible CSRF attack' },
        { status: 400 }
      );
    }

    // Load provider
    const provider = getProvider(storedState.providerId);
    if (!provider) {
      return NextResponse.json(
        { error: 'SSO provider not found' },
        { status: 404 }
      );
    }

    // Exchange code for tokens
    const origin = request.nextUrl.origin;
    const callbackUrl = `${origin}/api/auth/sso/oidc/callback`;
    const tokens = await exchangeCode(provider, code, callbackUrl);

    // Get user identity — try ID token first, fall back to userinfo
    let email = '';
    let name = '';

    if (tokens.idToken) {
      try {
        const idUser = await verifyIdToken(tokens.idToken, provider);
        email = idUser.email;
        name = idUser.name ?? '';
      } catch {
        // ID token verification failed, try userinfo
      }
    }

    if (!email && provider.userInfoUrl) {
      const infoUser = await fetchUserInfo(tokens.accessToken, provider);
      email = infoUser.email;
      name = infoUser.name ?? '';
    }

    if (!email) {
      return NextResponse.json(
        { error: 'Could not determine user email from OIDC response' },
        { status: 400 }
      );
    }

    // Bridge to JWT session
    const token = await handleSsoLogin({
      email,
      name: name || email.split('@')[0],
      providerId: provider.id,
    });

    // Set session cookie on the redirect response (not via cookies() API)
    const response = NextResponse.redirect(new URL('/dashboard', origin));
    response.cookies.set('cliaas-session', token, COOKIE_OPTIONS);
    response.cookies.delete('oidc-state');

    return response;
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'OIDC callback failed' },
      { status: 500 }
    );
  }
}
