import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { requirePerm } from '@/lib/rbac';
import { parseJsonBody, safeErrorMessage } from '@/lib/parse-json-body';

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string; scId: string }> },
) {
  const authResult = await requirePerm(request, 'tickets:reply_internal');
  if ('error' in authResult) return authResult.error;

  const { scId } = await params;

  try {
    const { getSideConversation } = await import('@/lib/side-conversations');
    const detail = await getSideConversation(scId);
    if (!detail) {
      return NextResponse.json({ error: 'Side conversation not found' }, { status: 404 });
    }
    return NextResponse.json(detail);
  } catch (err) {
    return NextResponse.json(
      { error: safeErrorMessage(err, 'Failed to get side conversation') },
      { status: 500 },
    );
  }
}

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string; scId: string }> },
) {
  const authResult = await requirePerm(request, 'tickets:reply_internal');
  if ('error' in authResult) return authResult.error;

  const { scId } = await params;
  const parsed = await parseJsonBody<{ status: 'open' | 'closed' }>(request);
  if ('error' in parsed) return parsed.error;
  const { status } = parsed.data;

  if (!status || !['open', 'closed'].includes(status)) {
    return NextResponse.json({ error: 'Status must be "open" or "closed"' }, { status: 400 });
  }

  try {
    if (status === 'closed') {
      const { closeSideConversation } = await import('@/lib/side-conversations');
      await closeSideConversation(scId);
    } else {
      const { reopenSideConversation } = await import('@/lib/side-conversations');
      await reopenSideConversation(scId);
    }

    return NextResponse.json({ status: 'ok', newStatus: status });
  } catch (err) {
    return NextResponse.json(
      { error: safeErrorMessage(err, 'Failed to update side conversation') },
      { status: 500 },
    );
  }
}
