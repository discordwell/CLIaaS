import { NextResponse } from 'next/server';
import { isDemoMode } from '@/lib/channels/twilio';
import { getIVRConfig, saveIVRConfig, type IVRConfig } from '@/lib/channels/voice-ivr';
import { getAllCalls, getAgents, getActiveCalls } from '@/lib/channels/voice-store';

export const dynamic = 'force-dynamic';

export async function GET() {
  const config = getIVRConfig();
  const calls = getAllCalls();
  const agents = getAgents();
  const activeCalls = getActiveCalls();

  return NextResponse.json({
    demo: isDemoMode(),
    ivrConfig: config,
    calls,
    activeCalls: activeCalls.length,
    agents,
    stats: {
      total: calls.length,
      completed: calls.filter((c) => c.status === 'completed').length,
      voicemails: calls.filter((c) => c.status === 'voicemail').length,
      active: activeCalls.length,
    },
  });
}

export async function PUT(request: Request) {
  const body = await request.json().catch(() => null);
  if (!body) {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  const config = body as IVRConfig;
  saveIVRConfig(config);
  return NextResponse.json({ ok: true, config });
}
