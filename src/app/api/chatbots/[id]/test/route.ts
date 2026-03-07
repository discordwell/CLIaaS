import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { requirePerm } from '@/lib/rbac';
import { parseJsonBody } from '@/lib/parse-json-body';
import { getChatbot } from '@/lib/chatbot/store';
import { evaluateBotResponse, initBotSession } from '@/lib/chatbot/runtime';
import type { ChatbotSessionState } from '@/lib/chatbot/types';

export const dynamic = 'force-dynamic';

/**
 * POST /api/chatbots/[id]/test — sandbox test session
 * Body: { message?: string, state?: ChatbotSessionState }
 * Returns bot response + updated state for next call.
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const auth = await requirePerm(request, 'automation:edit');
  if ('error' in auth) return auth.error;

  const { id } = await params;
  const flow = await getChatbot(id, auth.user.workspaceId);
  if (!flow) {
    return NextResponse.json({ error: 'Chatbot not found' }, { status: 404 });
  }

  const parsed = await parseJsonBody<{
    message?: string;
    state?: ChatbotSessionState;
  }>(request);
  if ('error' in parsed) return parsed.error;

  const { message, state } = parsed.data;
  const sessionState = state ?? initBotSession(flow);
  const response = evaluateBotResponse(flow, sessionState, message ?? '');

  return NextResponse.json({
    text: response.text,
    buttons: response.buttons,
    handoff: response.handoff,
    actions: response.actions,
    delay: response.delay,
    aiRequest: response.aiRequest ? true : undefined,
    articleRequest: response.articleRequest ? true : undefined,
    webhookRequest: response.webhookRequest ? true : undefined,
    collectInput: response.collectInput,
    state: response.newState,
  });
}
