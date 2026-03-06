import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { requireAuth, requireRole } from '@/lib/api-auth';
import { parseJsonBody } from '@/lib/parse-json-body';

export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  const auth = await requireAuth(request);
  if ('error' in auth) return auth.error;

  const { listPresets } = await import('@/lib/wfm/presets');
  return NextResponse.json({ presets: listPresets() });
}

export async function POST(request: NextRequest) {
  const auth = await requireRole(request, 'admin');
  if ('error' in auth) return auth.error;

  const parsed = await parseJsonBody<{
    presetId: string;
    name?: string;
    year?: number;
  }>(request);
  if ('error' in parsed) return parsed.error;

  const { presetId, name, year } = parsed.data;
  if (!presetId) {
    return NextResponse.json({ error: 'presetId is required' }, { status: 400 });
  }

  const { getPresetById, generatePresetEntries } = await import('@/lib/wfm/presets');
  const preset = getPresetById(presetId);
  if (!preset) {
    return NextResponse.json({ error: `Unknown preset: ${presetId}` }, { status: 400 });
  }

  const entries = generatePresetEntries(presetId, year);
  const { createHolidayCalendar } = await import('@/lib/wfm/holidays');
  const calendar = createHolidayCalendar({
    name: name ?? preset.name,
    description: preset.description,
    entries,
  });

  return NextResponse.json({ calendar }, { status: 201 });
}
