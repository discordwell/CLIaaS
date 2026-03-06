import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { requireAuth } from '@/lib/api-auth';

export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  const auth = await requireAuth(request);
  if ('error' in auth) return auth.error;

  try {
    if (!process.env.DATABASE_URL) {
      return NextResponse.json({ macros: [] });
    }

    const { db } = await import('@/db');
    const schema = await import('@/db/schema');
    const { eq, and } = await import('drizzle-orm');

    const rows = await db
      .select()
      .from(schema.rules)
      .where(
        and(
          eq(schema.rules.workspaceId, auth.user.workspaceId),
          eq(schema.rules.type, 'macro'),
          eq(schema.rules.enabled, true),
        ),
      )
      .orderBy(schema.rules.name);

    return NextResponse.json({ macros: rows });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Failed to load macros' },
      { status: 500 },
    );
  }
}
