import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import {
  getAutomationRules,
  addAutomationRule,
} from '@/lib/automation/executor';
import type { Rule } from '@/lib/automation/engine';

export const dynamic = 'force-dynamic';

export async function GET() {
  const rules = getAutomationRules();
  return NextResponse.json({ rules });
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json().catch(() => ({} as Record<string, unknown>));
    const { name, type, conditions, actions, enabled } = body as Partial<Rule>;

    if (!name || !type) {
      return NextResponse.json(
        { error: 'name and type are required' },
        { status: 400 },
      );
    }

    const rule: Rule = {
      id: crypto.randomUUID(),
      name,
      type,
      enabled: enabled ?? true,
      conditions: conditions ?? { all: [], any: [] },
      actions: actions ?? [],
    };

    addAutomationRule(rule);
    return NextResponse.json({ rule }, { status: 201 });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Failed to create rule' },
      { status: 500 },
    );
  }
}
