import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { requireAuth } from '@/lib/api-auth';
import { parseJsonBody } from '@/lib/parse-json-body';
import { getWorkflow, upsertWorkflow, deleteWorkflow } from '@/lib/workflow/store';
import { validateWorkflow } from '@/lib/workflow/decomposer';
import type { WorkflowNode, WorkflowTransition } from '@/lib/workflow/types';

export const dynamic = 'force-dynamic';

/**
 * GET /api/workflows/:id — get a workflow
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

  return NextResponse.json({ workflow });
}

/**
 * PUT /api/workflows/:id — update a workflow (full canvas save)
 */
export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const auth = await requireAuth(request);
  if ('error' in auth) return auth.error;

  const { id } = await params;
  const existing = await getWorkflow(id);
  if (!existing) {
    return NextResponse.json({ error: 'Workflow not found' }, { status: 404 });
  }

  const parsed = await parseJsonBody<{
    name?: string;
    description?: string;
    nodes?: Record<string, WorkflowNode>;
    transitions?: WorkflowTransition[];
    entryNodeId?: string;
    enabled?: boolean;
  }>(request);
  if ('error' in parsed) return parsed.error;

  const { name, description, nodes, transitions, entryNodeId, enabled } = parsed.data;

  const updated = {
    ...existing,
    name: name?.trim() ?? existing.name,
    description: description !== undefined ? description?.trim() : existing.description,
    nodes: nodes ?? existing.nodes,
    transitions: transitions ?? existing.transitions,
    entryNodeId: entryNodeId ?? existing.entryNodeId,
    enabled: enabled !== undefined ? enabled : existing.enabled,
    version: existing.version + 1,
    updatedAt: new Date().toISOString(),
  };

  // Validate if structure changed
  if (nodes || transitions || entryNodeId) {
    const validation = validateWorkflow(updated);
    if (!validation.valid) {
      return NextResponse.json(
        { error: 'Invalid workflow', details: validation.errors },
        { status: 400 },
      );
    }
  }

  await upsertWorkflow(updated);
  return NextResponse.json({ workflow: updated });
}

/**
 * DELETE /api/workflows/:id — delete a workflow
 */
export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const auth = await requireAuth(request);
  if ('error' in auth) return auth.error;

  const { id } = await params;
  const deleted = await deleteWorkflow(id);
  if (!deleted) {
    return NextResponse.json({ error: 'Workflow not found' }, { status: 404 });
  }

  return NextResponse.json({ ok: true });
}
