import { NextRequest, NextResponse } from 'next/server';
import { availability } from '@/lib/routing/availability';
import { requirePerm } from '@/lib/rbac';

export async function GET(request: NextRequest) {
  const auth = await requirePerm(request, 'tickets:view');
  if ('error' in auth) return auth.error;

  return NextResponse.json(availability.getAllAvailability());
}
