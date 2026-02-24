import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { requireAuth } from '@/lib/api-auth';

export const dynamic = 'force-dynamic';

/**
 * GET /api/csat/ratings — returns raw CSAT rating records.
 * Used by RemoteProvider.loadCSATRatings().
 */
export async function GET(request: NextRequest) {
  const auth = await requireAuth(request);
  if ('error' in auth) return auth.error;

  try {
    if (!process.env.DATABASE_URL) {
      return NextResponse.json({ ratings: [] });
    }

    const { db } = await import('@/db');
    const schema = await import('@/db/schema');

    const rows = await db
      .select({
        ticketId: schema.csatRatings.ticketId,
        rating: schema.csatRatings.rating,
        createdAt: schema.csatRatings.createdAt,
      })
      .from(schema.csatRatings);

    const ratings = rows.map((r: { ticketId: string; rating: number; createdAt: Date }) => ({
      ticketId: r.ticketId,
      rating: r.rating,
      createdAt: r.createdAt.toISOString(),
    }));

    return NextResponse.json({ ratings });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Failed to load ratings' },
      { status: 500 },
    );
  }
}
