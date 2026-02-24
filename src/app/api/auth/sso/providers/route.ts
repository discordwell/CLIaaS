import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import {
  getProviders,
  createProvider,
  type SSOProvider,
} from '@/lib/auth/sso-config';
import { requireRole } from '@/lib/api-auth';
import { parseJsonBody } from '@/lib/parse-json-body';

export const dynamic = 'force-dynamic';

/**
 * GET /api/auth/sso/providers — List all SSO providers.
 */
export async function GET(request: NextRequest) {
  const auth = await requireRole(request, 'admin');
  if ('error' in auth) return auth.error;

  try {
    const providers = getProviders();

    // Strip secrets from the response
    const safe = providers.map(sanitize);

    return NextResponse.json({ providers: safe });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Failed to list SSO providers' },
      { status: 500 }
    );
  }
}

/**
 * POST /api/auth/sso/providers — Create a new SSO provider.
 */
export async function POST(request: NextRequest) {
  const auth = await requireRole(request, 'admin');
  if ('error' in auth) return auth.error;

  const parsed = await parseJsonBody(request);
  if ('error' in parsed) return parsed.error;

  try {
    const body = parsed.data;
    const { name, protocol, enabled } = body;

    if (!name || !protocol) {
      return NextResponse.json(
        { error: 'name and protocol are required' },
        { status: 400 }
      );
    }

    if (protocol !== 'saml' && protocol !== 'oidc') {
      return NextResponse.json(
        { error: 'protocol must be "saml" or "oidc"' },
        { status: 400 }
      );
    }

    const provider = createProvider({
      name,
      protocol,
      enabled: enabled ?? true,
      // SAML fields
      entityId: body.entityId,
      ssoUrl: body.ssoUrl,
      certificate: body.certificate,
      // OIDC fields
      clientId: body.clientId,
      clientSecret: body.clientSecret,
      issuer: body.issuer,
      authorizationUrl: body.authorizationUrl,
      tokenUrl: body.tokenUrl,
      userInfoUrl: body.userInfoUrl,
      // Common
      domainHint: body.domainHint,
    });

    return NextResponse.json({ provider: sanitize(provider) }, { status: 201 });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Failed to create SSO provider' },
      { status: 500 }
    );
  }
}

/**
 * Strip sensitive fields (clientSecret, certificate) from provider objects
 * before returning them in API responses.
 */
function sanitize(p: SSOProvider) {
  return {
    ...p,
    clientSecret: p.clientSecret ? '••••••••' : undefined,
    certificate: p.certificate ? `${p.certificate.slice(0, 20)}...` : undefined,
  };
}
