import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { requirePerm } from '@/lib/rbac';
import { getProcedure, updateProcedure, deleteProcedure } from '@/lib/ai/procedures';

export const dynamic = 'force-dynamic';

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const auth = await requirePerm(request, 'automation:edit', 'admin');
  if ('error' in auth) return auth.error;

  const { id } = await params;
  const procedure = await getProcedure(id);

  if (!procedure || procedure.workspaceId !== auth.user.workspaceId) {
    return NextResponse.json({ error: 'Procedure not found' }, { status: 404 });
  }

  return NextResponse.json({ procedure });
}

export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const auth = await requirePerm(request, 'automation:edit', 'admin');
  if ('error' in auth) return auth.error;

  const { id } = await params;

  // Verify ownership
  const existing = await getProcedure(id);
  if (!existing || existing.workspaceId !== auth.user.workspaceId) {
    return NextResponse.json({ error: 'Procedure not found' }, { status: 404 });
  }

  const body = await request.json();
  const { name, description, steps, triggerTopics, enabled } = body;

  if (steps !== undefined && !Array.isArray(steps)) {
    return NextResponse.json({ error: 'steps must be an array' }, { status: 400 });
  }
  if (triggerTopics !== undefined && !Array.isArray(triggerTopics)) {
    return NextResponse.json({ error: 'triggerTopics must be an array' }, { status: 400 });
  }

  const updated = await updateProcedure(id, {
    name,
    description,
    steps,
    triggerTopics,
    enabled,
  });

  if (!updated) {
    return NextResponse.json({ error: 'Procedure not found' }, { status: 404 });
  }

  return NextResponse.json({ procedure: updated });
}

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const auth = await requirePerm(request, 'automation:edit', 'admin');
  if ('error' in auth) return auth.error;

  const { id } = await params;

  // Verify ownership
  const existing = await getProcedure(id);
  if (!existing || existing.workspaceId !== auth.user.workspaceId) {
    return NextResponse.json({ error: 'Procedure not found' }, { status: 404 });
  }

  const deleted = await deleteProcedure(id);
  if (!deleted) {
    return NextResponse.json({ error: 'Procedure not found' }, { status: 404 });
  }

  return NextResponse.json({ deleted: true });
}
