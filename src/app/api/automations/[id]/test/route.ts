import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { getAutomationRules } from '@/lib/automation/executor';
import { evaluateRule } from '@/lib/automation/engine';
import type { TicketContext } from '@/lib/automation/engine';
import { parseJsonBody } from '@/lib/parse-json-body';

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
    const parsed = await parseJsonBody<{ ticket?: TicketContext }>(request);
    if ('error' in parsed) return parsed.error;
    const { ticket } = parsed.data;

    if (!ticket || !ticket.id) {
      return NextResponse.json(
        { error: 'Request body must include a ticket object with at least an id' },
        { status: 400 },
      );
    }

    const result = evaluateRule(rule, ticket);
    return NextResponse.json({
      matched: result.matched,
      changes: result.changes,
      notifications: result.notifications,
      webhooks: result.webhooks,
      errors: result.errors,
    });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Test failed' },
      { status: 500 },
    );
  }
}
