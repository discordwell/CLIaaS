import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { getComplianceStatus } from '@/lib/compliance';
import { requireRole } from '@/lib/api-auth';

export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  const auth = await requireRole(request, 'admin');
  if ('error' in auth) return auth.error;

  try {
    const status = await getComplianceStatus(auth.user.workspaceId);
    return NextResponse.json(status);
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Failed to get compliance status' },
      { status: 500 }
    );
  }
}
