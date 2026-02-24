import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { diffSandboxById } from '@/lib/sandbox';
import { requireRole } from '@/lib/api-auth';

export const dynamic = 'force-dynamic';

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const auth = await requireRole(request, 'admin');
  if ('error' in auth) return auth.error;

  const { id } = await params;
  const diff = diffSandboxById(id);
  if (!diff) {
    return NextResponse.json({ error: 'Sandbox not found or not active' }, { status: 404 });
  }
  return NextResponse.json({ diff });
}
