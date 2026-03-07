import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { parseJsonBody, safeErrorMessage } from '@/lib/parse-json-body';
import { requirePerm } from '@/lib/rbac';
import { evaluateRule, type TicketContext } from '@/lib/automation/engine';
import type { Rule } from '@/lib/automation/engine';
import type { RuleConditions } from '@/lib/automation/conditions';
import type { RuleAction } from '@/lib/automation/actions';
import { persistAuditEntry } from '@/lib/automation/audit-store';

export const dynamic = 'force-dynamic';

export async function POST(request: NextRequest) {
  const auth = await requirePerm(request, 'automation:edit');
  if ('error' in auth) return auth.error;

  const parsed = await parseJsonBody(request);
  if ('error' in parsed) return parsed.error;

  const { rule: inlineRule, ruleId, ticket } = parsed.data;

  if (!ticket || !ticket.id) {
    return NextResponse.json(
      { error: 'ticket with at least id field is required' },
      { status: 400 },
    );
  }

  try {
    let rule: Rule;

    if (ruleId) {
      // Load from DB
      if (!process.env.DATABASE_URL) {
        return NextResponse.json({ error: 'Database not configured' }, { status: 503 });
      }
      const { db } = await import('@/db');
      const schema = await import('@/db/schema');
      const { eq, and } = await import('drizzle-orm');

      const [row] = await db
        .select()
        .from(schema.rules)
        .where(and(eq(schema.rules.id, ruleId), eq(schema.rules.workspaceId, auth.user.workspaceId)))
        .limit(1);

      if (!row) {
        return NextResponse.json({ error: 'Rule not found' }, { status: 404 });
      }

      rule = {
        id: row.id,
        type: row.type,
        name: row.name,
        enabled: true, // force enabled for dry-run
        conditions: (row.conditions ?? { all: [], any: [] }) as RuleConditions,
        actions: (row.actions ?? []) as RuleAction[],
        workspaceId: row.workspaceId,
      };
    } else if (inlineRule) {
      rule = {
        id: 'dry-run-inline',
        type: inlineRule.type ?? 'trigger',
        name: inlineRule.name ?? 'Inline test',
        enabled: true,
        conditions: (inlineRule.conditions ?? { all: [], any: [] }) as RuleConditions,
        actions: (inlineRule.actions ?? []) as RuleAction[],
      };
    } else {
      return NextResponse.json(
        { error: 'Either ruleId or rule (inline) is required' },
        { status: 400 },
      );
    }

    const ticketCtx: TicketContext = {
      id: String(ticket.id),
      subject: String(ticket.subject ?? ''),
      status: String(ticket.status ?? 'open'),
      priority: String(ticket.priority ?? 'normal'),
      assignee: ticket.assignee != null ? String(ticket.assignee) : null,
      requester: String(ticket.requester ?? ''),
      tags: Array.isArray(ticket.tags) ? ticket.tags.map(String) : [],
      createdAt: String(ticket.createdAt ?? new Date().toISOString()),
      updatedAt: String(ticket.updatedAt ?? new Date().toISOString()),
      event: ticket.event,
      previousStatus: ticket.previousStatus,
      previousPriority: ticket.previousPriority,
      previousAssignee: ticket.previousAssignee,
      messageBody: ticket.messageBody,
    };

    const startTime = performance.now();
    const result = evaluateRule(rule, ticketCtx);
    const durationMs = Math.round(performance.now() - startTime);

    // Record dry-run audit (fire-and-forget)
    persistAuditEntry({
      id: crypto.randomUUID(),
      ruleId: rule.id,
      ruleName: rule.name,
      ruleType: rule.type,
      ticketId: ticketCtx.id,
      event: 'dry-run',
      matched: result.matched,
      dryRun: true,
      actionsExecuted: result.actionsExecuted,
      actions: result.changes,
      changes: result.changes,
      errors: result.errors,
      notificationsSent: result.notifications.length,
      webhooksFired: result.webhooks.length,
      durationMs,
      timestamp: new Date().toISOString(),
      workspaceId: auth.user.workspaceId,
    }).catch(() => {});

    // Build before/after diff
    const afterTicket = result.matched
      ? { ...ticketCtx, ...result.changes }
      : ticketCtx;

    return NextResponse.json({
      matched: result.matched,
      actionsExecuted: result.actionsExecuted,
      changes: result.changes,
      notifications: result.notifications,
      webhooks: result.webhooks,
      errors: result.errors,
      durationMs,
      before: ticketCtx,
      after: afterTicket,
    });
  } catch (err) {
    return NextResponse.json(
      { error: safeErrorMessage(err, 'Dry-run failed') },
      { status: 500 },
    );
  }
}
