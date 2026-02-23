import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import {
  getAutomationRules,
  updateAutomationRule,
  removeAutomationRule,
} from '@/lib/automation/executor';
import { parseJsonBody } from '@/lib/parse-json-body';

export const dynamic = 'force-dynamic';

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const rule = getAutomationRules().find(r => r.id === id);
  if (!rule) {
    return NextResponse.json({ error: 'Rule not found' }, { status: 404 });
  }
  return NextResponse.json({ rule });
}

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  try {
    const parsed = await parseJsonBody<Record<string, unknown>>(request);
    if ('error' in parsed) return parsed.error;
    const updated = updateAutomationRule(id, parsed.data);
    if (!updated) {
      return NextResponse.json({ error: 'Rule not found' }, { status: 404 });
    }
    return NextResponse.json({ rule: updated });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Update failed' },
      { status: 500 },
    );
  }
}

export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const removed = removeAutomationRule(id);
  if (!removed) {
    return NextResponse.json({ error: 'Rule not found' }, { status: 404 });
  }
  return NextResponse.json({ ok: true });
}
