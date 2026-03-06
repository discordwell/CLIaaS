import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { requireAuth } from '@/lib/api-auth';
import { parseJsonBody } from '@/lib/parse-json-body';
import { getMacros, createMacro, type MacroAction } from '@/lib/canned/macro-store';

export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  const auth = await requireAuth(request);
  if ('error' in auth) return auth.error;

  try {
    const url = new URL(request.url);
    const scope = url.searchParams.get('scope') as 'personal' | 'shared' | null;
    const enabled = url.searchParams.get('enabled');

    // Try DB first
    if (process.env.DATABASE_URL) {
      const { db } = await import('@/db');
      const schema = await import('@/db/schema');
      const { eq, and } = await import('drizzle-orm');

      const conditions = [eq(schema.nativeMacros.workspaceId, auth.user.workspaceId)];
      if (scope) conditions.push(eq(schema.nativeMacros.scope, scope));
      if (enabled !== null) conditions.push(eq(schema.nativeMacros.enabled, enabled !== 'false'));

      const rows = await db
        .select()
        .from(schema.nativeMacros)
        .where(and(...conditions))
        .orderBy(schema.nativeMacros.position, schema.nativeMacros.name);

      return NextResponse.json({ macros: rows });
    }

    // JSONL fallback
    const macros = getMacros({
      scope: scope ?? undefined,
      enabled: enabled !== null ? enabled !== 'false' : undefined,
    });
    return NextResponse.json({ macros });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Failed to load macros' },
      { status: 500 },
    );
  }
}

export async function POST(request: NextRequest) {
  const auth = await requireAuth(request);
  if ('error' in auth) return auth.error;

  const parsed = await parseJsonBody<{
    name: string;
    description?: string;
    actions: Array<{ type: string; value?: string; field?: string }>;
    scope?: 'personal' | 'shared';
  }>(request);
  if ('error' in parsed) return parsed.error;

  const { name, description, actions, scope } = parsed.data;
  if (!name?.trim()) {
    return NextResponse.json({ error: 'name is required' }, { status: 400 });
  }
  if (!Array.isArray(actions) || actions.length === 0) {
    return NextResponse.json({ error: 'actions array is required' }, { status: 400 });
  }

  try {
    if (process.env.DATABASE_URL) {
      const { db } = await import('@/db');
      const schema = await import('@/db/schema');

      const [row] = await db.insert(schema.nativeMacros).values({
        workspaceId: auth.user.workspaceId,
        createdBy: auth.user.id,
        name,
        description,
        actions,
        scope: scope ?? 'shared',
      }).returning();

      return NextResponse.json({ macro: row }, { status: 201 });
    }

    const macro = createMacro({ name, description, actions: actions as MacroAction[], scope, createdBy: auth.user.id });
    return NextResponse.json({ macro }, { status: 201 });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Failed to create macro' },
      { status: 500 },
    );
  }
}
