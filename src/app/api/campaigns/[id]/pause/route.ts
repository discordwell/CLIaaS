import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { requireAuth } from '@/lib/api-auth';
import { pauseCampaign } from '@/lib/campaigns/orchestration';

export const dynamic = 'force-dynamic';

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const auth = await requireAuth(request);
  if ('error' in auth) return auth.error;

  const { id } = await params;
  const campaign = pauseCampaign(id, auth.user.workspaceId);

  if (!campaign) {
    return NextResponse.json({ error: 'Campaign not found or not in active state' }, { status: 400 });
  }

  return NextResponse.json({ campaign, paused: true });
}
