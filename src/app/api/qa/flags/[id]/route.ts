import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { requirePerm } from '@/lib/rbac';
import { dismissFlag } from '@/lib/qa/qa-flags-store';

export const dynamic = 'force-dynamic';

/**
 * PATCH /api/qa/flags/:id — dismiss a flag
 */
export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const auth = await requirePerm(request, 'qa:review');
  if ('error' in auth) return auth.error;

  const { id } = await params;
  const wsId = auth.user.workspaceId ?? 'default';
  const result = dismissFlag(id, auth.user.id, wsId);

  if (!result) {
    return NextResponse.json({ error: 'Flag not found' }, { status: 404 });
  }

  return NextResponse.json({ flag: result });
}
