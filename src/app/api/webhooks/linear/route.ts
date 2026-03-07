import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { createHmac } from 'crypto';
import { processLinearWebhook } from '@/lib/integrations/engineering-sync';
import * as linkStore from '@/lib/integrations/link-store';

export const dynamic = 'force-dynamic';

async function handlePayload(payload: Record<string, unknown>): Promise<NextResponse> {
  const event = processLinearWebhook(payload);

  if (!event.issueId) {
    return NextResponse.json({ ok: true, skipped: 'no issue ID' });
  }

  // Find the link for this Linear issue
  const allLinks = await linkStore.listExternalLinks();
  const link = allLinks.find(l => l.provider === 'linear' && l.externalId === event.issueId);
  if (!link) {
    return NextResponse.json({ ok: true, skipped: 'no matching link' });
  }

  if (event.eventType === 'issue_updated' && event.statusName) {
    linkStore.updateExternalLink(link.id, {
      externalStatus: event.statusName,
      lastSyncedAt: new Date().toISOString(),
    });
  }

  if (event.eventType === 'comment_created' && event.commentId && event.commentBody) {
    const existing = await linkStore.listLinkComments(link.id);
    if (!existing.find(c => c.externalCommentId === event.commentId)) {
      linkStore.createLinkComment({
        linkId: link.id,
        workspaceId: link.workspaceId,
        direction: 'from_external',
        externalCommentId: event.commentId,
        body: event.commentBody,
        authorName: event.commentAuthor,
      });
    }
  }

  return NextResponse.json({ ok: true, event: event.eventType });
}

export async function POST(request: NextRequest) {
  try {
    // Linear sends HMAC-SHA256 signature in the Linear-Signature header.
    // Verify it to prevent forged webhook payloads.
    const webhookSecret = process.env.LINEAR_WEBHOOK_SECRET;
    if (webhookSecret) {
      const rawBody = await request.text();
      const signature = request.headers.get('linear-signature') ?? '';
      const expected = createHmac('sha256', webhookSecret).update(rawBody).digest('hex');
      if (signature !== expected) {
        return NextResponse.json({ error: 'Invalid webhook signature' }, { status: 401 });
      }
      const payload = JSON.parse(rawBody) as Record<string, unknown>;
      return await handlePayload(payload);
    }

    const payload = await request.json();
    return await handlePayload(payload as Record<string, unknown>);
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Webhook processing failed' },
      { status: 500 },
    );
  }
}
