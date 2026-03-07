import { safeErrorMessage } from '@/lib/parse-json-body';
import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { verifyChainIntegrity } from '@/lib/security/audit-log';
import { requirePerm } from '@/lib/rbac';

export const dynamic = 'force-dynamic';

export async function POST(request: NextRequest) {
  const auth = await requirePerm(request, 'admin:settings', 'admin');
  if ('error' in auth) return auth.error;

  try {
    const result = verifyChainIntegrity();
    return NextResponse.json(result);
  } catch (err) {
    return NextResponse.json(
      { error: safeErrorMessage(err, 'Failed to verify chain integrity') },
      { status: 500 },
    );
  }
}
