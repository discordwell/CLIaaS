import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { requirePerm } from '@/lib/rbac';
import { getCustomerActivities } from '@/lib/customers/customer-store';

export const dynamic = 'force-dynamic';

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const auth = await requirePerm(request, 'customers:view');
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
