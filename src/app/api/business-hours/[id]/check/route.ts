import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { requirePerm } from '@/lib/rbac';
import { parseJsonBody } from '@/lib/parse-json-body';

export const dynamic = 'force-dynamic';

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requirePerm(request, 'admin:settings', 'admin');
  if ('error' in auth) return auth.error;

  const { id } = await params;
  const { getBusinessHours, isWithinBusinessHours, nextBusinessHourStart, nextBusinessHourClose, getElapsedBusinessMinutes } = await import('@/lib/wfm/business-hours');
  const configs = getBusinessHours(id);
  if (configs.length === 0) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 });
  }

  const parsed = await parseJsonBody<{ timestamp?: string; from?: string; to?: string }>(request);
  if ('error' in parsed) return parsed.error;

  const config = configs[0];
  const ts = parsed.data.timestamp ? new Date(parsed.data.timestamp) : new Date();

  const result: Record<string, unknown> = {
    scheduleId: config.id,
    scheduleName: config.name,
    timezone: config.timezone,
    checkedAt: ts.toISOString(),
    isOpen: isWithinBusinessHours(config, ts),
    nextOpen: nextBusinessHourStart(config, ts).toISOString(),
  };

  if (isWithinBusinessHours(config, ts)) {
    result.nextClose = nextBusinessHourClose(config, ts).toISOString();
  }

  if (parsed.data.from && parsed.data.to) {
    result.elapsedBusinessMinutes = getElapsedBusinessMinutes(
      config, new Date(parsed.data.from), new Date(parsed.data.to),
    );
  }

  return NextResponse.json(result);
}
