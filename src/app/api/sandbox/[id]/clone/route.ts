import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { getSandbox } from '@/lib/sandbox';
import { cloneToSandbox, type CloneOptions } from '@/lib/sandbox-clone';

export const dynamic = 'force-dynamic';

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const sandbox = getSandbox(id);
  if (!sandbox) {
    return NextResponse.json({ error: 'Sandbox not found' }, { status: 404 });
  }

  const body = await request.json().catch(() => ({}));
  const options = body as CloneOptions;

  const manifest = cloneToSandbox(id, options);
  return NextResponse.json({ ok: true, manifest });
}
