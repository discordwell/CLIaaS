import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { requirePerm } from '@/lib/rbac';
import { parseJsonBody } from '@/lib/parse-json-body';
import { getCannedResponses, createCannedResponse } from '@/lib/canned/canned-store';

export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  const auth = await requirePerm(request, 'tickets:view');
  if ('error' in auth) return auth.error;

  try {
    const url = new URL(request.url);
    const category = url.searchParams.get('category') ?? undefined;
    const rawScope = url.searchParams.get('scope');
    const scope = rawScope === 'personal' || rawScope === 'shared' ? rawScope : undefined;
    const search = url.searchParams.get('search') ?? undefined;

    if (process.env.DATABASE_URL) {
      const { db } = await import('@/db');
      const schema = await import('@/db/schema');
      const { eq, and, ilike, or, desc } = await import('drizzle-orm');

      const conditions = [eq(schema.cannedResponses.workspaceId, auth.user.workspaceId)];
      if (category) conditions.push(eq(schema.cannedResponses.category, category));
      if (scope) conditions.push(eq(schema.cannedResponses.scope, scope));

      if (search) {
        const escaped = search.replace(/[%_\\]/g, '\\$&');
        const rows = await db.select().from(schema.cannedResponses)
          .where(and(
            ...conditions,
            or(
              ilike(schema.cannedResponses.title, `%${escaped}%`),
              ilike(schema.cannedResponses.body, `%${escaped}%`),
            ),
          ))
          .orderBy(desc(schema.cannedResponses.usageCount));
        return NextResponse.json({ cannedResponses: rows });
      }

      const rows = await db.select().from(schema.cannedResponses).where(and(...conditions))
        .orderBy(desc(schema.cannedResponses.usageCount));
      return NextResponse.json({ cannedResponses: rows });
    }

    const responses = getCannedResponses({ category, scope, search });
    return NextResponse.json({ cannedResponses: responses });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Failed to load canned responses' },
      { status: 500 },
    );
  }
}

export async function POST(request: NextRequest) {
  const auth = await requirePerm(request, 'tickets:view');
  if ('error' in auth) return auth.error;

  const parsed = await parseJsonBody<{
    title: string;
    body: string;
    category?: string;
    scope?: 'personal' | 'shared';
    shortcut?: string;
  }>(request);
  if ('error' in parsed) return parsed.error;

  const { title, body, category, scope, shortcut } = parsed.data;
  if (!title?.trim() || !body?.trim()) {
    return NextResponse.json({ error: 'title and body are required' }, { status: 400 });
  }

  try {
    if (process.env.DATABASE_URL) {
      const { db } = await import('@/db');
      const schema = await import('@/db/schema');

      const [row] = await db.insert(schema.cannedResponses).values({
        workspaceId: auth.user.workspaceId,
        createdBy: auth.user.id,
        title,
        body,
        category,
        scope: scope ?? 'personal',
        shortcut,
      }).returning();

      return NextResponse.json({ cannedResponse: row }, { status: 201 });
    }

    const cr = createCannedResponse({ title, body, category, scope, shortcut, createdBy: auth.user.id });
    return NextResponse.json({ cannedResponse: cr }, { status: 201 });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Failed to create canned response' },
      { status: 500 },
    );
  }
}
