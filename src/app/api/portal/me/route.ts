import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { getPortalEmail } from '@/lib/portal/get-portal-email';
import { loadTickets } from '@/lib/data';

export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  const email = getPortalEmail(request);
  if (!email) {
    return NextResponse.json(
      { error: 'Not authenticated' },
      { status: 401 },
    );
  }

  // Try DB
  if (process.env.DATABASE_URL) {
    try {
      const { db } = await import('@/db');
      const schema = await import('@/db/schema');
      const { eq, sql, desc } = await import('drizzle-orm');

      // Find customer with org join
      const customerRows = await db
        .select({
          id: schema.customers.id,
          orgId: schema.customers.orgId,
          orgName: schema.organizations.name,
        })
        .from(schema.customers)
        .leftJoin(
          schema.organizations,
          eq(schema.customers.orgId, schema.organizations.id),
        )
        .where(eq(schema.customers.email, email))
        .limit(1);

      if (customerRows.length > 0) {
        const customer = customerRows[0];

        // Ticket stats grouped by status
        const statsRows = await db
          .select({
            status: schema.tickets.status,
            count: sql<number>`count(*)::int`,
          })
          .from(schema.tickets)
          .where(eq(schema.tickets.requesterId, customer.id))
          .groupBy(schema.tickets.status);

        const stats = { open: 0, pending: 0, solved: 0, total: 0 };
        for (const row of statsRows) {
          const n = row.count;
          if (row.status === 'open') stats.open = n;
          else if (row.status === 'pending') stats.pending = n;
          else if (row.status === 'solved') stats.solved = n;
          stats.total += n;
        }

        // Recent tickets (last 5)
        const recentRows = await db
          .select({
            id: schema.tickets.id,
            subject: schema.tickets.subject,
            status: schema.tickets.status,
            updatedAt: schema.tickets.updatedAt,
          })
          .from(schema.tickets)
          .where(eq(schema.tickets.requesterId, customer.id))
          .orderBy(desc(schema.tickets.updatedAt))
          .limit(5);

        const recentTickets = recentRows.map((r) => ({
          id: r.id,
          subject: r.subject,
          status: r.status,
          updatedAt: r.updatedAt.toISOString(),
        }));

        return NextResponse.json({
          email,
          stats,
          recentTickets,
          orgId: customer.orgId ?? undefined,
          orgName: customer.orgName ?? undefined,
        });
      }
    } catch {
      // DB unavailable, fall through
    }
  }

  // JSONL fallback
  const allTickets = await loadTickets();
  const myTickets = allTickets.filter(
    (t) => t.requester.toLowerCase() === email.toLowerCase(),
  );

  const stats = { open: 0, pending: 0, solved: 0, total: myTickets.length };
  for (const t of myTickets) {
    if (t.status === 'open') stats.open++;
    else if (t.status === 'pending') stats.pending++;
    else if (t.status === 'solved') stats.solved++;
  }

  const recentTickets = myTickets
    .sort(
      (a, b) =>
        new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime(),
    )
    .slice(0, 5)
    .map((t) => ({
      id: t.id,
      subject: t.subject,
      status: t.status,
      updatedAt: t.updatedAt,
    }));

  return NextResponse.json({
    email,
    stats,
    recentTickets,
  });
}
