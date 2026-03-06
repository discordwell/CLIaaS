import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { requirePerm } from '@/lib/rbac';
import { parseJsonBody } from '@/lib/parse-json-body';
import { getSignatures, createSignature } from '@/lib/canned/signature-store';

export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  const auth = await requirePerm(request, 'tickets:view');
  if ('error' in auth) return auth.error;

  try {
    const url = new URL(request.url);
    const userId = url.searchParams.get('user') === 'me' ? auth.user.id : url.searchParams.get('user') ?? undefined;

    if (process.env.DATABASE_URL) {
      const { db } = await import('@/db');
      const schema = await import('@/db/schema');
      const { eq, and, desc } = await import('drizzle-orm');

      const conditions = [eq(schema.agentSignatures.workspaceId, auth.user.workspaceId)];
      if (userId) conditions.push(eq(schema.agentSignatures.userId, userId));

      const rows = await db.select().from(schema.agentSignatures)
        .where(and(...conditions))
        .orderBy(desc(schema.agentSignatures.isDefault));

      return NextResponse.json({ signatures: rows });
    }

    const sigs = await getSignatures({ userId });
    return NextResponse.json({ signatures: sigs });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : 'Failed' }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  const auth = await requirePerm(request, 'tickets:view');
  if ('error' in auth) return auth.error;

  const parsed = await parseJsonBody<{
    name: string;
    bodyHtml: string;
    bodyText: string;
    isDefault?: boolean;
  }>(request);
  if ('error' in parsed) return parsed.error;

  const { name, bodyHtml, bodyText, isDefault } = parsed.data;
  if (!name?.trim() || !bodyText?.trim()) {
    return NextResponse.json({ error: 'name and bodyText are required' }, { status: 400 });
  }

  try {
    if (process.env.DATABASE_URL) {
      const { db } = await import('@/db');
      const schema = await import('@/db/schema');
      const { eq, and } = await import('drizzle-orm');

      // Clear existing default if setting new one
      if (isDefault) {
        await db.update(schema.agentSignatures)
          .set({ isDefault: false })
          .where(and(
            eq(schema.agentSignatures.workspaceId, auth.user.workspaceId),
            eq(schema.agentSignatures.userId, auth.user.id),
            eq(schema.agentSignatures.isDefault, true),
          ));
      }

      const [row] = await db.insert(schema.agentSignatures).values({
        workspaceId: auth.user.workspaceId,
        userId: auth.user.id,
        name,
        bodyHtml: bodyHtml ?? bodyText,
        bodyText,
        isDefault: isDefault ?? false,
      }).returning();

      return NextResponse.json({ signature: row }, { status: 201 });
    }

    const sig = createSignature({ name, bodyHtml: bodyHtml ?? bodyText, bodyText, isDefault, userId: auth.user.id });
    return NextResponse.json({ signature: sig }, { status: 201 });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : 'Failed' }, { status: 500 });
  }
}
