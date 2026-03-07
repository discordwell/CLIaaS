import { safeErrorMessage } from '@/lib/parse-json-body';
import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { processJiraWebhook } from '@/lib/integrations/engineering-sync';
import * as linkStore from '@/lib/integrations/link-store';

export const dynamic = 'force-dynamic';

export async function POST(request: NextRequest) {
  try {
    // Verify webhook authenticity via shared secret (query param or header).
    // Jira Cloud sends webhooks with a user-configured secret in the URL or header.
    const webhookSecret = process.env.JIRA_WEBHOOK_SECRET;
    if (webhookSecret) {
      const url = new URL(request.url);
      const providedSecret = url.searchParams.get('secret')
        ?? request.headers.get('x-jira-webhook-secret')
        ?? '';
      if (providedSecret !== webhookSecret) {
        return NextResponse.json({ error: 'Invalid webhook secret' }, { status: 401 });
      }
    }

    const payload = await request.json();
    const event = processJiraWebhook(payload as Record<string, unknown>);

    if (!event.issueKey) {
      return NextResponse.json({ ok: true, skipped: 'no issue key' });
    }

    // Find the link for this Jira issue
    const allLinks = await linkStore.listExternalLinks();
    const link = allLinks.find(l => l.provider === 'jira' && l.externalId === event.issueKey);
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
  } catch (err) {
    return NextResponse.json(
      { error: safeErrorMessage(err, 'Webhook processing failed') },
      { status: 500 },
    );
  }
}
