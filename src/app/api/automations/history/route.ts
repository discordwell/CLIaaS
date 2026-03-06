import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { getAuditLog } from '@/lib/automation/executor';
import { requirePerm } from '@/lib/rbac';

export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  const auth = await requirePerm(request, 'automation:view');
  if ('error' in auth) return auth.error;

  // Scope by workspace to prevent cross-workspace data leakage
  const entries = getAuditLog(auth.user.workspaceId);
  return NextResponse.json({ entries, total: entries.length });
}
