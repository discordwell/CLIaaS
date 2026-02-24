import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { isDemoMode } from '@/lib/channels/twilio';
import { getIVRConfig, saveIVRConfig, type IVRConfig } from '@/lib/channels/voice-ivr';
import { getAllCalls, getAgents, getActiveCalls } from '@/lib/channels/voice-store';
import { parseJsonBody } from '@/lib/parse-json-body';
import { requireAuth } from '@/lib/api-auth';

export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  const auth = await requireAuth(request);
  if ('error' in auth) return auth.error;

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

export async function PUT(request: NextRequest) {
  const auth = await requireAuth(request);
  if ('error' in auth) return auth.error;

  const parsed = await parseJsonBody<Record<string, unknown>>(request);
  if ('error' in parsed) return parsed.error;
  const body = parsed.data;

  // Validate required IVRConfig fields
  if (typeof body.enabled !== 'boolean' || typeof body.mainMenuId !== 'string' || !Array.isArray(body.menus)) {
    return NextResponse.json(
      { error: 'Invalid IVR config: enabled (boolean), mainMenuId (string), and menus (array) are required' },
      { status: 400 },
    );
  }

  const config = body as unknown as IVRConfig;
  saveIVRConfig(config);
  return NextResponse.json({ ok: true, config });
}
