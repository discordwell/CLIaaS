import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { requireAuth } from '@/lib/api-auth';
import { parseJsonBody } from '@/lib/parse-json-body';
import { getChatbots, upsertChatbot } from '@/lib/chatbot/store';
import type { ChatbotFlow, ChatbotNode } from '@/lib/chatbot/types';

export const dynamic = 'force-dynamic';

/**
 * GET /api/chatbots — list all chatbot flows
 */
export async function GET(request: NextRequest) {
  const auth = await requireAuth(request);
  if ('error' in auth) return auth.error;

  const flows = await getChatbots();
  return NextResponse.json({ chatbots: flows });
}

/**
 * POST /api/chatbots — create a new chatbot flow
 */
export async function POST(request: NextRequest) {
  const auth = await requireAuth(request);
  if ('error' in auth) return auth.error;

  const parsed = await parseJsonBody<{
    name?: string;
    nodes?: Record<string, ChatbotNode>;
    rootNodeId?: string;
    greeting?: string;
    enabled?: boolean;
  }>(request);
  if ('error' in parsed) return parsed.error;

  const { name, nodes, rootNodeId, greeting, enabled } = parsed.data;

  if (!name?.trim()) {
    return NextResponse.json({ error: 'name is required' }, { status: 400 });
  }

  if (!nodes || !rootNodeId) {
    return NextResponse.json(
      { error: 'nodes and rootNodeId are required' },
      { status: 400 },
    );
  }

  if (!nodes[rootNodeId]) {
    return NextResponse.json(
      { error: 'rootNodeId must reference a valid node' },
      { status: 400 },
    );
  }

  const now = new Date().toISOString();
  const flow: ChatbotFlow = {
    id: crypto.randomUUID(),
    name: name.trim(),
    nodes,
    rootNodeId,
    enabled: enabled ?? false,
    greeting,
    createdAt: now,
    updatedAt: now,
  };

  await upsertChatbot(flow);
  return NextResponse.json({ chatbot: flow }, { status: 201 });
}
