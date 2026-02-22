import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { loadTickets, loadMessages } from '@/lib/data';

export const dynamic = 'force-dynamic';

function getPortalEmail(request: NextRequest): string | null {
  return request.cookies.get('cliaas-portal-email')?.value ?? null;
}

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const email = getPortalEmail(request);
    if (!email) {
      return NextResponse.json(
        { error: 'Not authenticated. Please sign in to the portal.' },
        { status: 401 }
      );
    }

    const { id } = await params;

    // Try DB
    if (process.env.DATABASE_URL) {
      try {
        const { db } = await import('@/db');
        const schema = await import('@/db/schema');
        const { eq, and } = await import('drizzle-orm');

        // Find customer
        const customers = await db
          .select({ id: schema.customers.id })
          .from(schema.customers)
          .where(eq(schema.customers.email, email))
          .limit(1);

        if (customers.length > 0) {
          const customerId = customers[0].id;

          // Fetch ticket ensuring it belongs to the customer
          const ticketRows = await db
            .select({
              id: schema.tickets.id,
              subject: schema.tickets.subject,
              status: schema.tickets.status,
              priority: schema.tickets.priority,
              createdAt: schema.tickets.createdAt,
              updatedAt: schema.tickets.updatedAt,
            })
            .from(schema.tickets)
            .where(
              and(
                eq(schema.tickets.id, id),
                eq(schema.tickets.requesterId, customerId)
              )
            )
            .limit(1);

          if (ticketRows.length === 0) {
            return NextResponse.json(
              { error: 'Ticket not found' },
              { status: 404 }
            );
          }

          const ticket = ticketRows[0];

          // Load messages (only public ones for portal)
          const messageRows = await db
            .select({
              id: schema.messages.id,
              body: schema.messages.body,
              authorType: schema.messages.authorType,
              authorId: schema.messages.authorId,
              visibility: schema.messages.visibility,
              createdAt: schema.messages.createdAt,
            })
            .from(schema.messages)
            .innerJoin(
              schema.conversations,
              eq(schema.conversations.id, schema.messages.conversationId)
            )
            .where(
              and(
                eq(schema.conversations.ticketId, id),
                eq(schema.messages.visibility, 'public')
              )
            )
            .orderBy(schema.messages.createdAt);

          const messages = messageRows.map((m) => ({
            id: m.id,
            body: m.body,
            authorType: m.authorType,
            isCustomer: m.authorType === 'customer',
            createdAt: m.createdAt.toISOString(),
          }));

          return NextResponse.json({
            ticket: {
              id: ticket.id,
              subject: ticket.subject,
              status: ticket.status,
              priority: ticket.priority,
              createdAt: ticket.createdAt.toISOString(),
              updatedAt: ticket.updatedAt.toISOString(),
            },
            messages,
          });
        }
      } catch {
        // DB unavailable, fall through
      }
    }

    // JSONL fallback
    const allTickets = await loadTickets();
    const ticket = allTickets.find(
      (t) =>
        (t.id === id || t.externalId === id) &&
        t.requester.toLowerCase() === email.toLowerCase()
    );

    if (!ticket) {
      return NextResponse.json(
        { error: 'Ticket not found' },
        { status: 404 }
      );
    }

    const allMessages = await loadMessages(ticket.id);
    // Only show public messages to customers
    const messages = allMessages
      .filter((m) => m.type !== 'note')
      .sort(
        (a, b) =>
          new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime()
      )
      .map((m) => ({
        id: m.id,
        body: m.body,
        authorType: m.type === 'system' ? 'system' : 'agent',
        isCustomer: m.author.toLowerCase() === email.toLowerCase(),
        createdAt: m.createdAt,
      }));

    return NextResponse.json({
      ticket: {
        id: ticket.id,
        subject: ticket.subject,
        status: ticket.status,
        priority: ticket.priority,
        createdAt: ticket.createdAt,
        updatedAt: ticket.updatedAt,
      },
      messages,
    });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Failed to load ticket' },
      { status: 500 }
    );
  }
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const email = getPortalEmail(request);
    if (!email) {
      return NextResponse.json(
        { error: 'Not authenticated. Please sign in to the portal.' },
        { status: 401 }
      );
    }

    const { id } = await params;
    const body = await request.json().catch(() => ({} as Record<string, unknown>));
    const { message } = body as { message?: string };

    if (!message?.trim()) {
      return NextResponse.json(
        { error: 'Message is required' },
        { status: 400 }
      );
    }

    // Try DB
    if (process.env.DATABASE_URL) {
      try {
        const { db } = await import('@/db');
        const schema = await import('@/db/schema');
        const { eq, and } = await import('drizzle-orm');

        // Verify customer owns this ticket
        const customers = await db
          .select({ id: schema.customers.id })
          .from(schema.customers)
          .where(eq(schema.customers.email, email))
          .limit(1);

        if (customers.length === 0) {
          return NextResponse.json(
            { error: 'Customer not found' },
            { status: 404 }
          );
        }

        const customerId = customers[0].id;

        const ticketRows = await db
          .select({ id: schema.tickets.id })
          .from(schema.tickets)
          .where(
            and(
              eq(schema.tickets.id, id),
              eq(schema.tickets.requesterId, customerId)
            )
          )
          .limit(1);

        if (ticketRows.length === 0) {
          return NextResponse.json(
            { error: 'Ticket not found' },
            { status: 404 }
          );
        }

        // Find conversation
        const conversations = await db
          .select({ id: schema.conversations.id })
          .from(schema.conversations)
          .where(eq(schema.conversations.ticketId, id))
          .limit(1);

        if (conversations.length === 0) {
          return NextResponse.json(
            { error: 'No conversation found for this ticket' },
            { status: 404 }
          );
        }

        // Add message
        const [newMessage] = await db
          .insert(schema.messages)
          .values({
            conversationId: conversations[0].id,
            authorType: 'customer' as const,
            authorId: customerId,
            body: message.trim(),
            visibility: 'public' as const,
          })
          .returning();

        // Reopen ticket if it was solved/closed
        await db
          .update(schema.tickets)
          .set({ status: 'open' as const, updatedAt: new Date() })
          .where(eq(schema.tickets.id, id));

        return NextResponse.json({
          message: {
            id: newMessage.id,
            body: newMessage.body,
            createdAt: newMessage.createdAt.toISOString(),
          },
        });
      } catch {
        // DB unavailable, fall through
      }
    }

    // Demo mode
    return NextResponse.json({
      message: {
        id: `reply-${Date.now()}`,
        body: message.trim(),
        createdAt: new Date().toISOString(),
      },
    });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Failed to add reply' },
      { status: 500 }
    );
  }
}
