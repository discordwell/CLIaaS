import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { loadMessages } from '@/lib/data';
import { requireScope } from '@/lib/api-auth';

export const dynamic = 'force-dynamic';

/**
 * GET /api/tickets/:id/messages — returns messages for a single ticket.
 * Used by RemoteProvider.loadMessages(ticketId).
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const auth = await requireScope(request, 'tickets:read');
  if ('error' in auth) return auth.error;

  const { id } = await params;
  const messages = await loadMessages(id);
  messages.sort(
    (a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime(),
  );

  return NextResponse.json({ messages });
}
