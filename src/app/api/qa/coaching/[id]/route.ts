import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { requireAuth } from '@/lib/api-auth';
import { parseJsonBody } from '@/lib/parse-json-body';
import { updateCoachingAssignment } from '@/lib/qa/qa-coaching-store';

export const dynamic = 'force-dynamic';

/**
 * PATCH /api/qa/coaching/:id — update coaching assignment status
 */
export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const auth = await requireAuth(request);
  if ('error' in auth) return auth.error;

  const { id } = await params;

  const parsed = await parseJsonBody<{
    status?: 'acknowledged' | 'completed';
    agentResponse?: string;
    notes?: string;
  }>(request);
  if ('error' in parsed) return parsed.error;

  const wsId = auth.user.workspaceId ?? 'default';
  const result = updateCoachingAssignment(id, parsed.data, wsId);
  if (!result) {
    return NextResponse.json({ error: 'Assignment not found' }, { status: 404 });
  }

  return NextResponse.json({ assignment: result });
}
