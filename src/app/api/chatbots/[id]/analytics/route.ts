import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { requirePerm } from '@/lib/rbac';
import { getFlowAnalytics } from '@/lib/chatbot/analytics';

export const dynamic = 'force-dynamic';

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const auth = await requirePerm(request, 'automation:view');
  if ('error' in auth) return auth.error;

  const { id } = await params;
  const days = Math.max(1, parseInt(request.nextUrl.searchParams.get('days') ?? '30', 10) || 30);
  const analytics = await getFlowAnalytics(id, days);

  return NextResponse.json({ analytics });
}
