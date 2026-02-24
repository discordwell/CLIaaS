import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { getPendingApprovals, getApprovalQueue } from '@/lib/ai/approval-queue';
import { requireAuth } from '@/lib/api-auth';

export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  const auth = await requireAuth(request);
  if ('error' in auth) return auth.error;

  const { searchParams } = new URL(request.url);
  const status = searchParams.get('status');

  if (status === 'all') {
    const queue = getApprovalQueue();
    return NextResponse.json({ entries: queue, total: queue.length });
  }

  const pending = getPendingApprovals();
  return NextResponse.json({ entries: pending, total: pending.length });
}
