import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { getAuditLog } from '@/lib/automation/executor';
import { requireAuth } from '@/lib/api-auth';

export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  const auth = await requireAuth(request);
  if ('error' in auth) return auth.error;

  const entries = getAuditLog();
  return NextResponse.json({ entries, total: entries.length });
}
