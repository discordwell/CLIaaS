import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { diffSandboxById } from '@/lib/sandbox';

export const dynamic = 'force-dynamic';

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const diff = diffSandboxById(id);
  if (!diff) {
    return NextResponse.json({ error: 'Sandbox not found or not active' }, { status: 404 });
  }
  return NextResponse.json({ diff });
}
