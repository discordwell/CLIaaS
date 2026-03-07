import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import {
  getAutomationRules,
  updateAutomationRule,
  removeAutomationRule,
} from '@/lib/automation/executor';
import { parseJsonBody, safeErrorMessage } from '@/lib/parse-json-body';
import { requirePerm } from '@/lib/rbac';

export const dynamic = 'force-dynamic';

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const auth = await requirePerm(request, 'automation:view');
  if ('error' in auth) return auth.error;

  const { id } = await params;
  // Scope by workspace to prevent cross-workspace data leakage
  const rule = getAutomationRules(auth.user.workspaceId).find(r => r.id === id);
  if (!rule) {
    return NextResponse.json({ error: 'Rule not found' }, { status: 404 });
  }
  return NextResponse.json({ rule });
}

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const auth = await requirePerm(request, 'automation:edit');
  if ('error' in auth) return auth.error;

  const { id } = await params;
  try {
    const parsed = await parseJsonBody<Record<string, unknown>>(request);
    if ('error' in parsed) return parsed.error;
    // Scope by workspace to prevent cross-workspace modification
    const updated = updateAutomationRule(id, parsed.data, auth.user.workspaceId);
    if (!updated) {
      return NextResponse.json({ error: 'Rule not found' }, { status: 404 });
    }
    return NextResponse.json({ rule: updated });
  } catch (err) {
    return NextResponse.json(
      { error: safeErrorMessage(err, 'Update failed') },
      { status: 500 },
    );
  }
}

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const auth = await requirePerm(request, 'automation:edit');
  if ('error' in auth) return auth.error;

  const { id } = await params;
  // Scope by workspace to prevent cross-workspace deletion
  const removed = removeAutomationRule(id, auth.user.workspaceId);
  if (!removed) {
    return NextResponse.json({ error: 'Rule not found' }, { status: 404 });
  }
  return NextResponse.json({ ok: true });
}
