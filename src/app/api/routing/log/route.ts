import { NextRequest, NextResponse } from 'next/server';
import { getRoutingLog } from '@/lib/routing/store';

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const limit = parseInt(searchParams.get('limit') ?? '100', 10);
  const workspaceId = searchParams.get('workspaceId') ?? undefined;
  return NextResponse.json(getRoutingLog(workspaceId, limit));
}
