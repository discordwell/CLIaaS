import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { requirePerm } from '@/lib/rbac';
import { getSyncHealth } from '@/lib/sync/health-store';

export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  const auth = await requirePerm(request, 'admin:settings', 'admin');
  if ('error' in auth) return auth.error;

  const workspaceId = (auth as { user: { workspaceId: string } }).user.workspaceId ?? 'default';
  const records = await getSyncHealth(workspaceId);

  return NextResponse.json({ health: records });
}
