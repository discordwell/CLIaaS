import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { requireAuth } from '@/lib/api-auth';
import { getWorkflow } from '@/lib/workflow/store';
import { decomposeWorkflowToRules } from '@/lib/workflow/decomposer';
import type { WorkflowExport } from '@/lib/workflow/types';

export const dynamic = 'force-dynamic';

/**
 * GET /api/workflows/:id/export — export workflow as rules-as-code JSON
 */
export async function GET(
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

  const rules = decomposeWorkflowToRules(workflow);

  const exportData: WorkflowExport = {
    format: 'cliaas-workflow-v1',
    workflow,
    exportedAt: new Date().toISOString(),
    rules,
  };

  return NextResponse.json(exportData);
}
