import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { loadTickets } from '@/lib/data';

export const dynamic = 'force-dynamic';

function getPortalEmail(request: NextRequest): string | null {
  return request.cookies.get('cliaas-portal-email')?.value ?? null;
}

export async function GET(request: NextRequest) {
  try {
    const email = getPortalEmail(request);
    if (!email) {
      return NextResponse.json(
        { error: 'Not authenticated. Please sign in to the portal.' },
        { status: 401 }
      );
    }

    // Try DB first
    if (process.env.DATABASE_URL) {
      try {
        const { db } = await import('@/db');
        const schema = await import('@/db/schema');
        const { eq, and } = await import('drizzle-orm');

        // Find the customer by email
        const customers = await db
          .select({ id: schema.customers.id })
          .from(schema.customers)
          .where(eq(schema.customers.email, email))
          .limit(1);

        if (customers.length > 0) {
          const customerId = customers[0].id;

          const rows = await db
            .select({
              id: schema.tickets.id,
              subject: schema.tickets.subject,
              status: schema.tickets.status,
              priority: schema.tickets.priority,
              createdAt: schema.tickets.createdAt,
              updatedAt: schema.tickets.updatedAt,
            })
            .from(schema.tickets)
            .where(eq(schema.tickets.requesterId, customerId))
            .orderBy(schema.tickets.updatedAt);

          const tickets = rows.map((row) => ({
            id: row.id,
            subject: row.subject,
            status: row.status,
            priority: row.priority,
            createdAt: row.createdAt.toISOString(),
            updatedAt: row.updatedAt.toISOString(),
          }));

          return NextResponse.json({ tickets });
        }
      } catch {
        // DB unavailable, fall through
      }
    }

    // JSONL fallback: filter tickets by requester email
    const allTickets = await loadTickets();
    const tickets = allTickets
      .filter((t) => t.requester.toLowerCase() === email.toLowerCase())
      .map((t) => ({
        id: t.id,
        subject: t.subject,
        status: t.status,
        priority: t.priority,
        createdAt: t.createdAt,
        updatedAt: t.updatedAt,
      }))
      .sort(
        (a, b) =>
          new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime()
      );

    return NextResponse.json({ tickets });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Failed to load tickets' },
      { status: 500 }
    );
  }
}

export async function POST(request: NextRequest) {
  try {
    const email = getPortalEmail(request);
    if (!email) {
      return NextResponse.json(
        { error: 'Not authenticated. Please sign in to the portal.' },
        { status: 401 }
      );
    }

    const body = await request.json().catch(() => ({} as Record<string, unknown>));
    const { subject, description, priority } = body as {
      subject?: string;
      description?: string;
      priority?: string;
    };

    if (!subject?.trim() || !description?.trim()) {
      return NextResponse.json(
        { error: 'Subject and description are required' },
        { status: 400 }
      );
    }

    const validPriorities = ['low', 'normal', 'high', 'urgent'];
    const ticketPriority = priority && validPriorities.includes(priority) ? priority : 'normal';

    // Try DB
    if (process.env.DATABASE_URL) {
      try {
        const { db } = await import('@/db');
        const schema = await import('@/db/schema');
        const { eq } = await import('drizzle-orm');

        // Find or create customer
        const customers = await db
          .select({ id: schema.customers.id })
          .from(schema.customers)
          .where(eq(schema.customers.email, email))
          .limit(1);

        let customerId: string;

        if (customers.length === 0) {
          // Get first workspace
          const workspaces = await db
            .select({ id: schema.workspaces.id })
            .from(schema.workspaces)
            .limit(1);

          if (workspaces.length === 0) {
            return NextResponse.json(
              { error: 'No workspace configured' },
              { status: 500 }
            );
          }

          const [newCustomer] = await db
            .insert(schema.customers)
            .values({
              workspaceId: workspaces[0].id,
              name: email.split('@')[0],
              email,
            })
            .returning({ id: schema.customers.id });

          customerId = newCustomer.id;
        } else {
          customerId = customers[0].id;
        }

        // Get workspace for ticket
        const customerRows = await db
          .select({ workspaceId: schema.customers.workspaceId })
          .from(schema.customers)
          .where(eq(schema.customers.id, customerId))
          .limit(1);

        const workspaceId = customerRows[0]?.workspaceId;
        if (!workspaceId) {
          return NextResponse.json(
            { error: 'No workspace found' },
            { status: 500 }
          );
        }

        // Create ticket
        const [ticket] = await db
          .insert(schema.tickets)
          .values({
            workspaceId,
            requesterId: customerId,
            subject: subject.trim(),
            status: 'open' as const,
            priority: ticketPriority as 'low' | 'normal' | 'high' | 'urgent',
            source: 'zendesk' as const,
          })
          .returning();

        // Create conversation
        const [conversation] = await db
          .insert(schema.conversations)
          .values({
            ticketId: ticket.id,
            channelType: 'web' as const,
          })
          .returning();

        // Create initial message
        await db.insert(schema.messages).values({
          conversationId: conversation.id,
          authorType: 'customer' as const,
          authorId: customerId,
          body: description.trim(),
          visibility: 'public' as const,
        });

        return NextResponse.json(
          {
            ticket: {
              id: ticket.id,
              subject: ticket.subject,
              status: ticket.status,
              priority: ticket.priority,
              createdAt: ticket.createdAt.toISOString(),
            },
          },
          { status: 201 }
        );
      } catch {
        // DB unavailable, fall through to demo response
      }
    }

    // Demo mode: return a synthetic ticket
    const demoId = `portal-${Date.now()}`;
    return NextResponse.json(
      {
        ticket: {
          id: demoId,
          subject: subject.trim(),
          status: 'open',
          priority: ticketPriority,
          createdAt: new Date().toISOString(),
        },
      },
      { status: 201 }
    );
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Failed to create ticket' },
      { status: 500 }
    );
  }
}
