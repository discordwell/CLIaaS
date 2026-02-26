import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { loadTickets } from '@/lib/data';
import { getPortalEmail } from '@/lib/portal/get-portal-email';
import { parseJsonBody } from '@/lib/parse-json-body';

export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  try {
    const email = getPortalEmail(request);
    if (!email) {
      return NextResponse.json(
        { error: 'Not authenticated. Please sign in to the portal.' },
        { status: 401 }
      );
    }

    const { searchParams } = new URL(request.url);
    const scope = searchParams.get('scope'); // 'org' for organization view
    const page = Math.max(1, parseInt(searchParams.get('page') ?? '1', 10));
    const limit = Math.min(100, Math.max(1, parseInt(searchParams.get('limit') ?? '20', 10)));
    const offset = (page - 1) * limit;

    // Try DB first
    if (process.env.DATABASE_URL) {
      try {
        const { db } = await import('@/db');
        const schema = await import('@/db/schema');
        const { eq, and, inArray, desc, sql } = await import('drizzle-orm');

        // Find the customer by email
        const customerRows = await db
          .select({
            id: schema.customers.id,
            orgId: schema.customers.orgId,
            workspaceId: schema.customers.workspaceId,
            email: schema.customers.email,
          })
          .from(schema.customers)
          .where(eq(schema.customers.email, email))
          .limit(1);

        if (customerRows.length > 0) {
          const customer = customerRows[0];
          let requesterFilter: ReturnType<typeof eq>;

          if (scope === 'org' && customer.orgId) {
            // Get all customer IDs in the same org, scoped to workspace
            const orgCustomerRows = await db
              .select({ id: schema.customers.id })
              .from(schema.customers)
              .where(and(
                eq(schema.customers.orgId, customer.orgId),
                eq(schema.customers.workspaceId, customer.workspaceId),
              ));

            const orgCustomerIds = orgCustomerRows.map((c) => c.id);
            requesterFilter = inArray(schema.tickets.requesterId, orgCustomerIds);
          } else {
            requesterFilter = eq(schema.tickets.requesterId, customer.id);
          }

          // Count total
          const [{ count: total }] = await db
            .select({ count: sql<number>`count(*)::int` })
            .from(schema.tickets)
            .where(requesterFilter);

          // Fetch tickets with optional SLA data
          const rows = await db
            .select({
              id: schema.tickets.id,
              subject: schema.tickets.subject,
              status: schema.tickets.status,
              priority: schema.tickets.priority,
              customerEmail: schema.tickets.customerEmail,
              requesterId: schema.tickets.requesterId,
              createdAt: schema.tickets.createdAt,
              updatedAt: schema.tickets.updatedAt,
              slaDueAt: schema.slaEvents.dueAt,
              slaBreachedAt: schema.slaEvents.breachedAt,
            })
            .from(schema.tickets)
            .leftJoin(
              schema.slaEvents,
              eq(schema.tickets.id, schema.slaEvents.ticketId),
            )
            .where(requesterFilter)
            .orderBy(desc(schema.tickets.updatedAt))
            .limit(limit)
            .offset(offset);

          // For org scope, resolve requester emails
          let requesterEmailMap: Record<string, string> = {};
          if (scope === 'org') {
            const requesterIds = [...new Set(rows.map((r) => r.requesterId).filter(Boolean))] as string[];
            if (requesterIds.length > 0) {
              const emailRows = await db
                .select({ id: schema.customers.id, email: schema.customers.email })
                .from(schema.customers)
                .where(inArray(schema.customers.id, requesterIds));
              for (const row of emailRows) {
                if (row.email) requesterEmailMap[row.id] = row.email;
              }
            }
          }

          const tickets = rows.map((row) => ({
            id: row.id,
            subject: row.subject,
            status: row.status,
            priority: row.priority,
            createdAt: row.createdAt.toISOString(),
            updatedAt: row.updatedAt.toISOString(),
            ...(row.slaDueAt && { slaDueAt: row.slaDueAt.toISOString() }),
            ...(row.slaBreachedAt && { slaBreachedAt: row.slaBreachedAt.toISOString() }),
            ...(scope === 'org' && row.requesterId && {
              requesterEmail: requesterEmailMap[row.requesterId],
            }),
          }));

          return NextResponse.json({ tickets, total, page, limit });
        }
      } catch {
        // DB unavailable, fall through
      }
    }

    // JSONL fallback: filter tickets by requester email
    const allTickets = await loadTickets();
    const filtered = allTickets
      .filter((t) => t.requester.toLowerCase() === email.toLowerCase())
      .sort(
        (a, b) =>
          new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime()
      );

    const total = filtered.length;
    const tickets = filtered
      .slice(offset, offset + limit)
      .map((t) => ({
        id: t.id,
        subject: t.subject,
        status: t.status,
        priority: t.priority,
        createdAt: t.createdAt,
        updatedAt: t.updatedAt,
      }));

    return NextResponse.json({ tickets, total, page, limit });
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

    const parsed = await parseJsonBody<{
      subject?: string;
      description?: string;
      priority?: string;
    }>(request);
    if ('error' in parsed) return parsed.error;
    const { subject, description, priority } = parsed.data;

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

        // Record ticket opened event
        await db.insert(schema.ticketEvents).values({
          ticketId: ticket.id,
          workspaceId,
          eventType: 'opened' as const,
          toStatus: 'open',
          actorType: 'customer' as const,
          actorLabel: email,
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
