import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { requireAuth } from '@/lib/api-auth';
import { getWorkflow, upsertWorkflow } from '@/lib/workflow/store';
import { optimizeWorkflow } from '@/lib/workflow/optimizer';
import { syncSingleWorkflow } from '@/lib/workflow/sync';

export const dynamic = 'force-dynamic';

/**
 * POST /api/workflows/:id/optimize — run deterministic optimizer
 *
 * Query params:
 *   ?dryRun=true — return changes without saving
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const auth = await requireAuth(request);
  if ('error' in auth) return auth.error;

  const { id } = await params;
  const workflow = await getWorkflow(id);
  if (!workflow) {
    return NextResponse.json({ error: 'Workflow not found' }, { status: 404 });
  }

  const dryRun = request.nextUrl.searchParams.get('dryRun') === 'true';
  const { workflow: optimized, changes } = optimizeWorkflow(workflow);

  if (changes.length === 0) {
    return NextResponse.json({
      workflow,
      changes: [],
      message: 'Workflow is already optimized',
    });
  }

  if (dryRun) {
    return NextResponse.json({ workflow: optimized, changes, dryRun: true });
  }

  await upsertWorkflow(optimized);

  // Sync updated rules into the automation engine
  if (optimized.enabled) {
    await syncSingleWorkflow(id, true);
  }

  return NextResponse.json({ workflow: optimized, changes });
}
