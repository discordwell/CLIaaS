import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { requirePerm } from '@/lib/rbac';
import { parseJsonBody } from '@/lib/parse-json-body';

export const dynamic = 'force-dynamic';

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const auth = await requirePerm(request, 'admin:settings', 'admin');
  if ('error' in auth) return auth.error;

  const { id } = await params;
  const parsed = await parseJsonBody<{
    name?: string;
    timezone?: string;
    schedule?: Record<string, Array<{ start: string; end: string }>>;
    holidays?: string[];
    isDefault?: boolean;
  }>(request);
  if ('error' in parsed) return parsed.error;

  const { updateBusinessHours } = await import('@/lib/wfm/business-hours');
  const config = updateBusinessHours(id, parsed.data);

  if (!config) {
    return NextResponse.json({ error: 'Business hours config not found' }, { status: 404 });
  }

  return NextResponse.json({ businessHours: config });
}

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const auth = await requirePerm(request, 'admin:settings', 'admin');
  if ('error' in auth) return auth.error;

  const { id } = await params;
  const { deleteBusinessHours } = await import('@/lib/wfm/business-hours');
  const deleted = deleteBusinessHours(id);

  if (!deleted) {
    return NextResponse.json({ error: 'Business hours config not found' }, { status: 404 });
  }

  return NextResponse.json({ deleted: true });
}
