import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { listBrands, createBrand } from '@/lib/brands';
import { parseJsonBody } from '@/lib/parse-json-body';
import { requirePerm } from '@/lib/rbac';

export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  const auth = await requirePerm(request, 'admin:settings', 'admin');
  if ('error' in auth) return auth.error;

  try {
    // Scope by workspace to prevent cross-workspace data leakage
    const brands = listBrands(auth.user.workspaceId);
    return NextResponse.json({ brands });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Failed to load brands' },
      { status: 500 }
    );
  }
}

export async function POST(request: NextRequest) {
  const auth = await requirePerm(request, 'admin:settings', 'admin');
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

    // Scope by workspace to prevent cross-workspace data leakage
    const brand = createBrand({
      name,
      subdomain,
      logo: logo ?? '',
      primaryColor: primaryColor ?? '#09090b',
      portalTitle: portalTitle ?? name,
      kbEnabled: kbEnabled ?? true,
      chatEnabled: chatEnabled ?? false,
    }, auth.user.workspaceId);

    return NextResponse.json({ brand }, { status: 201 });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Failed to create brand' },
      { status: 500 }
    );
  }
}
