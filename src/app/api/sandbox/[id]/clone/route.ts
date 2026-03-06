import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { getSandbox } from '@/lib/sandbox';
import { cloneToSandbox, type CloneOptions } from '@/lib/sandbox-clone';
import { parseJsonBody } from '@/lib/parse-json-body';
import { requirePerm } from '@/lib/rbac';

export const dynamic = 'force-dynamic';

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const auth = await requirePerm(request, 'admin:settings', 'admin');
  if ('error' in auth) return auth.error;

  const { id } = await params;
  const sandbox = getSandbox(id);
  if (!sandbox) {
    return NextResponse.json({ error: 'Sandbox not found' }, { status: 404 });
  }

  const parsed = await parseJsonBody<CloneOptions>(request);
  if ('error' in parsed) return parsed.error;
  const options = parsed.data;

  const manifest = cloneToSandbox(id, options);
  return NextResponse.json({ ok: true, manifest });
}
