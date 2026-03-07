import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { parseJsonBody, safeErrorMessage } from '@/lib/parse-json-body';
import { createLogger } from '@/lib/logger';

const logger = createLogger('channels:email:side-conversation-inbound');

export const dynamic = 'force-dynamic';

/**
 * Inbound email handler for side conversation replies.
 * Parses In-Reply-To header to match `sc-{conversationId}` pattern
 * and adds the reply to the correct side conversation.
 *
 * Auth: requires X-Webhook-Secret header matching INBOUND_EMAIL_SECRET env var.
 */
export async function POST(request: NextRequest) {
  // Authenticate inbound webhook via shared secret
  const secret = process.env.INBOUND_EMAIL_SECRET;
  if (secret) {
    const provided = request.headers.get('x-webhook-secret') ?? '';
    if (provided !== secret) {
      logger.warn('Unauthorized inbound email attempt');
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
  } else {
    logger.warn('INBOUND_EMAIL_SECRET not set — rejecting inbound email for safety');
    return NextResponse.json({ error: 'Inbound email not configured' }, { status: 503 });
  }

  const parsed = await parseJsonBody<{
    from: string;
    body: string;
    inReplyTo?: string;
    references?: string;
  }>(request);
  if ('error' in parsed) return parsed.error;
  const { from, body, inReplyTo, references } = parsed.data;

  if (!body?.trim()) {
    return NextResponse.json({ error: 'Body is required' }, { status: 400 });
  }

  // Extract conversation ID from In-Reply-To or References header
  const headerText = [inReplyTo, references].filter(Boolean).join(' ');
  const scMatch = headerText.match(/sc-([0-9a-f-]+)@/i);
  if (!scMatch) {
    return NextResponse.json(
      { error: 'Could not match side conversation from email headers' },
      { status: 400 },
    );
  }

  const conversationId = scMatch[1];

  try {
    const { db } = await import('@/db');
    const schema = await import('@/db/schema');
    const { eq } = await import('drizzle-orm');

    // Verify conversation exists and is a side conversation
    const [conv] = await db
      .select()
      .from(schema.conversations)
      .where(eq(schema.conversations.id, conversationId))
      .limit(1);

    if (!conv || conv.kind !== 'side') {
      return NextResponse.json(
        { error: 'Side conversation not found' },
        { status: 404 },
      );
    }

    // Add the inbound message
    const [msg] = await db
      .insert(schema.messages)
      .values({
        conversationId,
        workspaceId: conv.workspaceId,
        authorType: 'customer' as const,
        body: body.trim(),
        visibility: 'internal' as const,
      })
      .returning({ id: schema.messages.id });

    // Update last activity
    await db
      .update(schema.conversations)
      .set({ lastActivityAt: new Date() })
      .where(eq(schema.conversations.id, conversationId));

    // Reopen if closed
    if (conv.status === 'closed') {
      await db
        .update(schema.conversations)
        .set({ status: 'open' as const })
        .where(eq(schema.conversations.id, conversationId));
    }

    return NextResponse.json({ messageId: msg.id, conversationId });
  } catch (err) {
    return NextResponse.json(
      { error: safeErrorMessage(err, 'Failed to process inbound email') },
      { status: 500 },
    );
  }
}
