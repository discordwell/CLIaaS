import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { requireRole } from '@/lib/api-auth';
import { getPiiStats } from '@/lib/compliance/pii-masking';

export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  const auth = await requireRole(request, 'admin');
  if ('error' in auth) return auth.error;

  try {
    const stats = await getPiiStats(auth.user.workspaceId);
    return NextResponse.json(stats);
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Failed to get PII stats' },
      { status: 500 },
    );
  }
}
