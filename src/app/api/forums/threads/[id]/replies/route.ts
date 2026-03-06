import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { requirePerm } from '@/lib/rbac';
import { parseJsonBody } from '@/lib/parse-json-body';
import { getReplies, createReply, getThread } from '@/lib/forums/forum-store';

export const dynamic = 'force-dynamic';

/**
 * GET /api/forums/threads/:id/replies — list replies for a thread
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

  const replies = await getReplies(id);
  return NextResponse.json({ replies });
}

/**
 * POST /api/forums/threads/:id/replies — create a reply
 */
export async function POST(
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

  if (thread.status === 'closed') {
    return NextResponse.json({ error: 'Thread is closed' }, { status: 400 });
  }

  const parsed = await parseJsonBody<{
    body?: string;
    customerId?: string;
  }>(request);
  if ('error' in parsed) return parsed.error;

  const { body, customerId } = parsed.data;

  if (!body?.trim()) {
    return NextResponse.json({ error: 'body is required' }, { status: 400 });
  }

  const reply = createReply({
    threadId: id,
    body: body.trim(),
    customerId,
    workspaceId: auth.user.workspaceId,
  });

  return NextResponse.json({ reply }, { status: 201 });
}
