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
    shifts?: Array<{
      dayOfWeek: number;
      startTime: string;
      endTime: string;
      activity?: string;
      label?: string;
    }>;
  }>(request);
  if ('error' in parsed) return parsed.error;

  const { updateTemplate } = await import('@/lib/wfm/schedules');
  const template = updateTemplate(id, parsed.data);

  if (!template) {
    return NextResponse.json({ error: 'Template not found' }, { status: 404 });
  }

  return NextResponse.json({ template });
}

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const auth = await requirePerm(request, 'admin:settings', 'admin');
  if ('error' in auth) return auth.error;

  const { id } = await params;
  const { deleteTemplate } = await import('@/lib/wfm/schedules');
  const deleted = deleteTemplate(id);

  if (!deleted) {
    return NextResponse.json({ error: 'Template not found' }, { status: 404 });
  }

  return NextResponse.json({ deleted: true });
}
