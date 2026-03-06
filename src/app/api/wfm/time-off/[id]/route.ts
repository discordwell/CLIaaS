import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { requireAuth } from '@/lib/api-auth';
import { parseJsonBody } from '@/lib/parse-json-body';

export const dynamic = 'force-dynamic';

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const auth = await requireAuth(request);
  if ('error' in auth) return auth.error;

  const { id } = await params;
  const parsed = await parseJsonBody<{
    decision: 'approved' | 'denied';
  }>(request);
  if ('error' in parsed) return parsed.error;

  const { decision } = parsed.data;

  if (!decision || !['approved', 'denied'].includes(decision)) {
    return NextResponse.json({ error: 'decision must be "approved" or "denied"' }, { status: 400 });
  }

  const { decideTimeOff } = await import('@/lib/wfm/time-off');
  const result = decideTimeOff(id, decision, auth.user.id);

  if (!result) {
    return NextResponse.json({ error: 'Time-off request not found' }, { status: 404 });
  }

  return NextResponse.json({ request: result });
}
