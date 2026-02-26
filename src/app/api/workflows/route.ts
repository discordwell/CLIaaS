import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { requireAuth } from '@/lib/api-auth';
import { parseJsonBody } from '@/lib/parse-json-body';
import { getWorkflows, upsertWorkflow } from '@/lib/workflow/store';
import { validateWorkflow } from '@/lib/workflow/decomposer';
import { simpleLifecycle, escalationPipeline, slaDriven, workflowTemplates } from '@/lib/workflow/templates';
import type { Workflow, WorkflowNode, WorkflowTransition } from '@/lib/workflow/types';

export const dynamic = 'force-dynamic';

// Stable demo workflows with deterministic IDs so they can be edited
let cachedDemos: Workflow[] | null = null;
function getDemoWorkflows(): Workflow[] {
  if (!cachedDemos) {
    cachedDemos = [simpleLifecycle(), escalationPipeline(), slaDriven()];
  }
  return cachedDemos;
}

/**
 * GET /api/workflows — list all workflows
 */
export async function GET(request: NextRequest) {
  const auth = await requireAuth(request);
  if ('error' in auth) return auth.error;

  let workflows: Workflow[];
  try {
    workflows = await getWorkflows();
  } catch {
    workflows = getDemoWorkflows();
  }

  if (workflows.length === 0) {
    workflows = getDemoWorkflows();
  }

  const enabledFilter = request.nextUrl.searchParams.get('enabled');
  if (enabledFilter === 'true') {
    workflows = workflows.filter(w => w.enabled);
  }

  return NextResponse.json({ workflows });
}

/**
 * POST /api/workflows — create a new workflow
 */
export async function POST(request: NextRequest) {
  const auth = await requireAuth(request);
  if ('error' in auth) return auth.error;

  const parsed = await parseJsonBody<{
    name?: string;
    description?: string;
    templateKey?: string;
    nodes?: Record<string, WorkflowNode>;
    transitions?: WorkflowTransition[];
    entryNodeId?: string;
    enabled?: boolean;
  }>(request);
  if ('error' in parsed) return parsed.error;

  const { name, description, templateKey, nodes, transitions, entryNodeId, enabled } = parsed.data;

  if (!name?.trim()) {
    return NextResponse.json({ error: 'name is required' }, { status: 400 });
  }

  let workflow: Workflow;

  if (templateKey) {
    // Create from server-side template
    const tmpl = workflowTemplates.find(t => t.key === templateKey);
    if (!tmpl) {
      return NextResponse.json(
        { error: `Unknown template: ${templateKey}. Valid keys: ${workflowTemplates.map(t => t.key).join(', ')}` },
        { status: 400 },
      );
    }
    workflow = tmpl.create();
    workflow.name = name.trim();
    if (description?.trim()) workflow.description = description.trim();
    workflow.enabled = enabled ?? false;
  } else {
    // Create from raw nodes/transitions
    if (!nodes || !transitions || !entryNodeId) {
      return NextResponse.json(
        { error: 'nodes, transitions, and entryNodeId are required (or use templateKey)' },
        { status: 400 },
      );
    }

    if (!nodes[entryNodeId]) {
      return NextResponse.json(
        { error: 'entryNodeId must reference a valid node' },
        { status: 400 },
      );
    }

    const now = new Date().toISOString();
    workflow = {
      id: crypto.randomUUID(),
      name: name.trim(),
      description: description?.trim(),
      nodes,
      transitions,
      entryNodeId,
      enabled: enabled ?? false,
      version: 1,
      createdAt: now,
      updatedAt: now,
    };
  }

  const validation = validateWorkflow(workflow);
  if (!validation.valid) {
    return NextResponse.json(
      { error: 'Invalid workflow', details: validation.errors },
      { status: 400 },
    );
  }

  await upsertWorkflow(workflow);
  return NextResponse.json({ workflow }, { status: 201 });
}
