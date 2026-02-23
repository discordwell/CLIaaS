import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { listSandboxes, createSandbox } from '@/lib/sandbox';
import type { CloneOptions } from '@/lib/sandbox-clone';

export const dynamic = 'force-dynamic';

export async function GET() {
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
  try {
    const body = await request.json().catch(() => ({} as Record<string, unknown>));
    const { name, cloneOptions } = body as { name?: string; cloneOptions?: CloneOptions };

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
