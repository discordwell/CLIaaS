import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { getConversation, closeConversation } from '@/lib/channels/sms-store';
import { requirePerm } from '@/lib/rbac';

export const dynamic = 'force-dynamic';

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const auth = await requirePerm(request, 'channels:view');
  if ('error' in auth) return auth.error;

  const { id } = await params;
  // Scope by workspace to prevent cross-workspace data leakage
  const conversation = getConversation(id, auth.user.workspaceId);

  if (!conversation) {
    return NextResponse.json({ error: 'Conversation not found' }, { status: 404 });
  }

  return NextResponse.json({ conversation });
}

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const auth = await requirePerm(request, 'channels:edit');
  if ('error' in auth) return auth.error;

  const { id } = await params;
  // Scope by workspace to prevent cross-workspace modification
  const conversation = closeConversation(id, auth.user.workspaceId);

  if (!conversation) {
    return NextResponse.json({ error: 'Conversation not found' }, { status: 404 });
  }

  return NextResponse.json({ conversation });
}
