import { safeErrorMessage } from '@/lib/parse-json-body';
import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { getWebhook, getWebhookLogs } from '@/lib/webhooks';
import { requirePerm } from '@/lib/rbac';

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

    const logs = getWebhookLogs(id);
    return NextResponse.json({ logs });
  } catch (err) {
    return NextResponse.json(
      { error: safeErrorMessage(err, 'Failed to get webhook logs') },
      { status: 500 }
    );
  }
}
