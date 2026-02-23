import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { getAutomationRules, executeRules } from '@/lib/automation/executor';
import type { TicketContext } from '@/lib/automation/engine';

export const dynamic = 'force-dynamic';

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const rule = getAutomationRules().find(r => r.id === id);
  if (!rule) {
    return NextResponse.json({ error: 'Rule not found' }, { status: 404 });
  }

  try {
    const body = await request.json().catch(() => ({} as Record<string, unknown>));
    const ticket = body.ticket as TicketContext | undefined;

    if (!ticket || !ticket.id) {
      return NextResponse.json(
        { error: 'Request body must include a ticket object with at least an id' },
        { status: 400 },
      );
    }

    const results = executeRules({
      ticket,
      event: 'test.dry_run',
      triggerType: rule.type === 'sla' ? 'sla' : rule.type === 'automation' ? 'automation' : 'trigger',
      dryRun: true,
    });

    const ruleResult = results.find(r => r.ruleId === id);
    return NextResponse.json({
      matched: ruleResult?.matched ?? false,
      changes: ruleResult?.changes ?? {},
      errors: ruleResult?.errors ?? [],
    });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Test failed' },
      { status: 500 },
    );
  }
}
