import { NextResponse } from 'next/server';
import { verifyChainIntegrity } from '@/lib/security/audit-log';

export const dynamic = 'force-dynamic';

export async function POST() {
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
