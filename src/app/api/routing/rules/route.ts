import { NextRequest, NextResponse } from 'next/server';
import { getRoutingRules, createRoutingRule } from '@/lib/routing/store';

export async function GET() {
  return NextResponse.json(getRoutingRules());
}

export async function POST(request: NextRequest) {
  const body = await request.json();
  if (!body.name?.trim() || !body.targetType || !body.targetId) {
    return NextResponse.json({ error: 'name, targetType, and targetId are required' }, { status: 400 });
  }
  const rule = createRoutingRule({
    workspaceId: body.workspaceId ?? '',
    name: body.name,
    priority: body.priority ?? 0,
    conditions: body.conditions ?? {},
    targetType: body.targetType,
    targetId: body.targetId,
    enabled: body.enabled ?? true,
  });
  return NextResponse.json(rule, { status: 201 });
}
