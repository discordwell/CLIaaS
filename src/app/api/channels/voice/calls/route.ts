import { NextResponse } from 'next/server';
import { getAllCalls, getActiveCalls } from '@/lib/channels/voice-store';

export const dynamic = 'force-dynamic';

export async function GET() {
  const all = getAllCalls();
  const active = getActiveCalls();

  return NextResponse.json({
    total: all.length,
    active: active.length,
    calls: all,
  });
}
