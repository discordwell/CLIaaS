import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { getAllConnectorStatuses } from '@/lib/connector-service';
import { requireRole } from '@/lib/api-auth';

export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  const auth = await requireRole(request, 'admin');
  if ('error' in auth) return auth.error;

  const statuses = getAllConnectorStatuses();
  return NextResponse.json(statuses);
}
