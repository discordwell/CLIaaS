import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { listBrands, updateBrand, deleteBrand } from '@/lib/brands';
import { parseJsonBody } from '@/lib/parse-json-body';

export const dynamic = 'force-dynamic';

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const brands = listBrands();
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
  const { id } = await params;
  const parsed = await parseJsonBody(request);
  if ('error' in parsed) return parsed.error;
  const brand = updateBrand(id, parsed.data);
  if (!brand) {
    return NextResponse.json({ error: 'Brand not found' }, { status: 404 });
  }
  return NextResponse.json({ brand });
}

export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const deleted = deleteBrand(id);
  if (!deleted) {
    return NextResponse.json({ error: 'Brand not found' }, { status: 404 });
  }
  return NextResponse.json({ ok: true });
}
