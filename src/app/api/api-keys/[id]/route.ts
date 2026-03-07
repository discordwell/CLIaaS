import { safeErrorMessage } from '@/lib/parse-json-body';
import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { requirePerm } from '@/lib/rbac';
import { revokeApiKey } from '@/lib/api-keys';

export const dynamic = 'force-dynamic';

/**
 * DELETE /api/api-keys/[id] — Revoke an API key.
 */
export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const auth = await requirePerm(request, 'admin:api_keys', 'admin');
  if ('error' in auth) return auth.error;

  const { id } = await params;

  try {
    const revoked = await revokeApiKey(id, auth.user.workspaceId);
    if (!revoked) {
      return NextResponse.json(
        { error: 'API key not found or already revoked' },
        { status: 404 },
      );
    }
    return NextResponse.json({ ok: true });
  } catch (err) {
    return NextResponse.json(
      { error: safeErrorMessage(err, 'Failed to revoke API key') },
      { status: 500 },
    );
  }
}
