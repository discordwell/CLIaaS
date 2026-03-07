import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { requireSCIMAuth } from '@/lib/scim/auth';
import { getScimAuditLog } from '@/lib/scim/store';

export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  const auth = requireSCIMAuth(request);
  if (!auth.ok) return auth.response;

  const { searchParams } = new URL(request.url);
  const workspaceId = (auth as unknown as { workspaceId?: string }).workspaceId ?? 'default';
  const entityType = searchParams.get('entityType') ?? undefined;
  const entityId = searchParams.get('entityId') ?? undefined;
  const limitParam = searchParams.get('limit');
  const limit = limitParam ? Math.min(Math.max(1, parseInt(limitParam, 10) || 100), 1000) : 100;

  const entries = getScimAuditLog(workspaceId, { entityType, entityId, limit });

  return NextResponse.json({ entries });
}
