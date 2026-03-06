import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { getWebhook, updateWebhook, deleteWebhook } from '@/lib/webhooks';
import { requirePerm } from '@/lib/rbac';
import { parseJsonBody } from '@/lib/parse-json-body';

export const dynamic = 'force-dynamic';

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const auth = await requirePerm(request, 'admin:settings', 'admin');
  if ('error' in auth) return auth.error;

  const { id } = await params;

  try {
    // Scope by workspace to prevent cross-workspace data leakage
    const webhook = getWebhook(id, auth.user.workspaceId);
    if (!webhook) {
      return NextResponse.json({ error: 'Webhook not found' }, { status: 404 });
    }
    return NextResponse.json({ webhook });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Failed to get webhook' },
      { status: 500 }
    );
  }
}

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const auth = await requirePerm(request, 'admin:settings', 'admin');
  if ('error' in auth) return auth.error;

  const { id } = await params;

  try {
    const parsed = await parseJsonBody<Record<string, unknown>>(request);
    if ('error' in parsed) return parsed.error;
    // Scope by workspace to prevent cross-workspace modification
    const webhook = updateWebhook(id, parsed.data, auth.user.workspaceId);
    if (!webhook) {
      return NextResponse.json({ error: 'Webhook not found' }, { status: 404 });
    }
    return NextResponse.json({ webhook });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Failed to update webhook' },
      { status: 500 }
    );
  }
}

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const auth = await requirePerm(request, 'admin:settings', 'admin');
  if ('error' in auth) return auth.error;

  const { id } = await params;

  try {
    // Scope by workspace to prevent cross-workspace deletion
    const deleted = deleteWebhook(id, auth.user.workspaceId);
    if (!deleted) {
      return NextResponse.json({ error: 'Webhook not found' }, { status: 404 });
    }
    return NextResponse.json({ ok: true });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Failed to delete webhook' },
      { status: 500 }
    );
  }
}
