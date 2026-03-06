import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { requireScope } from '@/lib/api-auth';
import { parseJsonBody } from '@/lib/parse-json-body';

export const dynamic = 'force-dynamic';

/** In-memory fallback when DB is unavailable */
const memoryStore = new Map<string, Record<string, unknown>>();

function computeNextRun(frequency: string, hourUtc: number, dayOfWeek?: number, dayOfMonth?: number): Date {
  const now = new Date();
  const next = new Date(now);
  next.setUTCMinutes(0, 0, 0);
  next.setUTCHours(hourUtc);

  if (next <= now) next.setUTCDate(next.getUTCDate() + 1);

  if (frequency === 'weekly' && dayOfWeek !== undefined) {
    while (next.getUTCDay() !== dayOfWeek) next.setUTCDate(next.getUTCDate() + 1);
  } else if (frequency === 'monthly' && dayOfMonth !== undefined) {
    next.setUTCDate(dayOfMonth);
    if (next <= now) next.setUTCMonth(next.getUTCMonth() + 1);
  }

  return next;
}

export async function GET(request: NextRequest) {
  const auth = await requireScope(request, 'reports:write');
  if ('error' in auth) return auth.error;

  try {
    if (process.env.DATABASE_URL) {
      const { db } = await import('@/db');
      const schema = await import('@/db/schema');
      const { eq, desc } = await import('drizzle-orm');

      const rows = await db.select().from(schema.reportSchedules)
        .where(eq(schema.reportSchedules.workspaceId, auth.user.workspaceId))
        .orderBy(desc(schema.reportSchedules.createdAt));

      return NextResponse.json({ schedules: rows });
    }

    const schedules = Array.from(memoryStore.values())
      .filter(s => s.workspaceId === auth.user.workspaceId);
    return NextResponse.json({ schedules });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Failed to list schedules' },
      { status: 500 },
    );
  }
}

export async function POST(request: NextRequest) {
  const auth = await requireScope(request, 'reports:write');
  if ('error' in auth) return auth.error;

  const parsed = await parseJsonBody<{
    reportId: string;
    frequency: 'daily' | 'weekly' | 'monthly';
    recipients: string[];
    format?: 'csv' | 'json';
    hourUtc?: number;
    dayOfWeek?: number;
    dayOfMonth?: number;
  }>(request);
  if ('error' in parsed) return parsed.error;

  const { reportId, frequency, recipients, format, hourUtc, dayOfWeek, dayOfMonth } = parsed.data;
  if (!reportId?.trim() || !frequency || !recipients?.length) {
    return NextResponse.json(
      { error: 'reportId, frequency, and recipients are required' },
      { status: 400 },
    );
  }

  const hour = hourUtc ?? 9;
  const nextRunAt = computeNextRun(frequency, hour, dayOfWeek, dayOfMonth);

  try {
    if (process.env.DATABASE_URL) {
      const { db } = await import('@/db');
      const schema = await import('@/db/schema');

      const [row] = await db.insert(schema.reportSchedules).values({
        workspaceId: auth.user.workspaceId,
        reportId,
        frequency,
        recipients,
        format: format ?? 'csv',
        hourUtc: hour,
        dayOfWeek: dayOfWeek ?? null,
        dayOfMonth: dayOfMonth ?? null,
        enabled: true,
        nextRunAt,
        createdBy: auth.user.id,
      }).returning();

      return NextResponse.json({ schedule: row }, { status: 201 });
    }

    const id = crypto.randomUUID();
    const schedule = {
      id,
      workspaceId: auth.user.workspaceId,
      reportId,
      frequency,
      recipients,
      format: format ?? 'csv',
      hourUtc: hour,
      dayOfWeek: dayOfWeek ?? null,
      dayOfMonth: dayOfMonth ?? null,
      enabled: true,
      nextRunAt: nextRunAt.toISOString(),
      lastSentAt: null,
      createdBy: auth.user.id,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    memoryStore.set(id, schedule);
    return NextResponse.json({ schedule }, { status: 201 });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Failed to create schedule' },
      { status: 500 },
    );
  }
}
