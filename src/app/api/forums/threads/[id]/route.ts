import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { requirePerm } from '@/lib/rbac';
import { parseJsonBody } from '@/lib/parse-json-body';
import { getThread, moderateThread } from '@/lib/forums/forum-store';

export const dynamic = 'force-dynamic';

/**
 * GET /api/forums/threads/:id — get thread detail
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const auth = await requirePerm(request, 'forums:view');
  if ('error' in auth) return auth.error;

  const { id } = await params;
  const thread = getThread(id);
  if (!thread) {
    return NextResponse.json({ error: 'Thread not found' }, { status: 404 });
  }

  return NextResponse.json({ thread });
}

/**
 * PATCH /api/forums/threads/:id — moderate a thread (close/pin/unpin)
 */
export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const auth = await requirePerm(request, 'forums:moderate');
  if ('error' in auth) return auth.error;

  const { id } = await params;

  const parsed = await parseJsonBody<{
    action?: 'close' | 'pin' | 'unpin';
  }>(request);
  if ('error' in parsed) return parsed.error;

  const { action } = parsed.data;
  if (!action || !['close', 'pin', 'unpin'].includes(action)) {
    return NextResponse.json(
      { error: 'action must be one of: close, pin, unpin' },
      { status: 400 },
    );
  }

  const updated = moderateThread(id, action);
  if (!updated) {
    return NextResponse.json({ error: 'Thread not found' }, { status: 404 });
  }

  return NextResponse.json({ thread: updated });
}
