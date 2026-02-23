import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { getProvider } from '@/lib/auth/sso-config';
import { buildAuthorizationUrl } from '@/lib/auth/oidc';

export const dynamic = 'force-dynamic';

/**
 * GET /api/auth/sso/oidc/login?provider_id=xxx
 *
 * Generates a random state, stores it in a cookie, builds the OIDC
 * authorization URL, and redirects the user to the IdP.
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

    if (provider.protocol !== 'oidc') {
      return NextResponse.json(
        { error: 'Provider is not an OIDC provider. Use /api/auth/sso/saml/login instead.' },
        { status: 400 }
      );
    }

    // Generate state for CSRF protection
    const state = crypto.randomUUID();

    // Build callback URL
    const origin = request.nextUrl.origin;
    const callbackUrl = `${origin}/api/auth/sso/oidc/callback`;

    const authUrl = buildAuthorizationUrl(provider, callbackUrl, state);

    // Store state + provider ID in a cookie so callback can validate
    const statePayload = JSON.stringify({ state, providerId });
    const response = NextResponse.redirect(authUrl);
    response.cookies.set('oidc-state', statePayload, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
      maxAge: 600, // 10 minutes
      path: '/',
    });

    return response;
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'OIDC login failed' },
      { status: 500 }
    );
  }
}
