import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { requirePerm } from '@/lib/rbac';
import { parseJsonBody } from '@/lib/parse-json-body';

export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  const auth = await requirePerm(request, 'analytics:view');
  if ('error' in auth) return auth.error;

  const { searchParams } = new URL(request.url);
  const userId = searchParams.get('userId') ?? undefined;

  const { agentStatusTracker } = await import('@/lib/wfm/agent-status');

  if (userId) {
    const status = agentStatusTracker.getStatus(userId);
    return NextResponse.json({ status: status ?? null });
  }

  const statuses = agentStatusTracker.getAllStatuses();
  return NextResponse.json({ statuses, total: statuses.length });
}

export async function POST(request: NextRequest) {
  const auth = await requirePerm(request, 'admin:settings', 'admin');
  if ('error' in auth) return auth.error;

  const parsed = await parseJsonBody<{
    userId: string;
    userName: string;
    status: 'online' | 'away' | 'offline' | 'on_break';
    reason?: string;
  }>(request);
  if ('error' in parsed) return parsed.error;

  const { userId, userName, status, reason } = parsed.data;

  if (!userId || !userName || !status) {
    return NextResponse.json({ error: 'userId, userName, and status are required' }, { status: 400 });
  }

  const validStatuses = ['online', 'away', 'offline', 'on_break'];
  if (!validStatuses.includes(status)) {
    return NextResponse.json({ error: `status must be one of: ${validStatuses.join(', ')}` }, { status: 400 });
  }

  const { agentStatusTracker } = await import('@/lib/wfm/agent-status');
  agentStatusTracker.setStatus(userId, userName, status, reason);

  return NextResponse.json({ updated: true, status: agentStatusTracker.getStatus(userId) });
}
