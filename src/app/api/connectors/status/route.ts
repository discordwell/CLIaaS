import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { getAllConnectorStatuses } from '@/lib/connector-service';
import { requirePerm } from '@/lib/rbac';

export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  const auth = await requirePerm(request, 'admin:settings', 'admin');
  if ('error' in auth) return auth.error;

  const statuses = getAllConnectorStatuses();
  return NextResponse.json(statuses);
}
