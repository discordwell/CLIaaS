import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import {
  createSession,
  getSession,
  addMessage,
  getMessages,
  closeSession,
  setTyping,
  buildTicketFromChat,
  setBotState,
} from '@/lib/chat';
import { eventBus } from '@/lib/realtime/events';
import { parseJsonBody } from '@/lib/parse-json-body';
import { requireAuth } from '@/lib/api-auth';
import { getActiveChatbot } from '@/lib/chatbot/store';
import { evaluateBotResponse, processInitialGreeting } from '@/lib/chatbot/runtime';

export const dynamic = 'force-dynamic';

/**
 * GET /api/chat?sessionId=xxx
 * Get messages for a chat session.
 * Optional: &after=timestamp to get only new messages (long-poll style).
 */
export async function GET(request: NextRequest) {
  const { searchParams } = request.nextUrl;
  const sessionId = searchParams.get('sessionId');

  if (!sessionId) {
    return NextResponse.json(
      { error: 'sessionId is required' },
      { status: 400 },
    );
  }

  const session = getSession(sessionId);
  if (!session) {
    return NextResponse.json(
      { error: 'Session not found' },
      { status: 404 },
    );
  }

  const after = searchParams.get('after');
  const afterTs = after ? parseInt(after, 10) : undefined;
  const messages = getMessages(sessionId, afterTs);

  return NextResponse.json({
    sessionId: session.id,
    status: session.status,
    agentTyping: session.agentTyping,
    customerTyping: session.customerTyping,
    messages,
  });
}

/**
 * POST /api/chat
 * Actions: create, message, close, typing
 *
 * Create session:
 *   { action: "create", customerName: "...", customerEmail: "..." }
 *
 * Send message:
 *   { action: "message", sessionId: "...", role: "customer"|"agent", body: "..." }
 *
 * Close session:
 *   { action: "close", sessionId: "...", createTicket?: boolean }
 *
 * Typing indicator:
 *   { action: "typing", sessionId: "...", role: "customer"|"agent", typing: boolean }
 */
export async function POST(request: NextRequest) {
  const auth = await requireAuth(request);
  if ('error' in auth) return auth.error;

  const parsed = await parseJsonBody<Record<string, unknown>>(request);
  if ('error' in parsed) return parsed.error;
  const body = parsed.data;

  const action = body.action as string;

  switch (action) {
    // ---- Create a new chat session ----
    case 'create': {
      const customerName = (body.customerName as string)?.trim();
      const customerEmail = (body.customerEmail as string)?.trim();

      if (!customerName || !customerEmail) {
        return NextResponse.json(
          { error: 'customerName and customerEmail are required' },
          { status: 400 },
        );
      }

      const session = createSession(customerName, customerEmail);

      eventBus.emit({
        type: 'notification',
        data: {
          subject: `New chat from ${customerName}`,
          sessionId: session.id,
          customerEmail,
        },
        timestamp: Date.now(),
      });

      // Check for active chatbot flow and send initial greeting
      try {
        const activeBotFlow = await getActiveChatbot();
        if (activeBotFlow) {
          const greeting = processInitialGreeting(activeBotFlow);
          if (greeting.text) {
            const metadata = greeting.buttons
              ? { buttons: greeting.buttons.map((b) => ({ label: b.label })) }
              : undefined;
            addMessage(session.id, 'bot', greeting.text, metadata);
          }
          setBotState(session.id, greeting.newState);
        }
      } catch {
        // Bot initialization failed — continue without bot
      }

      // Re-fetch session to include bot messages
      const updatedSession = getSession(session.id);

      return NextResponse.json({
        sessionId: session.id,
        status: (updatedSession ?? session).status,
        messages: (updatedSession ?? session).messages,
      });
    }

    // ---- Send a message ----
    case 'message': {
      const sessionId = body.sessionId as string;
      const role = body.role as 'customer' | 'agent';
      const msgBody = (body.body as string)?.trim();

      if (!sessionId || !role || !msgBody) {
        return NextResponse.json(
          { error: 'sessionId, role, and body are required' },
          { status: 400 },
        );
      }

      if (!['customer', 'agent'].includes(role)) {
        return NextResponse.json(
          { error: 'role must be "customer" or "agent"' },
          { status: 400 },
        );
      }

      const message = addMessage(sessionId, role, msgBody);
      if (!message) {
        return NextResponse.json(
          { error: 'Session not found' },
          { status: 404 },
        );
      }

      eventBus.emit({
        type: 'ticket:reply',
        data: {
          sessionId,
          messageId: message.id,
          role,
          body: msgBody,
          subject: `Chat message from ${role}`,
        },
        timestamp: Date.now(),
      });

      // If customer message and session has active bot state, run chatbot
      let botMessage = null;
      if (role === 'customer') {
        const session = getSession(sessionId);
        if (session?.botState && session.botState.currentNodeId) {
          try {
            const activeBotFlow = await getActiveChatbot();
            if (activeBotFlow && activeBotFlow.id === session.botState.flowId) {
              const botResp = evaluateBotResponse(activeBotFlow, session.botState, msgBody);

              if (botResp.text) {
                const metadata = botResp.buttons
                  ? { buttons: botResp.buttons.map((b) => ({ label: b.label })) }
                  : undefined;
                botMessage = addMessage(
                  sessionId,
                  'bot',
                  botResp.text,
                  metadata,
                );
              }

              // Execute bot actions (set_tag, create_ticket, assign, close)
              for (const action of botResp.actions) {
                switch (action.actionType) {
                  case 'set_tag':
                    // Tag stored as variable for future use
                    if (action.value && botResp.newState) {
                      botResp.newState.variables[`tag:${action.value}`] = 'true';
                    }
                    break;
                  case 'close':
                    closeSession(sessionId);
                    break;
                  // create_ticket and assign are handled at session close
                }
              }

              if (botResp.handoff) {
                // Clear bot state — session goes to agent queue
                setBotState(sessionId, undefined);
              } else {
                setBotState(sessionId, botResp.newState);
              }
            }
          } catch {
            // Bot evaluation failed — continue without bot response
          }
        }
      }

      return NextResponse.json({ message, botMessage });
    }

    // ---- Close a chat session ----
    case 'close': {
      const sessionId = body.sessionId as string;
      const createTicket = body.createTicket !== false; // default true

      if (!sessionId) {
        return NextResponse.json(
          { error: 'sessionId is required' },
          { status: 400 },
        );
      }

      const session = closeSession(sessionId);
      if (!session) {
        return NextResponse.json(
          { error: 'Session not found' },
          { status: 404 },
        );
      }

      let ticket = null;
      if (createTicket) {
        ticket = buildTicketFromChat(session);

        eventBus.emit({
          type: 'ticket:created',
          data: {
            subject: ticket.subject,
            requester: ticket.requester,
            source: 'chat',
            sessionId,
          },
          timestamp: Date.now(),
        });
      }

      return NextResponse.json({
        sessionId: session.id,
        status: session.status,
        ticket,
      });
    }

    // ---- Typing indicator ----
    case 'typing': {
      const sessionId = body.sessionId as string;
      const role = body.role as 'agent' | 'customer';
      const typing = body.typing as boolean;

      if (!sessionId || !role || typeof typing !== 'boolean') {
        return NextResponse.json(
          { error: 'sessionId, role, and typing (boolean) are required' },
          { status: 400 },
        );
      }

      setTyping(sessionId, role, typing);
      return NextResponse.json({ ok: true });
    }

    default:
      return NextResponse.json(
        { error: `Unknown action: ${action}` },
        { status: 400 },
      );
  }
}
