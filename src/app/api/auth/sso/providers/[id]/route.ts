import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import {
  getProvider,
  updateProvider,
  deleteProvider,
  type SSOProvider,
} from '@/lib/auth/sso-config';

export const dynamic = 'force-dynamic';

/**
 * GET /api/auth/sso/providers/[id] — Get a single SSO provider.
 */
export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;

  try {
    const provider = getProvider(id);
    if (!provider) {
      return NextResponse.json(
        { error: 'SSO provider not found' },
        { status: 404 }
      );
    }

    return NextResponse.json({ provider: sanitize(provider) });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Failed to get SSO provider' },
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
  const { id } = await params;

  try {
    const body = await request.json();

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

    const updated = updateProvider(id, updates);
    if (!updated) {
      return NextResponse.json(
        { error: 'SSO provider not found' },
        { status: 404 }
      );
    }

    return NextResponse.json({ provider: sanitize(updated) });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Failed to update SSO provider' },
      { status: 500 }
    );
  }
}

/**
 * DELETE /api/auth/sso/providers/[id] — Delete an SSO provider.
 */
export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;

  try {
    const deleted = deleteProvider(id);
    if (!deleted) {
      return NextResponse.json(
        { error: 'SSO provider not found' },
        { status: 404 }
      );
    }

    return NextResponse.json({ ok: true });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Failed to delete SSO provider' },
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
