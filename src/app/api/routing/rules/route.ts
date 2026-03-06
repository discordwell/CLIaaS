import { NextRequest, NextResponse } from 'next/server';
import { getRoutingRules, createRoutingRule } from '@/lib/routing/store';
import { requirePerm } from '@/lib/rbac';

export async function GET(request: NextRequest) {
  const auth = await requirePerm(request, 'automation:view');
  if ('error' in auth) return auth.error;

  return NextResponse.json(getRoutingRules());
}

export async function POST(request: NextRequest) {
  const auth = await requirePerm(request, 'automation:edit');
  if ('error' in auth) return auth.error;

  let body: Record<string, unknown>;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  if (!body.name || typeof body.name !== 'string' || !body.name.trim() || !body.targetType || !body.targetId) {
    return NextResponse.json({ error: 'name, targetType, and targetId are required' }, { status: 400 });
  }
  const rule = createRoutingRule({
    workspaceId: (body.workspaceId as string) ?? '',
    name: body.name as string,
    priority: (body.priority as number) ?? 0,
    conditions: (body.conditions as Record<string, unknown>) ?? {},
    targetType: body.targetType as 'queue' | 'group' | 'agent',
    targetId: body.targetId as string,
    enabled: (body.enabled as boolean) ?? true,
  });
  return NextResponse.json(rule, { status: 201 });
}
