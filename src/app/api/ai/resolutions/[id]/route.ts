import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { requireScope } from '@/lib/api-auth';
import { getResolution } from '@/lib/ai/store';

export const dynamic = 'force-dynamic';

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const auth = await requireScope(request, 'ai:read');
  if ('error' in auth) return auth.error;

  const { id } = await params;
  const resolution = await getResolution(id);
  if (!resolution || resolution.workspaceId !== auth.user.workspaceId) {
    return NextResponse.json({ error: 'Resolution not found' }, { status: 404 });
  }

  return NextResponse.json({ resolution });
}
