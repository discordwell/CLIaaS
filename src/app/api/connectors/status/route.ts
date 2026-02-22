import { NextResponse } from 'next/server';
import { getAllConnectorStatuses } from '@/lib/connector-service';

export const dynamic = 'force-dynamic';

export async function GET() {
  const statuses = getAllConnectorStatuses();
  return NextResponse.json(statuses);
}
