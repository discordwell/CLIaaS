import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { parseJsonBody } from '@/lib/parse-json-body';
import { requireAuth } from '@/lib/api-auth';
import { applyMacro, type TicketContext } from '@/lib/automation/engine';
import type { Rule } from '@/lib/automation/engine';
import type { RuleConditions } from '@/lib/automation/conditions';
import type { RuleAction } from '@/lib/automation/actions';
import { applyExecutionResults } from '@/lib/automation/executor';
import { persistAuditEntry } from '@/lib/automation/audit-store';

export const dynamic = 'force-dynamic';

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const auth = await requireAuth(request);
  if ('error' in auth) return auth.error;

  const { id } = await params;
  const parsed = await parseJsonBody(request);
  if ('error' in parsed) return parsed.error;

  const { ticketId } = parsed.data;
  if (!ticketId) {
    return NextResponse.json({ error: 'ticketId is required' }, { status: 400 });
  }

  if (!process.env.DATABASE_URL) {
    return NextResponse.json({ error: 'Database not configured' }, { status: 503 });
  }

  try {
    const { db } = await import('@/db');
    const schema = await import('@/db/schema');
    const { eq, and } = await import('drizzle-orm');

    // Load macro
    const [macroRow] = await db
      .select()
      .from(schema.rules)
      .where(
        and(
          eq(schema.rules.id, id),
          eq(schema.rules.workspaceId, auth.user.workspaceId),
          eq(schema.rules.type, 'macro'),
        ),
      )
      .limit(1);

    if (!macroRow) {
      return NextResponse.json({ error: 'Macro not found' }, { status: 404 });
    }

    // Load ticket
    const [ticketRow] = await db
      .select()
      .from(schema.tickets)
      .where(
        and(
          eq(schema.tickets.id, ticketId),
          eq(schema.tickets.workspaceId, auth.user.workspaceId),
        ),
      )
      .limit(1);

    if (!ticketRow) {
      return NextResponse.json({ error: 'Ticket not found' }, { status: 404 });
    }

    const macro: Rule = {
      id: macroRow.id,
      type: 'macro',
      name: macroRow.name,
      enabled: true,
      conditions: (macroRow.conditions ?? {}) as RuleConditions,
      actions: (macroRow.actions ?? []) as RuleAction[],
      workspaceId: macroRow.workspaceId,
    };

    const ticket: TicketContext = {
      id: ticketRow.id,
      subject: ticketRow.subject ?? '',
      status: ticketRow.status ?? 'open',
      priority: ticketRow.priority ?? 'normal',
      assignee: ticketRow.assignee ?? null,
      requester: ticketRow.requester ?? '',
      tags: (ticketRow.tags as string[]) ?? [],
      createdAt: ticketRow.createdAt?.toISOString() ?? new Date().toISOString(),
      updatedAt: ticketRow.updatedAt?.toISOString() ?? new Date().toISOString(),
    };

    const startTime = performance.now();
    const executionResult = applyMacro(macro, ticket);
    const durationMs = Math.round(performance.now() - startTime);

    const { ticket: updated, notificationsSent, webhooksFired, errors } =
      await applyExecutionResults(executionResult, ticket, false);

    // Persist ticket changes
    if (Object.keys(executionResult.changes).length > 0) {
      const ticketUpdates: Record<string, unknown> = { updatedAt: new Date() };
      if (executionResult.changes.status) ticketUpdates.status = executionResult.changes.status;
      if (executionResult.changes.priority) ticketUpdates.priority = executionResult.changes.priority;
      if (executionResult.changes.assignee !== undefined) ticketUpdates.assignee = executionResult.changes.assignee;
      if (executionResult.changes.tags) ticketUpdates.tags = executionResult.changes.tags;

      await db
        .update(schema.tickets)
        .set(ticketUpdates)
        .where(eq(schema.tickets.id, ticketId));
    }

    // Record audit
    persistAuditEntry({
      id: crypto.randomUUID(),
      ruleId: macro.id,
      ruleName: macro.name,
      ruleType: 'macro',
      ticketId: ticket.id,
      event: 'macro.applied',
      matched: true,
      actionsExecuted: executionResult.actionsExecuted,
      actions: executionResult.changes,
      changes: executionResult.changes,
      errors: [...executionResult.errors, ...errors],
      notificationsSent,
      webhooksFired,
      durationMs,
      timestamp: new Date().toISOString(),
      dryRun: false,
      workspaceId: auth.user.workspaceId,
    }).catch(() => {});

    return NextResponse.json({
      applied: true,
      macroId: macro.id,
      macroName: macro.name,
      ticketId: ticket.id,
      changes: executionResult.changes,
      actionsExecuted: executionResult.actionsExecuted,
      notificationsSent,
      webhooksFired,
    });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Failed to apply macro' },
      { status: 500 },
    );
  }
}
