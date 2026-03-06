import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { requirePerm } from '@/lib/rbac';
import { listProcedures, createProcedure } from '@/lib/ai/procedures';

export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  const auth = await requirePerm(request, 'automation:edit', 'admin');
  if ('error' in auth) return auth.error;

  const procedures = await listProcedures(auth.user.workspaceId);
  return NextResponse.json({ procedures });
}

export async function POST(request: NextRequest) {
  const auth = await requirePerm(request, 'automation:edit', 'admin');
  if ('error' in auth) return auth.error;

  const body = await request.json();
  const { name, description, steps, triggerTopics, enabled } = body;

  if (!name || typeof name !== 'string') {
    return NextResponse.json({ error: 'name is required' }, { status: 400 });
  }
  if (!Array.isArray(steps)) {
    return NextResponse.json({ error: 'steps must be an array' }, { status: 400 });
  }
  if (!Array.isArray(triggerTopics)) {
    return NextResponse.json({ error: 'triggerTopics must be an array' }, { status: 400 });
  }

  const procedure = await createProcedure(auth.user.workspaceId, {
    name,
    description: description ?? null,
    steps,
    triggerTopics,
    enabled: enabled ?? true,
  });

  return NextResponse.json({ procedure }, { status: 201 });
}
