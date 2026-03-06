import { NextRequest, NextResponse } from 'next/server';
import { getRoutingLog } from '@/lib/routing/store';
import { requirePerm } from '@/lib/rbac';

export async function GET(request: NextRequest) {
  const auth = await requirePerm(request, 'automation:view');
  if ('error' in auth) return auth.error;

  const { searchParams } = new URL(request.url);
  const limit = Math.min(parseInt(searchParams.get('limit') ?? '100', 10), 200);
  const workspaceId = searchParams.get('workspaceId') ?? undefined;
  return NextResponse.json(getRoutingLog(workspaceId, limit));
}
