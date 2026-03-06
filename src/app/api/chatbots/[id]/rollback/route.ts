import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { requirePerm } from '@/lib/rbac';
import { parseJsonBody } from '@/lib/parse-json-body';
import { rollbackChatbot } from '@/lib/chatbot/versions';

export const dynamic = 'force-dynamic';

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const auth = await requirePerm(request, 'automation:edit');
  if ('error' in auth) return auth.error;

  const { id } = await params;

  const parsed = await parseJsonBody<{ version: number }>(request);
  if ('error' in parsed) return parsed.error;

  const { version } = parsed.data;
  if (!version || typeof version !== 'number') {
    return NextResponse.json({ error: 'version is required (number)' }, { status: 400 });
  }

  const flow = await rollbackChatbot(id, version);
  if (!flow) {
    return NextResponse.json({ error: 'Version not found' }, { status: 404 });
  }

  return NextResponse.json({ message: `Rolled back to version ${version}`, chatbot: flow });
}
