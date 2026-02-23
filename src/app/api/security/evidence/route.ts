import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { generateEvidencePackage } from '@/lib/security/evidence';
import { requireRole } from '@/lib/api-auth';

export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  const auth = requireRole(request, 'admin');
  if ('error' in auth) return auth.error;

  try {
    const pkg = generateEvidencePackage();
    return NextResponse.json(pkg);
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Failed to generate evidence package' },
      { status: 500 },
    );
  }
}
