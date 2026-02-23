import { NextResponse } from 'next/server';
import { generateEvidencePackage } from '@/lib/security/evidence';

export const dynamic = 'force-dynamic';

export async function GET() {
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
