import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { getProvider } from '@/lib/auth/sso-config';
import { buildAuthnRequest } from '@/lib/auth/saml';

export const dynamic = 'force-dynamic';

/**
 * GET /api/auth/sso/saml/login?provider_id=xxx
 *
 * Builds a SAML AuthnRequest and redirects the user to the IdP's SSO URL.
 */
export async function GET(request: NextRequest) {
  try {
    const providerId = request.nextUrl.searchParams.get('provider_id');

    if (!providerId) {
      return NextResponse.json(
        { error: 'provider_id query parameter is required' },
        { status: 400 }
      );
    }

    const provider = getProvider(providerId);
    if (!provider) {
      return NextResponse.json(
        { error: 'SSO provider not found' },
        { status: 404 }
      );
    }

    if (!provider.enabled) {
      return NextResponse.json(
        { error: 'SSO provider is disabled' },
        { status: 403 }
      );
    }

    if (provider.protocol !== 'saml') {
      return NextResponse.json(
        { error: 'Provider is not a SAML provider. Use /api/auth/sso/oidc/login instead.' },
        { status: 400 }
      );
    }

    // Determine callback URL from the request origin
    const origin = request.nextUrl.origin;
    const callbackUrl = `${origin}/api/auth/sso/saml/callback`;

    const { url, relayState } = buildAuthnRequest(provider, callbackUrl);

    // Store relayState in a cookie for CSRF validation in the callback
    const response = NextResponse.redirect(url);
    response.cookies.set('saml-relay', relayState, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
      maxAge: 600, // 10 minutes
      path: '/',
    });

    return response;
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'SAML login failed' },
      { status: 500 }
    );
  }
}
