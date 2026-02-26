import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { requireAuth } from '@/lib/api-auth';
import { parseJsonBody } from '@/lib/parse-json-body';
import { getChatbot, upsertChatbot, deleteChatbot } from '@/lib/chatbot/store';
import type { ChatbotNode } from '@/lib/chatbot/types';

export const dynamic = 'force-dynamic';

/**
 * GET /api/chatbots/:id — get a chatbot flow
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const auth = await requireAuth(request);
  if ('error' in auth) return auth.error;

  const { id } = await params;
  const flow = await getChatbot(id);
  if (!flow) {
    return NextResponse.json({ error: 'Chatbot not found' }, { status: 404 });
  }

  return NextResponse.json({ chatbot: flow });
}

/**
 * PUT /api/chatbots/:id — update a chatbot flow
 */
export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const auth = await requireAuth(request);
  if ('error' in auth) return auth.error;

  const { id } = await params;
  const existing = await getChatbot(id);
  if (!existing) {
    return NextResponse.json({ error: 'Chatbot not found' }, { status: 404 });
  }

  const parsed = await parseJsonBody<{
    name?: string;
    nodes?: Record<string, ChatbotNode>;
    rootNodeId?: string;
    greeting?: string;
    enabled?: boolean;
  }>(request);
  if ('error' in parsed) return parsed.error;

  const { name, nodes, rootNodeId, greeting, enabled } = parsed.data;

  const updatedNodes = nodes ?? existing.nodes;
  const updatedRoot = rootNodeId ?? existing.rootNodeId;

  if (!updatedNodes[updatedRoot]) {
    return NextResponse.json(
      { error: 'rootNodeId must reference a valid node in the nodes map' },
      { status: 400 },
    );
  }

  const updated = {
    ...existing,
    name: name?.trim() ?? existing.name,
    nodes: updatedNodes,
    rootNodeId: updatedRoot,
    greeting: greeting !== undefined ? greeting : existing.greeting,
    enabled: enabled !== undefined ? enabled : existing.enabled,
    updatedAt: new Date().toISOString(),
  };

  await upsertChatbot(updated);
  return NextResponse.json({ chatbot: updated });
}

/**
 * DELETE /api/chatbots/:id — delete a chatbot flow
 */
export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const auth = await requireAuth(request);
  if ('error' in auth) return auth.error;

  const { id } = await params;
  const deleted = await deleteChatbot(id);
  if (!deleted) {
    return NextResponse.json({ error: 'Chatbot not found' }, { status: 404 });
  }

  return NextResponse.json({ ok: true });
}
