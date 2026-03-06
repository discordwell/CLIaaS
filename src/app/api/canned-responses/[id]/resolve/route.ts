import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { requireAuth } from '@/lib/api-auth';
import { parseJsonBody } from '@/lib/parse-json-body';
import { getCannedResponse, incrementCannedUsage } from '@/lib/canned/canned-store';
import { resolveMergeVariables, type MergeContext } from '@/lib/canned/merge';
import { loadTickets } from '@/lib/data';

export const dynamic = 'force-dynamic';

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const auth = await requireAuth(request);
  if ('error' in auth) return auth.error;
  const { id } = await params;

  const parsed = await parseJsonBody<{ ticketId?: string }>(request);
  if ('error' in parsed) return parsed.error;

  try {
    let body: string | null = null;

    if (process.env.DATABASE_URL) {
      const { db } = await import('@/db');
      const schema = await import('@/db/schema');
      const { eq, and } = await import('drizzle-orm');

      const [row] = await db.select().from(schema.cannedResponses)
        .where(and(eq(schema.cannedResponses.id, id), eq(schema.cannedResponses.workspaceId, auth.user.workspaceId)))
        .limit(1);
      if (!row) return NextResponse.json({ error: 'Not found' }, { status: 404 });
      body = row.body;

      // Increment usage
      await db.update(schema.cannedResponses)
        .set({ usageCount: (row.usageCount ?? 0) + 1, updatedAt: new Date() })
        .where(eq(schema.cannedResponses.id, id));
    } else {
      const cr = getCannedResponse(id);
      if (!cr) return NextResponse.json({ error: 'Not found' }, { status: 404 });
      body = cr.body;
      incrementCannedUsage(id);
    }

    // Build merge context
    const context: MergeContext = {
      agent: { name: auth.user.name ?? auth.user.email, email: auth.user.email },
    };

    if (parsed.data.ticketId) {
      const tickets = await loadTickets();
      const ticket = tickets.find(t => t.id === parsed.data.ticketId || t.externalId === parsed.data.ticketId);
      if (ticket) {
        context.ticket = {
          id: ticket.id,
          subject: ticket.subject,
          status: ticket.status,
          priority: ticket.priority,
          externalId: ticket.externalId,
          createdAt: ticket.createdAt,
        };
        context.customer = {
          name: ticket.requester,
          email: ticket.requester,
        };
      }
    }

    const resolved = resolveMergeVariables(body, context);
    return NextResponse.json({ resolved });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Failed to resolve' },
      { status: 500 },
    );
  }
}
