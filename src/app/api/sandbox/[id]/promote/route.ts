import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { promoteSandbox } from '@/lib/sandbox';
import { requireRole } from '@/lib/api-auth';
import { parseJsonBody } from '@/lib/parse-json-body';

export const dynamic = 'force-dynamic';

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const auth = requireRole(request, 'admin');
  if ('error' in auth) return auth.error;

  const { id } = await params;
  const parsed = await parseJsonBody<{ selectedEntryIds?: string[] }>(request);
  if ('error' in parsed) return parsed.error;
  const { selectedEntryIds } = parsed.data;

  const result = promoteSandbox(id, selectedEntryIds);
  if (!result) {
    return NextResponse.json({ error: 'Sandbox not found' }, { status: 404 });
  }

  return NextResponse.json({
    sandbox: result.sandbox,
    promoted: true,
    applied: result.applied,
    errors: result.errors,
  });
}
