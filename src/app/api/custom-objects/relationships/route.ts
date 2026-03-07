import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { parseJsonBody, safeErrorMessage } from '@/lib/parse-json-body';
import { requirePerm } from '@/lib/rbac';
import { listRelationships, createRelationship, deleteRelationship } from '@/lib/custom-objects';

export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  const auth = await requirePerm(request, 'tickets:view');
  if ('error' in auth) return auth.error;

  const { searchParams } = new URL(request.url);
  const workspaceId = auth.user.workspaceId ?? 'default';
  const rels = listRelationships({
    sourceType: searchParams.get('sourceType') ?? undefined,
    sourceId: searchParams.get('sourceId') ?? undefined,
    targetType: searchParams.get('targetType') ?? undefined,
    targetId: searchParams.get('targetId') ?? undefined,
    workspaceId,
  });
  return NextResponse.json({ relationships: rels });
}

export async function POST(request: NextRequest) {
  const auth = await requirePerm(request, 'admin:settings');
  if ('error' in auth) return auth.error;

  const parsed = await parseJsonBody(request);
  if ('error' in parsed) return parsed.error;
  const body = parsed.data;

  const workspaceId = auth.user.workspaceId ?? 'default';
  const { sourceType, sourceId, targetType, targetId, relationshipType } = body;

  if (!sourceType || !sourceId || !targetType || !targetId) {
    return NextResponse.json({ error: 'sourceType, sourceId, targetType, targetId are required' }, { status: 400 });
  }

  try {
    const rel = createRelationship({
      workspaceId,
      sourceType,
      sourceId,
      targetType,
      targetId,
      relationshipType: relationshipType ?? 'related',
      metadata: {},
    });
    return NextResponse.json({ relationship: rel }, { status: 201 });
  } catch (err) {
    return NextResponse.json(
      { error: safeErrorMessage(err, 'Failed to create relationship') },
      { status: 400 },
    );
  }
}

export async function DELETE(request: NextRequest) {
  const auth = await requirePerm(request, 'admin:settings');
  if ('error' in auth) return auth.error;

  const { searchParams } = new URL(request.url);
  const id = searchParams.get('id');
  if (!id) return NextResponse.json({ error: 'id query param required' }, { status: 400 });

  // Scope by workspace to prevent cross-workspace deletion
  const workspaceId = auth.user.workspaceId ?? 'default';
  const allRels = listRelationships({ workspaceId });
  const rel = allRels.find(r => r.id === id);
  if (!rel) return NextResponse.json({ error: 'Relationship not found' }, { status: 404 });

  deleteRelationship(id);
  return NextResponse.json({ ok: true });
}
