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
} from '@/lib/chat';
import { eventBus } from '@/lib/realtime/events';

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
  let body: Record<string, unknown>;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json(
      { error: 'Invalid JSON body' },
      { status: 400 },
    );
  }

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

      return NextResponse.json({
        sessionId: session.id,
        status: session.status,
        messages: session.messages,
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

      return NextResponse.json({ message });
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
