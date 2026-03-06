import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { requireAuth } from '@/lib/api-auth';
import { parseJsonBody } from '@/lib/parse-json-body';

export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  const auth = await requireAuth(request);
  if ('error' in auth) return auth.error;

  const { getBusinessHours } = await import('@/lib/wfm/business-hours');
  const configs = getBusinessHours();

  return NextResponse.json({ businessHours: configs, total: configs.length });
}

export async function POST(request: NextRequest) {
  const auth = await requireAuth(request);
  if ('error' in auth) return auth.error;

  const parsed = await parseJsonBody<{
    name: string;
    timezone?: string;
    schedule: Record<string, Array<{ start: string; end: string }>>;
    holidays?: string[];
    isDefault?: boolean;
  }>(request);
  if ('error' in parsed) return parsed.error;

  const { name, timezone, schedule, holidays, isDefault } = parsed.data;

  if (!name || !schedule) {
    return NextResponse.json({ error: 'name and schedule are required' }, { status: 400 });
  }

  const { createBusinessHours } = await import('@/lib/wfm/business-hours');
  const config = createBusinessHours({
    name,
    timezone: timezone ?? 'UTC',
    schedule,
    holidays: holidays ?? [],
    isDefault: isDefault ?? false,
  });

  return NextResponse.json({ businessHours: config }, { status: 201 });
}
