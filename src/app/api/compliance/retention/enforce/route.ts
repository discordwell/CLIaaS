import { safeErrorMessage } from '@/lib/parse-json-body';
import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { requirePerm } from '@/lib/rbac';
import { enforceRetentionPolicies } from '@/lib/compliance/retention-scheduler';
import { recordAudit } from '@/lib/audit';

export const dynamic = 'force-dynamic';

export async function POST(request: NextRequest) {
  const auth = await requirePerm(request, 'admin:settings', 'admin');
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
      { error: safeErrorMessage(err, 'Failed to enforce retention policies') },
      { status: 500 }
    );
  }
}
