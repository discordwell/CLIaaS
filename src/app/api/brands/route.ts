import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { listBrands, createBrand } from '@/lib/brands';

export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    const brands = listBrands();
    return NextResponse.json({ brands });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Failed to load brands' },
      { status: 500 }
    );
  }
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { name, subdomain, logo, primaryColor, portalTitle, kbEnabled, chatEnabled } = body;

    if (!name || !subdomain) {
      return NextResponse.json(
        { error: 'Name and subdomain are required' },
        { status: 400 }
      );
    }

    const brand = createBrand({
      name,
      subdomain,
      logo: logo ?? '',
      primaryColor: primaryColor ?? '#09090b',
      portalTitle: portalTitle ?? name,
      kbEnabled: kbEnabled ?? true,
      chatEnabled: chatEnabled ?? false,
    });

    return NextResponse.json({ brand }, { status: 201 });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Failed to create brand' },
      { status: 500 }
    );
  }
}
