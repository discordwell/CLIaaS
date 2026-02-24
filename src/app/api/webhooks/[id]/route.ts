import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { getWebhook, updateWebhook, deleteWebhook } from '@/lib/webhooks';
import { requireScope } from '@/lib/api-auth';
import { parseJsonBody } from '@/lib/parse-json-body';

export const dynamic = 'force-dynamic';

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const auth = await requireScope(request, 'webhooks:read');
  if ('error' in auth) return auth.error;

  const { id } = await params;

  try {
    const webhook = getWebhook(id);
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
  const auth = await requireScope(request, 'webhooks:write');
  if ('error' in auth) return auth.error;

  const { id } = await params;

  try {
    const parsed = await parseJsonBody<Record<string, unknown>>(request);
    if ('error' in parsed) return parsed.error;
    const webhook = updateWebhook(id, parsed.data);
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
  const auth = await requireScope(request, 'webhooks:write');
  if ('error' in auth) return auth.error;

  const { id } = await params;

  try {
    const deleted = deleteWebhook(id);
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
