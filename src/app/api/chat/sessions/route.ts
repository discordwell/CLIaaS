import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { getActiveSessions, getAllSessions } from '@/lib/chat';
import { requireAuth } from '@/lib/api-auth';

export const dynamic = 'force-dynamic';

/**
 * GET /api/chat/sessions
 * List chat sessions for the agent dashboard.
 * Optional: ?all=true to include closed sessions.
 */
export async function GET(request: NextRequest) {
  const auth = await requireAuth(request);
  if ('error' in auth) return auth.error;

  const url = new URL(request.url);
  const includeAll = url.searchParams.get('all') === 'true';

  const sessions = includeAll ? getAllSessions() : getActiveSessions();

  const summaries = sessions.map((s) => {
    const lastCustomerMsg = [...s.messages]
      .reverse()
      .find((m) => m.role === 'customer');

    return {
      id: s.id,
      customerName: s.customerName,
      customerEmail: s.customerEmail,
      status: s.status,
      lastMessage: lastCustomerMsg?.body ?? null,
      messageCount: s.messages.filter((m) => m.role !== 'system').length,
      startedAt: s.startedAt,
      lastActivity: s.lastActivity,
      customerTyping: s.customerTyping,
    };
  });

  return NextResponse.json({ sessions: summaries });
}
