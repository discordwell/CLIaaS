import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { getProviders } from '@/lib/auth/sso-config';
import { parseSamlResponse } from '@/lib/auth/saml';
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
 * POST /api/auth/sso/saml/callback
 *
 * SAML Assertion Consumer Service (ACS) endpoint.
 * Receives the SAMLResponse from the IdP via HTTP-POST binding,
 * parses it, creates a session, and redirects to /dashboard.
 */
export async function POST(request: NextRequest) {
  try {
    const formData = await request.formData();
    const samlResponse = formData.get('SAMLResponse') as string | null;
    const relayState = formData.get('RelayState') as string | null;

    if (!samlResponse) {
      return NextResponse.json(
        { error: 'Missing SAMLResponse in form data' },
        { status: 400 }
      );
    }

    // Validate RelayState against stored cookie (CSRF protection)
    const storedRelay = request.cookies.get('saml-relay')?.value;
    if (storedRelay && relayState && storedRelay !== relayState) {
      return NextResponse.json(
        { error: 'SAML RelayState mismatch — possible CSRF attack' },
        { status: 400 }
      );
    }

    // We need to identify which provider this response came from.
    // In a full implementation, the Issuer in the response would be matched.
    // For MVP, we try all enabled SAML providers.
    const providers = getProviders().filter(
      (p) => p.protocol === 'saml' && p.enabled
    );

    if (providers.length === 0) {
      return NextResponse.json(
        { error: 'No SAML providers configured' },
        { status: 400 }
      );
    }

    let samlUser = null;
    let matchedProvider = providers[0];

    for (const provider of providers) {
      try {
        samlUser = await parseSamlResponse(samlResponse, provider);
        matchedProvider = provider;
        break;
      } catch {
        // Try next provider
        continue;
      }
    }

    if (!samlUser) {
      return NextResponse.json(
        { error: 'Failed to parse SAML response from any configured provider' },
        { status: 400 }
      );
    }

    // Bridge to JWT session
    const displayName = [samlUser.firstName, samlUser.lastName]
      .filter(Boolean)
      .join(' ') || samlUser.email.split('@')[0];

    const token = await handleSsoLogin({
      email: samlUser.email,
      name: displayName,
      providerId: matchedProvider.id,
    });

    // Set session cookie on the redirect response (not via cookies() API)
    const redirectTo =
      relayState && relayState.startsWith('/') ? relayState : '/dashboard';
    const origin = request.nextUrl.origin;

    const response = NextResponse.redirect(new URL(redirectTo, origin));
    response.cookies.set('cliaas-session', token, COOKIE_OPTIONS);
    response.cookies.delete('saml-relay');

    return response;
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'SAML callback failed' },
      { status: 500 }
    );
  }
}
