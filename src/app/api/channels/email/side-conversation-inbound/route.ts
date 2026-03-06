import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { parseJsonBody } from '@/lib/parse-json-body';

export const dynamic = 'force-dynamic';

/**
 * Inbound email handler for side conversation replies.
 * Parses In-Reply-To header to match `sc-{conversationId}` pattern
 * and adds the reply to the correct side conversation.
 */
export async function POST(request: NextRequest) {
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
      { error: err instanceof Error ? err.message : 'Failed to process inbound email' },
      { status: 500 },
    );
  }
}
