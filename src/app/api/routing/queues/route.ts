import { NextRequest, NextResponse } from 'next/server';
import { getRoutingQueues, createRoutingQueue } from '@/lib/routing/store';
import { requireScope } from '@/lib/api-auth';
import type { RoutingStrategy } from '@/lib/routing/types';

const VALID_STRATEGIES: RoutingStrategy[] = ['round_robin', 'load_balanced', 'skill_match', 'priority_weighted'];

export async function GET(request: NextRequest) {
  const auth = await requireScope(request, 'routing:read');
  if ('error' in auth) return auth.error;

  return NextResponse.json(getRoutingQueues());
}

export async function POST(request: NextRequest) {
  const auth = await requireScope(request, 'routing:write');
  if ('error' in auth) return auth.error;

  let body: Record<string, unknown>;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  if (!body.name || typeof body.name !== 'string' || !body.name.trim()) {
    return NextResponse.json({ error: 'name is required' }, { status: 400 });
  }
  if (body.strategy && !VALID_STRATEGIES.includes(body.strategy as RoutingStrategy)) {
    return NextResponse.json({ error: `Invalid strategy. Must be one of: ${VALID_STRATEGIES.join(', ')}` }, { status: 400 });
  }

  const queue = createRoutingQueue({
    workspaceId: body.workspaceId as string ?? '',
    name: body.name as string,
    description: body.description as string | undefined,
    priority: (body.priority as number) ?? 0,
    conditions: (body.conditions as Record<string, unknown>) ?? {},
    strategy: (body.strategy as RoutingStrategy) ?? 'skill_match',
    groupId: body.groupId as string | undefined,
    overflowQueueId: body.overflowQueueId as string | undefined,
    overflowTimeoutSecs: body.overflowTimeoutSecs as number | undefined,
    enabled: (body.enabled as boolean) ?? true,
  });
  return NextResponse.json(queue, { status: 201 });
}
