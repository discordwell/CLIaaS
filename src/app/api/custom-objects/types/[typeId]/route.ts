import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { parseJsonBody } from '@/lib/parse-json-body';
import { requireAuth } from '@/lib/api-auth';
import { getObjectType, updateObjectType, deleteObjectType } from '@/lib/custom-objects';

export const dynamic = 'force-dynamic';

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ typeId: string }> },
) {
  const auth = await requireAuth(request);
  if ('error' in auth) return auth.error;

  const { typeId } = await params;
  const type = getObjectType(typeId);
  if (!type) return NextResponse.json({ error: 'Type not found' }, { status: 404 });

  // Scope by workspace to prevent cross-workspace data leakage
  const workspaceId = auth.user.workspaceId ?? 'default';
  if (type.workspaceId !== workspaceId) {
    return NextResponse.json({ error: 'Type not found' }, { status: 404 });
  }

  return NextResponse.json({ type });
}

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ typeId: string }> },
) {
  const auth = await requireAuth(request);
  if ('error' in auth) return auth.error;

  const { typeId } = await params;

  // Scope by workspace to prevent cross-workspace modification
  const workspaceId = auth.user.workspaceId ?? 'default';
  const existing = getObjectType(typeId);
  if (!existing || existing.workspaceId !== workspaceId) {
    return NextResponse.json({ error: 'Type not found' }, { status: 404 });
  }

  const parsed = await parseJsonBody(request);
  if ('error' in parsed) return parsed.error;
  const body = parsed.data;

  // Strip protected fields to prevent overwriting id/workspaceId/createdAt
  const { id: _id, workspaceId: _ws, createdAt: _ca, ...safeUpdates } = body as Record<string, unknown>;
  const updated = updateObjectType(typeId, safeUpdates);
  if (!updated) return NextResponse.json({ error: 'Type not found' }, { status: 404 });
  return NextResponse.json({ type: updated });
}

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ typeId: string }> },
) {
  const auth = await requireAuth(request);
  if ('error' in auth) return auth.error;

  const { typeId } = await params;

  // Scope by workspace to prevent cross-workspace deletion
  const workspaceId = auth.user.workspaceId ?? 'default';
  const existing = getObjectType(typeId);
  if (!existing || existing.workspaceId !== workspaceId) {
    return NextResponse.json({ error: 'Type not found' }, { status: 404 });
  }

  deleteObjectType(typeId);
  return NextResponse.json({ ok: true });
}
