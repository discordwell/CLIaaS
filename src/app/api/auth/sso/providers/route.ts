import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import {
  getProvidersAsync,
  createProviderAsync,
  type SSOProvider,
} from '@/lib/auth/sso-config';
import { requirePerm } from '@/lib/rbac';
import { parseJsonBody, safeErrorMessage } from '@/lib/parse-json-body';

export const dynamic = 'force-dynamic';

/**
 * GET /api/auth/sso/providers — List all SSO providers.
 */
export async function GET(request: NextRequest) {
  const auth = await requirePerm(request, 'admin:settings', 'admin');
  if ('error' in auth) return auth.error;

  try {
    const providers = await getProvidersAsync(auth.user.workspaceId);

    // Strip secrets from the response
    const safe = providers.map(sanitize);

    return NextResponse.json({ providers: safe });
  } catch (err) {
    return NextResponse.json(
      { error: safeErrorMessage(err, 'Failed to list SSO providers') },
      { status: 500 }
    );
  }
}

/**
 * POST /api/auth/sso/providers — Create a new SSO provider.
 */
export async function POST(request: NextRequest) {
  const auth = await requirePerm(request, 'admin:settings', 'admin');
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

    if (protocol === 'saml' && !body.certificate) {
      return NextResponse.json(
        { error: 'SAML providers require an IdP X.509 certificate. Provide the "certificate" field (base64-encoded or PEM).' },
        { status: 400 }
      );
    }

    const provider = await createProviderAsync({
      name,
      protocol,
      enabled: enabled ?? true,
      workspaceId: auth.user.workspaceId,
      // SAML fields
      entityId: body.entityId,
      ssoUrl: body.ssoUrl,
      certificate: body.certificate,
      signedAssertions: body.signedAssertions,
      forceAuthn: body.forceAuthn,
      // OIDC fields
      clientId: body.clientId,
      clientSecret: body.clientSecret,
      issuer: body.issuer,
      authorizationUrl: body.authorizationUrl,
      tokenUrl: body.tokenUrl,
      userInfoUrl: body.userInfoUrl,
      // Common
      domainHint: body.domainHint,
      jitEnabled: body.jitEnabled,
      defaultRole: body.defaultRole,
    });

    return NextResponse.json({ provider: sanitize(provider) }, { status: 201 });
  } catch (err) {
    return NextResponse.json(
      { error: safeErrorMessage(err, 'Failed to create SSO provider') },
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
