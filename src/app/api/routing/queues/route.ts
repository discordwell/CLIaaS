import { NextRequest, NextResponse } from 'next/server';
import { getRoutingQueues, createRoutingQueue } from '@/lib/routing/store';

export async function GET() {
  return NextResponse.json(getRoutingQueues());
}

export async function POST(request: NextRequest) {
  const body = await request.json();
  if (!body.name?.trim()) {
    return NextResponse.json({ error: 'name is required' }, { status: 400 });
  }
  const queue = createRoutingQueue({
    workspaceId: body.workspaceId ?? '',
    name: body.name,
    description: body.description,
    priority: body.priority ?? 0,
    conditions: body.conditions ?? {},
    strategy: body.strategy ?? 'skill_match',
    groupId: body.groupId,
    overflowQueueId: body.overflowQueueId,
    overflowTimeoutSecs: body.overflowTimeoutSecs,
    enabled: body.enabled ?? true,
  });
  return NextResponse.json(queue, { status: 201 });
}
