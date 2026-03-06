import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { requireAuth } from '@/lib/api-auth';
import { enrollCampaign } from '@/lib/campaigns/orchestration';
import type { EvaluableCustomer } from '@/lib/segments/evaluator';

export const dynamic = 'force-dynamic';

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const auth = await requireAuth(request);
  if ('error' in auth) return auth.error;

  const { id } = await params;

  // Load customers for segment evaluation
  let customers: EvaluableCustomer[];
  try {
    const { loadCustomers } = await import('@/lib/data');
    const rawCustomers = await loadCustomers();
    customers = rawCustomers.map((c: { id: string; email?: string; name?: string; tags?: string[] }) => ({
      id: c.id,
      email: c.email,
      name: c.name,
      tags: c.tags,
    }));
  } catch {
    customers = [];
  }

  const result = enrollCampaign(id, customers, auth.user.workspaceId);

  if (!result.campaign) {
    return NextResponse.json({ error: 'Campaign not found' }, { status: 404 });
  }

  return NextResponse.json({
    campaign: result.campaign,
    enrolled: result.enrolled,
    activated: result.campaign.status === 'active',
  });
}
