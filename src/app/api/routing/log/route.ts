import { NextRequest, NextResponse } from 'next/server';
import { getRoutingLog } from '@/lib/routing/store';
import { requireScope } from '@/lib/api-auth';

export async function GET(request: NextRequest) {
  const auth = await requireScope(request, 'routing:read');
  if ('error' in auth) return auth.error;

  const { searchParams } = new URL(request.url);
  const limit = Math.min(parseInt(searchParams.get('limit') ?? '100', 10), 200);
  const workspaceId = searchParams.get('workspaceId') ?? undefined;
  return NextResponse.json(getRoutingLog(workspaceId, limit));
}
