import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { requirePerm } from '@/lib/rbac';
import { parseJsonBody } from '@/lib/parse-json-body';
import { getMessage, updateMessage, deleteMessage, toggleMessage, getMessageAnalytics } from '@/lib/messages/message-store';

export const dynamic = 'force-dynamic';

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const auth = await requirePerm(request, 'tickets:view');
  if ('error' in auth) return auth.error;

  const { id } = await params;
  const message = getMessage(id, auth.user.workspaceId);
  if (!message) return NextResponse.json({ error: 'Message not found' }, { status: 404 });

  const analytics = getMessageAnalytics(id);
  return NextResponse.json({ message, analytics });
}

export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const auth = await requirePerm(request, 'tickets:reply_public');
  if ('error' in auth) return auth.error;

  const { id } = await params;
  const parsed = await parseJsonBody<{
    name?: string;
    title?: string;
    body?: string;
    ctaText?: string;
    ctaUrl?: string;
    targetUrlPattern?: string;
    segmentQuery?: Record<string, unknown>;
    priority?: number;
    startAt?: string;
    endAt?: string;
    maxImpressions?: number;
  }>(request);
  if ('error' in parsed) return parsed.error;

  const { name, title, body, ctaText, ctaUrl, targetUrlPattern, segmentQuery, priority, startAt, endAt, maxImpressions } = parsed.data;
  const message = updateMessage(id, { name, title, body, ctaText, ctaUrl, targetUrlPattern, segmentQuery, priority, startAt, endAt, maxImpressions }, auth.user.workspaceId);
  if (!message) return NextResponse.json({ error: 'Message not found' }, { status: 404 });

  return NextResponse.json({ message });
}

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const auth = await requirePerm(request, 'tickets:reply_public');
  if ('error' in auth) return auth.error;

  const { id } = await params;
  const deleted = deleteMessage(id, auth.user.workspaceId);
  if (!deleted) return NextResponse.json({ error: 'Message not found' }, { status: 404 });

  return NextResponse.json({ deleted: true });
}

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const auth = await requirePerm(request, 'tickets:reply_public');
  if ('error' in auth) return auth.error;

  const { id } = await params;
  const message = toggleMessage(id, auth.user.workspaceId);
  if (!message) return NextResponse.json({ error: 'Message not found' }, { status: 404 });

  return NextResponse.json({ message });
}
