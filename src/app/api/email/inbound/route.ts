import { NextResponse } from 'next/server';
import { parseInboundEmail, extractTicketId, extractEmailAddress } from '@/lib/email/parser';

export const dynamic = 'force-dynamic';

/**
 * Inbound email webhook endpoint.
 * Receives emails from SendGrid, Postmark, or generic webhooks
 * and creates tickets or adds replies to existing conversations.
 */
export async function POST(request: Request) {
  try {
    let body: Record<string, unknown>;

    const contentType = request.headers.get('content-type') || '';
    if (contentType.includes('multipart/form-data')) {
      const formData = await request.formData();
      body = Object.fromEntries(formData.entries()) as Record<string, unknown>;
    } else {
      body = await request.json();
    }

    const email = parseInboundEmail(body);
    const senderEmail = extractEmailAddress(email.from);
    const ticketId = extractTicketId(email.inReplyTo, email.references);

    if (!process.env.DATABASE_URL) {
      // Log the email for demo mode
      console.log('[email:inbound]', {
        from: senderEmail,
        subject: email.subject,
        isReply: !!ticketId,
        ticketId,
      });
      return NextResponse.json({
        ok: true,
        action: ticketId ? 'reply_added' : 'ticket_created',
        ticketId: ticketId || 'demo-new',
      });
    }

    const { db } = await import('@/db');
    const schema = await import('@/db/schema');
    const { eq } = await import('drizzle-orm');

    // Get first workspace
    const workspaceRows = await db
      .select({ id: schema.workspaces.id })
      .from(schema.workspaces)
      .limit(1);

    const workspaceId = workspaceRows[0]?.id;
    if (!workspaceId) {
      return NextResponse.json({ error: 'No workspace configured' }, { status: 400 });
    }

    // Find or create customer
    let customerRows = await db
      .select({ id: schema.customers.id })
      .from(schema.customers)
      .where(eq(schema.customers.email, senderEmail))
      .limit(1);

    if (customerRows.length === 0) {
      const [newCustomer] = await db
        .insert(schema.customers)
        .values({
          workspaceId,
          email: senderEmail,
          name: email.fromName || senderEmail.split('@')[0],
        })
        .returning({ id: schema.customers.id });
      customerRows = [newCustomer];
    }

    const customerId = customerRows[0].id;

    if (ticketId) {
      // Reply to existing ticket
      const conversationRows = await db
        .select({ id: schema.conversations.id })
        .from(schema.conversations)
        .where(eq(schema.conversations.ticketId, ticketId))
        .limit(1);

      if (conversationRows.length > 0) {
        await db.insert(schema.messages).values({
          conversationId: conversationRows[0].id,
          authorType: 'customer',
          authorId: customerId,
          body: email.textBody,
          bodyHtml: email.htmlBody,
          visibility: 'public',
        });

        // Reopen ticket if it was solved/closed
        await db
          .update(schema.tickets)
          .set({ status: 'open', updatedAt: new Date() })
          .where(eq(schema.tickets.id, ticketId));

        return NextResponse.json({
          ok: true,
          action: 'reply_added',
          ticketId,
        });
      }
    }

    // Create new ticket
    const [ticket] = await db
      .insert(schema.tickets)
      .values({
        workspaceId,
        requesterId: customerId,
        subject: email.subject || '(no subject)',
        status: 'open',
        priority: 'normal',
      })
      .returning({ id: schema.tickets.id });

    const [conversation] = await db
      .insert(schema.conversations)
      .values({
        ticketId: ticket.id,
        channelType: 'email',
      })
      .returning({ id: schema.conversations.id });

    await db.insert(schema.messages).values({
      conversationId: conversation.id,
      authorType: 'customer',
      authorId: customerId,
      body: email.textBody,
      bodyHtml: email.htmlBody,
      visibility: 'public',
    });

    return NextResponse.json({
      ok: true,
      action: 'ticket_created',
      ticketId: ticket.id,
    }, { status: 201 });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Failed to process email' },
      { status: 500 }
    );
  }
}
