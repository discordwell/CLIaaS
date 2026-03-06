import { NextResponse } from 'next/server';
import { getAllConnectorStatuses } from '@/lib/connector-service';

export async function GET() {
  const connectors = getAllConnectorStatuses();
  const capabilities = Object.fromEntries(
    connectors.map(c => [c.id, c.capabilities]),
  );
  return NextResponse.json(capabilities);
}
