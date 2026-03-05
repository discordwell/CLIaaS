import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { requireAuth } from '@/lib/api-auth';
import { getCustomerActivities } from '@/lib/customers/customer-store';

export const dynamic = 'force-dynamic';

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const auth = await requireAuth(request);
  if ('error' in auth) return auth.error;

  try {
    const { id } = await params;
    const activities = getCustomerActivities(id);

    return NextResponse.json({ activities });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Failed to load timeline' },
      { status: 500 },
    );
  }
}
