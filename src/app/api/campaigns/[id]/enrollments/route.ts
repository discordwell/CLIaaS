import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { requireAuth } from '@/lib/api-auth';
import { getEnrollments } from '@/lib/campaigns/campaign-store';

export const dynamic = 'force-dynamic';

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const auth = await requireAuth(request);
  if ('error' in auth) return auth.error;

  const { id } = await params;
  const enrollments = getEnrollments(id, auth.user.workspaceId);
  return NextResponse.json({ enrollments, total: enrollments.length });
}
