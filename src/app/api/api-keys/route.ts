import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { requireRole } from '@/lib/api-auth';
import { createApiKey, listApiKeys } from '@/lib/api-keys';
import { parseJsonBody } from '@/lib/parse-json-body';

export const dynamic = 'force-dynamic';

/**
 * GET /api/api-keys — List all active API keys for the workspace.
 */
export async function GET(request: NextRequest) {
  const auth = await requireRole(request, 'admin');
  if ('error' in auth) return auth.error;

  try {
    const keys = await listApiKeys(auth.user.workspaceId);
    return NextResponse.json({ keys });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Failed to list API keys' },
      { status: 500 },
    );
  }
}

/**
 * POST /api/api-keys — Create a new API key. Returns the raw key once.
 */
export async function POST(request: NextRequest) {
  const auth = await requireRole(request, 'admin');
  if ('error' in auth) return auth.error;

  const parsed = await parseJsonBody<{
    name?: string;
    scopes?: string[];
    expiresAt?: string;
  }>(request);
  if ('error' in parsed) return parsed.error;

  try {
    const { name, scopes, expiresAt } = parsed.data;

    if (!name || !name.trim()) {
      return NextResponse.json(
        { error: 'name is required' },
        { status: 400 },
      );
    }

    const result = await createApiKey({
      workspaceId: auth.user.workspaceId,
      name: name.trim(),
      scopes,
      expiresAt: expiresAt ? new Date(expiresAt) : undefined,
      createdBy: auth.user.id,
    });

    return NextResponse.json({
      key: result.key,
      rawKey: result.rawKey,
    }, { status: 201 });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Failed to create API key' },
      { status: 500 },
    );
  }
}
