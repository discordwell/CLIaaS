import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { requireRole } from '@/lib/api-auth';
import { enforceRetentionPolicies } from '@/lib/compliance/retention-scheduler';
import { recordAudit } from '@/lib/audit';

export const dynamic = 'force-dynamic';

export async function POST(request: NextRequest) {
  const auth = await requireRole(request, 'admin');
  if ('error' in auth) return auth.error;

  try {
    const results = await enforceRetentionPolicies(auth.user.workspaceId);

    // Audit the enforcement
    await recordAudit({
      userId: auth.user.id,
      userName: auth.user.email,
      action: 'compliance.retention.enforce',
      resource: 'retention_policy',
      resourceId: 'manual',
      details: { results },
      ipAddress: request.headers.get('x-forwarded-for') || 'unknown',
      workspaceId: auth.user.workspaceId,
    });

    return NextResponse.json({ results });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Failed to enforce retention policies' },
      { status: 500 }
    );
  }
}
