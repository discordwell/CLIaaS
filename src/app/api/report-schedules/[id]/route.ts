import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { requireScope } from '@/lib/api-auth';
import { parseJsonBody } from '@/lib/parse-json-body';

export const dynamic = 'force-dynamic';

export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const auth = await requireScope(request, 'reports:write');
  if ('error' in auth) return auth.error;
  const { id } = await params;

  const parsed = await parseJsonBody<{
    enabled?: boolean;
    frequency?: 'daily' | 'weekly' | 'monthly';
    recipients?: string[];
    format?: 'csv' | 'json';
    hourUtc?: number;
    dayOfWeek?: number;
    dayOfMonth?: number;
  }>(request);
  if ('error' in parsed) return parsed.error;

  try {
    if (process.env.DATABASE_URL) {
      const { db } = await import('@/db');
      const schema = await import('@/db/schema');
      const { eq, and } = await import('drizzle-orm');

      const updates: Record<string, unknown> = { updatedAt: new Date() };
      const d = parsed.data;
      if (d.enabled !== undefined) updates.enabled = d.enabled;
      if (d.frequency !== undefined) updates.frequency = d.frequency;
      if (d.recipients !== undefined) updates.recipients = d.recipients;
      if (d.format !== undefined) updates.format = d.format;
      if (d.hourUtc !== undefined) updates.hourUtc = d.hourUtc;
      if (d.dayOfWeek !== undefined) updates.dayOfWeek = d.dayOfWeek;
      if (d.dayOfMonth !== undefined) updates.dayOfMonth = d.dayOfMonth;

      const [row] = await db.update(schema.reportSchedules)
        .set(updates)
        .where(and(
          eq(schema.reportSchedules.id, id),
          eq(schema.reportSchedules.workspaceId, auth.user.workspaceId),
        ))
        .returning();

      if (!row) return NextResponse.json({ error: 'Schedule not found' }, { status: 404 });
      return NextResponse.json({ schedule: row });
    }

    return NextResponse.json({ error: 'Not supported in JSONL mode' }, { status: 501 });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Failed to update schedule' },
      { status: 500 },
    );
  }
}

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const auth = await requireScope(request, 'reports:write');
  if ('error' in auth) return auth.error;
  const { id } = await params;

  try {
    if (process.env.DATABASE_URL) {
      const { db } = await import('@/db');
      const schema = await import('@/db/schema');
      const { eq, and } = await import('drizzle-orm');

      const [deleted] = await db.delete(schema.reportSchedules)
        .where(and(
          eq(schema.reportSchedules.id, id),
          eq(schema.reportSchedules.workspaceId, auth.user.workspaceId),
        ))
        .returning({ id: schema.reportSchedules.id });

      if (!deleted) return NextResponse.json({ error: 'Schedule not found' }, { status: 404 });
      return NextResponse.json({ deleted: true, id });
    }

    return NextResponse.json({ error: 'Not supported in JSONL mode' }, { status: 501 });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Failed to delete schedule' },
      { status: 500 },
    );
  }
}
