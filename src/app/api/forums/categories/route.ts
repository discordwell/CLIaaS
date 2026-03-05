import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { requireAuth } from '@/lib/api-auth';
import { parseJsonBody } from '@/lib/parse-json-body';
import { getCategories, createCategory } from '@/lib/forums/forum-store';

export const dynamic = 'force-dynamic';

/**
 * GET /api/forums/categories — list all forum categories
 */
export async function GET(request: NextRequest) {
  const auth = await requireAuth(request);
  if ('error' in auth) return auth.error;

  const categories = getCategories();
  return NextResponse.json({ categories });
}

/**
 * POST /api/forums/categories — create a forum category
 */
export async function POST(request: NextRequest) {
  const auth = await requireAuth(request);
  if ('error' in auth) return auth.error;

  const parsed = await parseJsonBody<{
    name?: string;
    description?: string;
    slug?: string;
    position?: number;
  }>(request);
  if ('error' in parsed) return parsed.error;

  const { name, description, slug, position } = parsed.data;

  if (!name?.trim()) {
    return NextResponse.json({ error: 'name is required' }, { status: 400 });
  }

  if (!slug?.trim()) {
    return NextResponse.json({ error: 'slug is required' }, { status: 400 });
  }

  const category = createCategory({
    name: name.trim(),
    description: description?.trim(),
    slug: slug.trim(),
    position: position ?? 0,
    workspaceId: auth.user.workspaceId,
  });

  return NextResponse.json({ category }, { status: 201 });
}
