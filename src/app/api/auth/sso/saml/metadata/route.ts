import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { generateSpMetadata } from '@/lib/auth/saml';

export const dynamic = 'force-dynamic';

/**
 * GET /api/auth/sso/saml/metadata
 *
 * Returns SAML Service Provider (SP) metadata XML.
 * IdP administrators use this URL to configure their side of the trust.
 */
export async function GET(request: NextRequest) {
  try {
    const origin = request.nextUrl.origin;
    const xml = generateSpMetadata(origin);

    return new NextResponse(xml, {
      status: 200,
      headers: {
        'Content-Type': 'application/xml; charset=utf-8',
        'Cache-Control': 'public, max-age=3600',
      },
    });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Failed to generate SP metadata' },
      { status: 500 }
    );
  }
}
