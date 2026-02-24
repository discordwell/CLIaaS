import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { parseJsonBody } from '@/lib/parse-json-body';
import { requireAuth } from '@/lib/api-auth';

export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  const auth = await requireAuth(request);
  if ('error' in auth) return auth.error;

  try {
    const { searchParams } = request.nextUrl;
    const type = searchParams.get('type');

    if (!process.env.DATABASE_URL) {
      // Return demo rules when no DB
      return NextResponse.json({ rules: getDemoRules(type) });
    }

    const { db } = await import('@/db');
    const schema = await import('@/db/schema');
    const { eq, and } = await import('drizzle-orm');

    const workspaceId = request.headers.get('x-workspace-id');
    const conditions = [
      ...(workspaceId ? [eq(schema.rules.workspaceId, workspaceId)] : []),
      ...(type ? [eq(schema.rules.type, type as 'trigger' | 'macro' | 'automation' | 'sla')] : []),
    ];

    const rows = await db
      .select()
      .from(schema.rules)
      .where(conditions.length > 0 ? and(...conditions) : undefined)
      .orderBy(schema.rules.createdAt);

    return NextResponse.json({ rules: rows });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Failed to load rules' },
      { status: 500 }
    );
  }
}

export async function POST(request: NextRequest) {
  const auth = await requireAuth(request);
  if ('error' in auth) return auth.error;

  const parsed = await parseJsonBody(request);
  if ('error' in parsed) return parsed.error;

  try {
    const { name, type, conditions, actions, enabled } = parsed.data;

    if (!name || !type) {
      return NextResponse.json(
        { error: 'Name and type are required' },
        { status: 400 }
      );
    }

    if (!process.env.DATABASE_URL) {
      return NextResponse.json(
        { error: 'Database not configured' },
        { status: 503 }
      );
    }

    const { db } = await import('@/db');
    const schema = await import('@/db/schema');

    // Get workspace from auth header or first available
    let workspaceId = request.headers.get('x-workspace-id');
    if (!workspaceId) {
      const rows = await db
        .select({ id: schema.workspaces.id })
        .from(schema.workspaces)
        .limit(1);
      workspaceId = rows[0]?.id;
    }

    if (!workspaceId) {
      return NextResponse.json(
        { error: 'No workspace found' },
        { status: 400 }
      );
    }

    const [rule] = await db
      .insert(schema.rules)
      .values({
        workspaceId,
        name,
        type,
        enabled: enabled ?? true,
        conditions: conditions ?? { all: [], any: [] },
        actions: actions ?? [],
      })
      .returning();

    return NextResponse.json({ rule }, { status: 201 });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Failed to create rule' },
      { status: 500 }
    );
  }
}

function getDemoRules(type: string | null) {
  const rules = [
    {
      id: 'demo-1',
      type: 'trigger',
      name: 'Auto-prioritize urgent keywords',
      enabled: true,
      conditions: {
        any: [
          { field: 'subject', operator: 'contains', value: 'urgent' },
          { field: 'subject', operator: 'contains', value: 'critical' },
          { field: 'subject', operator: 'contains', value: 'down' },
        ],
      },
      actions: [
        { type: 'set_priority', value: 'urgent' },
        { type: 'add_tag', value: 'auto-escalated' },
      ],
    },
    {
      id: 'demo-2',
      type: 'trigger',
      name: 'Tag billing tickets',
      enabled: true,
      conditions: {
        any: [
          { field: 'subject', operator: 'contains', value: 'invoice' },
          { field: 'subject', operator: 'contains', value: 'billing' },
          { field: 'subject', operator: 'contains', value: 'payment' },
        ],
      },
      actions: [{ type: 'add_tag', value: 'billing' }],
    },
    {
      id: 'demo-3',
      type: 'automation',
      name: 'Close stale solved tickets (72h)',
      enabled: true,
      conditions: {
        all: [
          { field: 'status', operator: 'is', value: 'solved' },
          { field: 'hours_since_updated', operator: 'greater_than', value: 72 },
        ],
      },
      actions: [{ type: 'close' }],
    },
    {
      id: 'demo-4',
      type: 'automation',
      name: 'Escalate old open tickets (48h)',
      enabled: true,
      conditions: {
        all: [
          { field: 'status', operator: 'is', value: 'open' },
          { field: 'priority', operator: 'is_not', value: 'urgent' },
          { field: 'hours_since_created', operator: 'greater_than', value: 48 },
        ],
      },
      actions: [{ type: 'set_priority', value: 'high' }, { type: 'add_tag', value: 'aging' }],
    },
    {
      id: 'demo-5',
      type: 'macro',
      name: 'Resolve with thanks',
      enabled: true,
      conditions: {},
      actions: [
        { type: 'set_status', value: 'solved' },
        { type: 'add_internal_note', value: 'Resolved by agent via macro' },
      ],
    },
    {
      id: 'demo-6',
      type: 'sla',
      name: 'Urgent response SLA (1h)',
      enabled: true,
      conditions: {
        all: [{ field: 'priority', operator: 'is', value: 'urgent' }],
      },
      actions: [
        { type: 'send_notification', channel: 'email', to: 'team-lead@company.com', template: 'sla_breach' },
        { type: 'add_tag', value: 'sla-breached' },
      ],
    },
  ];

  return type ? rules.filter(r => r.type === type) : rules;
}
