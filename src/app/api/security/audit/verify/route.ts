import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { verifyChainIntegrity } from '@/lib/security/audit-log';
import { requireRole } from '@/lib/api-auth';

export const dynamic = 'force-dynamic';

export async function POST(request: NextRequest) {
  const auth = await requireRole(request, 'admin');
  if ('error' in auth) return auth.error;

  try {
    const result = verifyChainIntegrity();
    return NextResponse.json(result);
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Failed to verify chain integrity' },
      { status: 500 },
    );
  }
}
