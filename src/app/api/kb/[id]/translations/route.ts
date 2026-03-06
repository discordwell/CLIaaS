import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { parseJsonBody } from '@/lib/parse-json-body';
import { requirePerm } from '@/lib/rbac';

export const dynamic = 'force-dynamic';

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const auth = await requirePerm(request, 'kb:view');
  if ('error' in auth) return auth.error;

  try {
    const { id } = await params;

    if (!process.env.DATABASE_URL) {
      return NextResponse.json({ translations: [] });
    }

    const { db } = await import('@/db');
    const schema = await import('@/db/schema');
    const { eq, and } = await import('drizzle-orm');

    // Verify parent article exists and belongs to workspace
    const [parent] = await db
      .select({ id: schema.kbArticles.id })
      .from(schema.kbArticles)
      .where(and(eq(schema.kbArticles.id, id), eq(schema.kbArticles.workspaceId, auth.user.workspaceId)))
      .limit(1);

    if (!parent) {
      return NextResponse.json({ error: 'Article not found' }, { status: 404 });
    }

    const rows = await db
      .select({
        id: schema.kbArticles.id,
        title: schema.kbArticles.title,
        body: schema.kbArticles.body,
        categoryPath: schema.kbArticles.categoryPath,
        status: schema.kbArticles.status,
        updatedAt: schema.kbArticles.updatedAt,
        locale: schema.kbArticles.locale,
        slug: schema.kbArticles.slug,
        visibility: schema.kbArticles.visibility,
        createdAt: schema.kbArticles.createdAt,
      })
      .from(schema.kbArticles)
      .where(and(
        eq(schema.kbArticles.workspaceId, auth.user.workspaceId),
        eq(schema.kbArticles.parentArticleId, id),
      ));

    const translations = rows.map(r => ({
      id: r.id,
      title: r.title,
      body: r.body,
      categoryPath: r.categoryPath ?? [],
      status: r.status,
      updatedAt: r.updatedAt?.toISOString(),
      locale: r.locale ?? 'en',
      slug: r.slug ?? undefined,
      visibility: r.visibility ?? 'public',
      createdAt: r.createdAt?.toISOString(),
    }));

    return NextResponse.json({ translations, total: translations.length });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Failed to load translations' },
      { status: 500 }
    );
  }
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const auth = await requirePerm(request, 'kb:edit');
  if ('error' in auth) return auth.error;

  try {
    const { id } = await params;

    if (!process.env.DATABASE_URL) {
      return NextResponse.json(
        { error: 'Database not configured. Translations require a database.' },
        { status: 503 }
      );
    }

    const parsed = await parseJsonBody<{
      title?: string;
      body?: string;
      locale?: string;
      slug?: string;
      metaTitle?: string;
      metaDescription?: string;
      categoryPath?: string[];
      status?: string;
      visibility?: string;
    }>(request);
    if ('error' in parsed) return parsed.error;
    const d = parsed.data;

    if (!d.title?.trim() || !d.body?.trim() || !d.locale?.trim()) {
      return NextResponse.json(
        { error: 'title, body, and locale are required' },
        { status: 400 }
      );
    }

    const { db } = await import('@/db');
    const schema = await import('@/db/schema');
    const { eq, and } = await import('drizzle-orm');

    // Verify parent exists
    const [parent] = await db
      .select({ id: schema.kbArticles.id, workspaceId: schema.kbArticles.workspaceId })
      .from(schema.kbArticles)
      .where(and(eq(schema.kbArticles.id, id), eq(schema.kbArticles.workspaceId, auth.user.workspaceId)))
      .limit(1);

    if (!parent) {
      return NextResponse.json({ error: 'Parent article not found' }, { status: 404 });
    }

    const [row] = await db
      .insert(schema.kbArticles)
      .values({
        workspaceId: auth.user.workspaceId,
        parentArticleId: id,
        locale: d.locale,
        title: d.title.trim(),
        body: d.body.trim(),
        categoryPath: d.categoryPath ?? [],
        status: d.status ?? 'published',
        visibility: d.visibility ?? 'public',
        slug: d.slug,
        metaTitle: d.metaTitle,
        metaDescription: d.metaDescription,
      })
      .returning({ id: schema.kbArticles.id });

    return NextResponse.json({ translation: { id: row.id, locale: d.locale } }, { status: 201 });
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Failed to create translation';
    // Unique constraint violation = duplicate locale
    if (msg.includes('kb_articles_translation_unique_idx')) {
      return NextResponse.json(
        { error: 'A translation for this locale already exists' },
        { status: 409 }
      );
    }
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
