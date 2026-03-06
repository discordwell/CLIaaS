import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { requirePerm } from '@/lib/rbac';
import { parseJsonBody } from '@/lib/parse-json-body';
import { getChatbots, upsertChatbot } from '@/lib/chatbot/store';
import type { ChatbotFlow, ChatbotNode } from '@/lib/chatbot/types';
import { CHATBOT_TEMPLATES } from '@/lib/chatbot/templates';

export const dynamic = 'force-dynamic';

/**
 * GET /api/chatbots — list all chatbot flows
 */
export async function GET(request: NextRequest) {
  const auth = await requirePerm(request, 'automation:view');
  if ('error' in auth) return auth.error;

  const flows = await getChatbots();
  return NextResponse.json({ chatbots: flows });
}

/**
 * POST /api/chatbots — create a new chatbot flow
 * Supports template: 'support_triage' | 'faq_bot' | 'sales_router' | 'lead_qualifier'
 */
export async function POST(request: NextRequest) {
  const auth = await requirePerm(request, 'automation:edit');
  if ('error' in auth) return auth.error;

  const parsed = await parseJsonBody<{
    name?: string;
    nodes?: Record<string, ChatbotNode>;
    rootNodeId?: string;
    greeting?: string;
    enabled?: boolean;
    template?: string;
  }>(request);
  if ('error' in parsed) return parsed.error;

  const { name, greeting, enabled, template } = parsed.data;
  let { nodes, rootNodeId } = parsed.data;

  if (!name?.trim()) {
    return NextResponse.json({ error: 'name is required' }, { status: 400 });
  }

  const flowId = crypto.randomUUID();

  // Use template if specified
  if (template) {
    const tpl = CHATBOT_TEMPLATES.find((t) => t.key === template);
    if (!tpl) {
      return NextResponse.json(
        { error: `Unknown template: ${template}. Available: ${CHATBOT_TEMPLATES.map((t) => t.key).join(', ')}` },
        { status: 400 },
      );
    }
    const templateFlow = tpl.createFlow(flowId);
    nodes = templateFlow.nodes;
    rootNodeId = templateFlow.rootNodeId;
  }

  if (!nodes || !rootNodeId) {
    return NextResponse.json(
      { error: 'nodes and rootNodeId are required (or specify a template)' },
      { status: 400 },
    );
  }

  if (!nodes[rootNodeId]) {
    return NextResponse.json(
      { error: 'rootNodeId must reference a valid node' },
      { status: 400 },
    );
  }

  const tpl = template ? CHATBOT_TEMPLATES.find((t) => t.key === template) : null;
  const now = new Date().toISOString();
  const flow: ChatbotFlow = {
    id: flowId,
    name: name.trim(),
    nodes,
    rootNodeId,
    enabled: enabled ?? false,
    greeting,
    version: 1,
    status: 'draft',
    description: tpl?.description,
    createdAt: now,
    updatedAt: now,
  };

  await upsertChatbot(flow);
  return NextResponse.json({ chatbot: flow }, { status: 201 });
}
