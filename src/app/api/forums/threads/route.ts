import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { requirePerm } from '@/lib/rbac';
import { parseJsonBody } from '@/lib/parse-json-body';
import { getThreads, createThread } from '@/lib/forums/forum-store';

export const dynamic = 'force-dynamic';

/**
 * GET /api/forums/threads — list threads, optionally filtered by categoryId
 */
export async function GET(request: NextRequest) {
  const auth = await requirePerm(request, 'forums:view');
  if ('error' in auth) return auth.error;

  const categoryId = request.nextUrl.searchParams.get('categoryId') ?? undefined;
  const threads = await getThreads(categoryId);

  return NextResponse.json({ threads });
}

/**
 * POST /api/forums/threads — create a thread
 */
export async function POST(request: NextRequest) {
  const auth = await requirePerm(request, 'forums:view');
  if ('error' in auth) return auth.error;

  const parsed = await parseJsonBody<{
    categoryId?: string;
    title?: string;
    body?: string;
    customerId?: string;
  }>(request);
  if ('error' in parsed) return parsed.error;

  const { categoryId, title, body, customerId } = parsed.data;

  if (!categoryId) {
    return NextResponse.json({ error: 'categoryId is required' }, { status: 400 });
  }
  if (!title?.trim()) {
    return NextResponse.json({ error: 'title is required' }, { status: 400 });
  }
  if (!body?.trim()) {
    return NextResponse.json({ error: 'body is required' }, { status: 400 });
  }

  const thread = createThread({
    categoryId,
    title: title.trim(),
    body: body.trim(),
    customerId,
    status: 'open',
    isPinned: false,
    workspaceId: auth.user.workspaceId,
  });

  return NextResponse.json({ thread }, { status: 201 });
}
