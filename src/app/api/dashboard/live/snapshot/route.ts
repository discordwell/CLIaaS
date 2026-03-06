import { NextResponse } from 'next/server';
import { requirePerm } from '@/lib/rbac';
import { computeLiveSnapshot } from '@/lib/reports/live-metrics';

export const dynamic = 'force-dynamic';

/**
 * One-shot JSON endpoint for live dashboard snapshot.
 * Polling fallback for clients that cannot use SSE, and MCP tool backend.
 */
export async function GET(request: Request) {
  const auth = await requirePerm(request, 'analytics:view');
  if ('error' in auth) return auth.error;

  const snapshot = await computeLiveSnapshot(auth.user.workspaceId);
  return NextResponse.json(snapshot);
}
