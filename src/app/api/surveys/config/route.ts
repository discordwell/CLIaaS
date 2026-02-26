import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { parseJsonBody } from '@/lib/parse-json-body';
import type { SurveyType, SurveyTrigger } from '@/lib/data-provider/types';

export const dynamic = 'force-dynamic';

// In-memory config store for demo mode
const demoConfigs: Map<SurveyType, {
  id: string;
  surveyType: SurveyType;
  enabled: boolean;
  trigger: SurveyTrigger;
  delayMinutes: number;
  question?: string;
}> = new Map();

/**
 * GET /api/surveys/config — list all survey configs
 */
export async function GET() {
  try {
    if (process.env.DATABASE_URL) {
      try {
        const { db } = await import('@/db');
        const schema = await import('@/db/schema');
        const { eq } = await import('drizzle-orm');

        const workspaces = await db
          .select({ id: schema.workspaces.id })
          .from(schema.workspaces)
          .limit(1);
        const workspaceId = workspaces[0]?.id;
        if (!workspaceId) {
          return NextResponse.json({ configs: [] });
        }

        const rows = await db
          .select()
          .from(schema.surveyConfigs)
          .where(eq(schema.surveyConfigs.workspaceId, workspaceId));

        const configs = rows.map((r: {
          id: string; workspaceId: string; surveyType: string; enabled: boolean;
          trigger: string; delayMinutes: number; question: string | null;
        }) => ({
          id: r.id,
          workspaceId: r.workspaceId,
          surveyType: r.surveyType,
          enabled: r.enabled,
          trigger: r.trigger,
          delayMinutes: r.delayMinutes,
          question: r.question ?? undefined,
        }));

        return NextResponse.json({ configs });
      } catch {
        // DB unavailable, fall through
      }
    }

    // Demo mode
    const configs = Array.from(demoConfigs.values());
    return NextResponse.json({ configs });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Failed to load configs' },
      { status: 500 },
    );
  }
}

/**
 * PUT /api/surveys/config — update a survey config (upsert by surveyType)
 */
export async function PUT(request: NextRequest) {
  try {
    const parsed = await parseJsonBody<{
      surveyType?: string;
      enabled?: boolean;
      trigger?: string;
      delayMinutes?: number;
      question?: string;
    }>(request);
    if ('error' in parsed) return parsed.error;
    const { surveyType, enabled, trigger, delayMinutes, question } = parsed.data;

    if (!surveyType || !['csat', 'nps', 'ces'].includes(surveyType)) {
      return NextResponse.json(
        { error: 'surveyType must be one of: csat, nps, ces' },
        { status: 400 },
      );
    }

    const validTriggers = ['ticket_solved', 'ticket_closed', 'manual'];
    if (trigger && !validTriggers.includes(trigger)) {
      return NextResponse.json(
        { error: 'trigger must be one of: ticket_solved, ticket_closed, manual' },
        { status: 400 },
      );
    }

    const type = surveyType as SurveyType;

    if (process.env.DATABASE_URL) {
      try {
        const { db } = await import('@/db');
        const schema = await import('@/db/schema');
        const { eq, and } = await import('drizzle-orm');

        const workspaces = await db
          .select({ id: schema.workspaces.id })
          .from(schema.workspaces)
          .limit(1);
        const workspaceId = workspaces[0]?.id;
        if (!workspaceId) {
          return NextResponse.json({ error: 'No workspace configured' }, { status: 500 });
        }

        // Check if config exists
        const existing = await db
          .select({ id: schema.surveyConfigs.id })
          .from(schema.surveyConfigs)
          .where(and(
            eq(schema.surveyConfigs.workspaceId, workspaceId),
            eq(schema.surveyConfigs.surveyType, type),
          ))
          .limit(1);

        if (existing.length > 0) {
          // Update
          const set: Record<string, unknown> = { updatedAt: new Date() };
          if (enabled !== undefined) set.enabled = enabled;
          if (trigger) set.trigger = trigger;
          if (delayMinutes !== undefined) set.delayMinutes = delayMinutes;
          if (question !== undefined) set.question = question;

          await db
            .update(schema.surveyConfigs)
            .set(set)
            .where(eq(schema.surveyConfigs.id, existing[0].id));

          return NextResponse.json({ ok: true, updated: true });
        }

        // Insert new config
        const [row] = await db
          .insert(schema.surveyConfigs)
          .values({
            workspaceId,
            surveyType: type,
            enabled: enabled ?? false,
            trigger: (trigger as SurveyTrigger) ?? 'ticket_solved',
            delayMinutes: delayMinutes ?? 0,
            question: question ?? null,
          })
          .returning({ id: schema.surveyConfigs.id });

        return NextResponse.json({ ok: true, id: row.id }, { status: 201 });
      } catch {
        // DB unavailable, fall through
      }
    }

    // Demo mode
    const existing = demoConfigs.get(type);
    demoConfigs.set(type, {
      id: existing?.id ?? `config-${Date.now()}`,
      surveyType: type,
      enabled: enabled ?? existing?.enabled ?? false,
      trigger: (trigger as SurveyTrigger) ?? existing?.trigger ?? 'ticket_solved',
      delayMinutes: delayMinutes ?? existing?.delayMinutes ?? 0,
      question: question ?? existing?.question,
    });

    return NextResponse.json({ ok: true, updated: !!existing });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Failed to update config' },
      { status: 500 },
    );
  }
}
