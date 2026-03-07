import { safeErrorMessage } from '@/lib/parse-json-body';
import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { generateAuditReport } from '@/lib/compliance/audit-report';
import { requirePerm } from '@/lib/rbac';

export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  const auth = await requirePerm(request, 'admin:settings', 'admin');
  if ('error' in auth) return auth.error;

  try {
    const report = await generateAuditReport();
    return NextResponse.json(report);
  } catch (err) {
    return NextResponse.json(
      { error: safeErrorMessage(err, 'Audit export failed') },
      { status: 500 },
    );
  }
}
