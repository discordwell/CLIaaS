import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { listBrands, createBrand } from '@/lib/brands';
import { parseJsonBody } from '@/lib/parse-json-body';
import { requireRole } from '@/lib/api-auth';

export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  const auth = await requireRole(request, 'admin');
  if ('error' in auth) return auth.error;

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
  const auth = await requireRole(request, 'admin');
  if ('error' in auth) return auth.error;

  const parsed = await parseJsonBody(request);
  if ('error' in parsed) return parsed.error;

  try {
    const { name, subdomain, logo, primaryColor, portalTitle, kbEnabled, chatEnabled } = parsed.data;

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
