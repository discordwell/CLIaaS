import { safeErrorMessage } from '@/lib/parse-json-body';
import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { generateAccessReview } from '@/lib/security/access-review';
import { requirePerm } from '@/lib/rbac';

export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  const auth = await requirePerm(request, 'admin:settings', 'admin');
  if ('error' in auth) return auth.error;

  try {
    const report = generateAccessReview();
    return NextResponse.json(report);
  } catch (err) {
    return NextResponse.json(
      { error: safeErrorMessage(err, 'Failed to generate access review') },
      { status: 500 },
    );
  }
}
