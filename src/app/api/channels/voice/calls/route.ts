import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { getAllCalls, getActiveCalls } from '@/lib/channels/voice-store';
import { requireAuth } from '@/lib/api-auth';

export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  const auth = await requireAuth(request);
  if ('error' in auth) return auth.error;

  const all = getAllCalls();
  const active = getActiveCalls();

  return NextResponse.json({
    total: all.length,
    active: active.length,
    calls: all,
  });
}
