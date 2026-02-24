import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import {
  getAutomationRules,
  addAutomationRule,
} from '@/lib/automation/executor';
import type { Rule } from '@/lib/automation/engine';
import { parseJsonBody } from '@/lib/parse-json-body';
import { requireAuth } from '@/lib/api-auth';

export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  const auth = await requireAuth(request);
  if ('error' in auth) return auth.error;

  const rules = getAutomationRules();
  return NextResponse.json({ rules });
}

export async function POST(request: NextRequest) {
  const auth = await requireAuth(request);
  if ('error' in auth) return auth.error;

  try {
    const parsed = await parseJsonBody<Partial<Rule>>(request);
    if ('error' in parsed) return parsed.error;
    const { name, type, conditions, actions, enabled } = parsed.data;

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
