import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { parseJsonBody } from '@/lib/parse-json-body';
import { requireAuth } from '@/lib/api-auth';
import { listObjectTypes, createObjectType, type CustomObjectFieldDef } from '@/lib/custom-objects';

export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  const auth = await requireAuth(request);
  if ('error' in auth) return auth.error;

  const workspaceId = auth.user.workspaceId ?? 'default';
  const types = listObjectTypes(workspaceId);
  return NextResponse.json({ types });
}

export async function POST(request: NextRequest) {
  const auth = await requireAuth(request);
  if ('error' in auth) return auth.error;

  const parsed = await parseJsonBody(request);
  if ('error' in parsed) return parsed.error;
  const body = parsed.data;

  const workspaceId = auth.user.workspaceId ?? 'default';
  const { key, name, namePlural, description, icon, fields } = body;

  if (!key || !name) {
    return NextResponse.json({ error: 'key and name are required' }, { status: 400 });
  }

  try {
    const type = createObjectType({
      workspaceId,
      key: key as string,
      name: name as string,
      namePlural: (namePlural as string) ?? `${name}s`,
      description: description as string,
      icon: icon as string,
      fields: (fields as CustomObjectFieldDef[]) ?? [],
    });
    return NextResponse.json({ type }, { status: 201 });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Failed to create type' },
      { status: 400 },
    );
  }
}
