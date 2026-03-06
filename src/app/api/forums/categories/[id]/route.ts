import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { requirePerm } from '@/lib/rbac';
import { parseJsonBody } from '@/lib/parse-json-body';
import { updateCategory, deleteCategory } from '@/lib/forums/forum-store';

export const dynamic = 'force-dynamic';

/**
 * PATCH /api/forums/categories/:id — update a forum category
 */
export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const auth = await requirePerm(request, 'forums:moderate');
  if ('error' in auth) return auth.error;

  const { id } = await params;

  const parsed = await parseJsonBody<{
    name?: string;
    description?: string;
    slug?: string;
    position?: number;
  }>(request);
  if ('error' in parsed) return parsed.error;

  const updated = updateCategory(id, parsed.data);
  if (!updated) {
    return NextResponse.json({ error: 'Category not found' }, { status: 404 });
  }

  return NextResponse.json({ category: updated });
}

/**
 * DELETE /api/forums/categories/:id — delete a forum category
 */
export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const auth = await requirePerm(request, 'forums:moderate');
  if ('error' in auth) return auth.error;

  const { id } = await params;
  const deleted = deleteCategory(id);
  if (!deleted) {
    return NextResponse.json({ error: 'Category not found' }, { status: 404 });
  }

  return NextResponse.json({ ok: true });
}
