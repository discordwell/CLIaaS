import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { requireAuth, requireRole } from '@/lib/api-auth';
import { parseJsonBody } from '@/lib/parse-json-body';

export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireAuth(request);
  if ('error' in auth) return auth.error;

  const { id } = await params;
  const { getBusinessHours } = await import('@/lib/wfm/business-hours');
  const configs = getBusinessHours(id);
  if (configs.length === 0) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 });
  }
  return NextResponse.json({ businessHours: configs[0] });
}

export async function PATCH(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireRole(request, 'admin');
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

  // Validate timezone if provided
  if (parsed.data.timezone) {
    try { Intl.DateTimeFormat(undefined, { timeZone: parsed.data.timezone }); } catch {
      return NextResponse.json({ error: `Invalid timezone: ${parsed.data.timezone}` }, { status: 400 });
    }
  }

  // Validate time strings if schedule provided
  if (parsed.data.schedule) {
    const timeRe = /^([01]\d|2[0-3]):[0-5]\d$/;
    for (const [, windows] of Object.entries(parsed.data.schedule)) {
      for (const w of windows) {
        if (!timeRe.test(w.start) || !timeRe.test(w.end)) {
          return NextResponse.json({ error: `Invalid time format: ${w.start}-${w.end}. Use HH:MM (00:00-23:59)` }, { status: 400 });
        }
      }
    }
  }

  const { updateBusinessHours } = await import('@/lib/wfm/business-hours');
  const updated = updateBusinessHours(id, parsed.data);
  if (!updated) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 });
  }
  return NextResponse.json({ businessHours: updated });
}

export async function DELETE(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireRole(request, 'admin');
  if ('error' in auth) return auth.error;

  const { id } = await params;
  const { deleteBusinessHours } = await import('@/lib/wfm/business-hours');
  const deleted = deleteBusinessHours(id);
  if (!deleted) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 });
  }
  return NextResponse.json({ deleted: true });
}
