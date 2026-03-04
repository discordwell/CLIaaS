import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { getAllCalls, getActiveCalls } from '@/lib/channels/voice-store';
import { requireAuth } from '@/lib/api-auth';

export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  const auth = await requireAuth(request);
  if ('error' in auth) return auth.error;

  // Scope by workspace to prevent cross-workspace data leakage
  const all = getAllCalls(auth.user.workspaceId);
  const active = getActiveCalls(auth.user.workspaceId);

  return NextResponse.json({
    total: all.length,
    active: active.length,
    calls: all,
  });
}
