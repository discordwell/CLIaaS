import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import {
  getProviderAsync,
  updateProviderAsync,
  deleteProviderAsync,
  type SSOProvider,
} from '@/lib/auth/sso-config';
import { requirePerm } from '@/lib/rbac';
import { parseJsonBody, safeErrorMessage } from '@/lib/parse-json-body';

export const dynamic = 'force-dynamic';

/**
 * GET /api/auth/sso/providers/[id] — Get a single SSO provider.
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const auth = await requirePerm(request, 'admin:settings', 'admin');
  if ('error' in auth) return auth.error;

  const { id } = await params;

  try {
    const provider = await getProviderAsync(id);
    if (!provider) {
      return NextResponse.json(
        { error: 'SSO provider not found' },
        { status: 404 }
      );
    }

    return NextResponse.json({ provider: sanitize(provider) });
  } catch (err) {
    return NextResponse.json(
      { error: safeErrorMessage(err, 'Failed to get SSO provider') },
      { status: 500 }
    );
  }
}

/**
 * PATCH /api/auth/sso/providers/[id] — Update an SSO provider.
 */
export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const auth = await requirePerm(request, 'admin:settings', 'admin');
  if ('error' in auth) return auth.error;

  const { id } = await params;

  const parsed = await parseJsonBody(request);
  if ('error' in parsed) return parsed.error;

  try {
    const body = parsed.data;

    // Build update object from allowed fields
    const updates: Partial<Omit<SSOProvider, 'id' | 'createdAt'>> = {};
    const allowedFields = [
      'name',
      'protocol',
      'enabled',
      'entityId',
      'ssoUrl',
      'certificate',
      'clientId',
      'clientSecret',
      'issuer',
      'authorizationUrl',
      'tokenUrl',
      'userInfoUrl',
      'domainHint',
    ] as const;

    for (const field of allowedFields) {
      if (body[field] !== undefined) {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (updates as any)[field] = body[field];
      }
    }

    // Prevent removing certificate from SAML providers or switching to SAML without one
    const existing = await getProviderAsync(id);
    if (existing) {
      const resultProtocol = updates.protocol ?? existing.protocol;
      const resultCert = updates.certificate !== undefined ? updates.certificate : existing.certificate;
      if (resultProtocol === 'saml' && !resultCert) {
        return NextResponse.json(
          { error: 'SAML providers require an IdP X.509 certificate. Cannot remove certificate or switch to SAML without one.' },
          { status: 400 }
        );
      }
    }

    const updated = await updateProviderAsync(id, updates);
    if (!updated) {
      return NextResponse.json(
        { error: 'SSO provider not found' },
        { status: 404 }
      );
    }

    return NextResponse.json({ provider: sanitize(updated) });
  } catch (err) {
    return NextResponse.json(
      { error: safeErrorMessage(err, 'Failed to update SSO provider') },
      { status: 500 }
    );
  }
}

/**
 * DELETE /api/auth/sso/providers/[id] — Delete an SSO provider.
 */
export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const auth = await requirePerm(request, 'admin:settings', 'admin');
  if ('error' in auth) return auth.error;

  const { id } = await params;

  try {
    const deleted = await deleteProviderAsync(id);
    if (!deleted) {
      return NextResponse.json(
        { error: 'SSO provider not found' },
        { status: 404 }
      );
    }

    return NextResponse.json({ ok: true });
  } catch (err) {
    return NextResponse.json(
      { error: safeErrorMessage(err, 'Failed to delete SSO provider') },
      { status: 500 }
    );
  }
}

function sanitize(p: SSOProvider) {
  return {
    ...p,
    clientSecret: p.clientSecret ? '••••••••' : undefined,
    certificate: p.certificate ? `${p.certificate.slice(0, 20)}...` : undefined,
  };
}
