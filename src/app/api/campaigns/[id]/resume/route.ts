import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { requirePerm } from '@/lib/rbac';
import { resumeCampaign } from '@/lib/campaigns/orchestration';

export const dynamic = 'force-dynamic';

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const auth = await requirePerm(request, 'automation:edit');
  if ('error' in auth) return auth.error;

  const { id } = await params;
  const campaign = await resumeCampaign(id, auth.user.workspaceId);

  if (!campaign) {
    return NextResponse.json({ error: 'Campaign not found or not in paused state' }, { status: 400 });
  }

  return NextResponse.json({ campaign, resumed: true });
}
