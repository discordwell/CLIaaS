import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { csatSubmitted } from '@/lib/events';

export const dynamic = 'force-dynamic';

// In-memory store for demo mode
const demoRatings: Array<{
  id: string;
  ticketId: string;
  rating: number;
  comment: string | null;
  createdAt: string;
}> = [];

export async function POST(request: NextRequest) {
  try {
    const body = await request.json().catch(() => ({} as Record<string, unknown>));
    const { ticketId, rating, comment } = body as {
      ticketId?: string;
      rating?: number;
      comment?: string;
    };

    if (!ticketId) {
      return NextResponse.json(
        { error: 'ticketId is required' },
        { status: 400 }
      );
    }

    if (!rating || rating < 1 || rating > 5 || !Number.isInteger(rating)) {
      return NextResponse.json(
        { error: 'rating must be an integer between 1 and 5' },
        { status: 400 }
      );
    }

    // Try DB
    if (process.env.DATABASE_URL) {
      try {
        const { db } = await import('@/db');
        const schema = await import('@/db/schema');
        const { eq } = await import('drizzle-orm');

        // Verify ticket exists
        const tickets = await db
          .select({ id: schema.tickets.id })
          .from(schema.tickets)
          .where(eq(schema.tickets.id, ticketId))
          .limit(1);

        if (tickets.length === 0) {
          return NextResponse.json(
            { error: 'Ticket not found' },
            { status: 404 }
          );
        }

        // Check if already rated
        const existing = await db
          .select({ id: schema.csatRatings.id })
          .from(schema.csatRatings)
          .where(eq(schema.csatRatings.ticketId, ticketId))
          .limit(1);

        if (existing.length > 0) {
          // Update existing rating
          await db
            .update(schema.csatRatings)
            .set({ rating, comment: comment ?? null })
            .where(eq(schema.csatRatings.ticketId, ticketId));

          csatSubmitted({ ticketId, rating, comment: comment ?? null });
          return NextResponse.json({ ok: true, updated: true });
        }

        // Insert new rating
        const [csatRating] = await db
          .insert(schema.csatRatings)
          .values({
            ticketId,
            rating,
            comment: comment ?? null,
          })
          .returning();

        csatSubmitted({ ticketId, rating, comment: comment ?? null, id: csatRating.id });
        return NextResponse.json(
          { ok: true, id: csatRating.id },
          { status: 201 }
        );
      } catch {
        // DB unavailable, fall through
      }
    }

    // Demo mode: store in memory
    const existingIdx = demoRatings.findIndex((r) => r.ticketId === ticketId);
    if (existingIdx >= 0) {
      demoRatings[existingIdx] = {
        ...demoRatings[existingIdx],
        rating,
        comment: comment ?? null,
      };
      return NextResponse.json({ ok: true, updated: true });
    }

    const id = `csat-${Date.now()}`;
    demoRatings.push({
      id,
      ticketId,
      rating,
      comment: comment ?? null,
      createdAt: new Date().toISOString(),
    });

    csatSubmitted({ ticketId, rating, comment: comment ?? null, id });
    return NextResponse.json({ ok: true, id }, { status: 201 });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Failed to submit rating' },
      { status: 500 }
    );
  }
}

export async function GET() {
  try {
    // Try DB
    if (process.env.DATABASE_URL) {
      try {
        const { db } = await import('@/db');
        const schema = await import('@/db/schema');

        const rows = await db
          .select({
            rating: schema.csatRatings.rating,
          })
          .from(schema.csatRatings);

        if (rows.length === 0) {
          return NextResponse.json({
            totalResponses: 0,
            averageRating: 0,
            distribution: { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 },
            satisfactionPercent: 0,
          });
        }

        const distribution: Record<number, number> = { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 };
        let sum = 0;
        for (const row of rows) {
          distribution[row.rating] = (distribution[row.rating] ?? 0) + 1;
          sum += row.rating;
        }

        const totalResponses = rows.length;
        const averageRating = Math.round((sum / totalResponses) * 100) / 100;
        const satisfied = (distribution[4] ?? 0) + (distribution[5] ?? 0);
        const satisfactionPercent =
          Math.round((satisfied / totalResponses) * 10000) / 100;

        return NextResponse.json({
          totalResponses,
          averageRating,
          distribution,
          satisfactionPercent,
        });
      } catch {
        // DB unavailable, fall through
      }
    }

    // Demo mode
    if (demoRatings.length === 0) {
      return NextResponse.json({
        totalResponses: 0,
        averageRating: 0,
        distribution: { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 },
        satisfactionPercent: 0,
      });
    }

    const distribution: Record<number, number> = { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 };
    let sum = 0;
    for (const r of demoRatings) {
      distribution[r.rating] = (distribution[r.rating] ?? 0) + 1;
      sum += r.rating;
    }

    const totalResponses = demoRatings.length;
    const averageRating = Math.round((sum / totalResponses) * 100) / 100;
    const satisfied = (distribution[4] ?? 0) + (distribution[5] ?? 0);
    const satisfactionPercent =
      Math.round((satisfied / totalResponses) * 10000) / 100;

    return NextResponse.json({
      totalResponses,
      averageRating,
      distribution,
      satisfactionPercent,
    });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Failed to load stats' },
      { status: 500 }
    );
  }
}
