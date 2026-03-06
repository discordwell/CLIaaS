import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { listBrands, updateBrand, deleteBrand } from '@/lib/brands';
import { parseJsonBody } from '@/lib/parse-json-body';
import { requirePerm } from '@/lib/rbac';

export const dynamic = 'force-dynamic';

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const auth = await requirePerm(request, 'admin:settings', 'admin');
  if ('error' in auth) return auth.error;

  const { id } = await params;
  // Scope by workspace to prevent cross-workspace data leakage
  const brands = listBrands(auth.user.workspaceId);
  const brand = brands.find((b) => b.id === id);
  if (!brand) {
    return NextResponse.json({ error: 'Brand not found' }, { status: 404 });
  }
  return NextResponse.json({ brand });
}

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const auth = await requirePerm(request, 'admin:settings', 'admin');
  if ('error' in auth) return auth.error;

  const { id } = await params;
  const parsed = await parseJsonBody(request);
  if ('error' in parsed) return parsed.error;
  // Scope by workspace to prevent cross-workspace modification
  const brand = updateBrand(id, parsed.data, auth.user.workspaceId);
  if (!brand) {
    return NextResponse.json({ error: 'Brand not found' }, { status: 404 });
  }
  return NextResponse.json({ brand });
}

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const auth = await requirePerm(request, 'admin:settings', 'admin');
  if ('error' in auth) return auth.error;

  const { id } = await params;
  // Scope by workspace to prevent cross-workspace deletion
  const deleted = deleteBrand(id, auth.user.workspaceId);
  if (!deleted) {
    return NextResponse.json({ error: 'Brand not found' }, { status: 404 });
  }
  return NextResponse.json({ ok: true });
}
