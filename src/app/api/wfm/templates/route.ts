import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { requireAuth } from '@/lib/api-auth';
import { parseJsonBody } from '@/lib/parse-json-body';

export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  const auth = await requireAuth(request);
  if ('error' in auth) return auth.error;

  const { getTemplates } = await import('@/lib/wfm/schedules');
  const templates = getTemplates();

  return NextResponse.json({ templates, total: templates.length });
}

export async function POST(request: NextRequest) {
  const auth = await requireAuth(request);
  if ('error' in auth) return auth.error;

  const parsed = await parseJsonBody<{
    name: string;
    shifts: Array<{
      dayOfWeek: number;
      startTime: string;
      endTime: string;
      activity?: string;
      label?: string;
    }>;
  }>(request);
  if ('error' in parsed) return parsed.error;

  const { name, shifts } = parsed.data;

  if (!name || !shifts) {
    return NextResponse.json({ error: 'name and shifts are required' }, { status: 400 });
  }

  const { createTemplate } = await import('@/lib/wfm/schedules');
  const template = createTemplate({ name, shifts });

  return NextResponse.json({ template }, { status: 201 });
}
