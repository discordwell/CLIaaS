import { NextResponse } from 'next/server';
import { generateEvidencePackage } from '@/lib/security/evidence';

export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    const pkg = generateEvidencePackage();
    return NextResponse.json({
      controls: pkg.controls,
      summary: pkg.summary,
    });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Failed to list SOC 2 controls' },
      { status: 500 },
    );
  }
}
