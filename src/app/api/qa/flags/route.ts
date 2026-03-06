import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { requireAuth } from '@/lib/api-auth';
import { getFlags } from '@/lib/qa/qa-flags-store';

export const dynamic = 'force-dynamic';

/**
 * GET /api/qa/flags — list QA flags (spotlight)
 */
export async function GET(request: NextRequest) {
  const auth = await requireAuth(request);
  if ('error' in auth) return auth.error;

  const wsId = auth.user.workspaceId ?? 'default';
  const severity = request.nextUrl.searchParams.get('severity') ?? undefined;
  const dismissed = request.nextUrl.searchParams.get('dismissed');
  const ticketId = request.nextUrl.searchParams.get('ticketId') ?? undefined;

  const flags = getFlags({
    workspaceId: wsId,
    severity,
    dismissed: dismissed !== null ? dismissed === 'true' : undefined,
    ticketId,
  });

  return NextResponse.json({ flags, total: flags.length });
}
