import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { listSandboxes, createSandbox } from '@/lib/sandbox';
import type { CloneOptions } from '@/lib/sandbox-clone';
import { parseJsonBody } from '@/lib/parse-json-body';
import { requireRole } from '@/lib/api-auth';

export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  const auth = await requireRole(request, 'admin');
  if ('error' in auth) return auth.error;

  try {
    const sandboxes = listSandboxes();
    return NextResponse.json({ sandboxes });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Failed to list sandboxes' },
      { status: 500 }
    );
  }
}

export async function POST(request: NextRequest) {
  const auth = await requireRole(request, 'admin');
  if ('error' in auth) return auth.error;

  try {
    const parsed = await parseJsonBody<{ name?: string; cloneOptions?: CloneOptions }>(request);
    if ('error' in parsed) return parsed.error;
    const { name, cloneOptions } = parsed.data;

    if (!name) {
      return NextResponse.json(
        { error: 'name is required' },
        { status: 400 }
      );
    }

    const sandbox = createSandbox(name, cloneOptions);
    return NextResponse.json({ sandbox }, { status: 201 });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Failed to create sandbox' },
      { status: 500 }
    );
  }
}
