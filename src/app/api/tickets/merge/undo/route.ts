import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { requirePerm } from '@/lib/rbac';
import { getDataProvider } from '@/lib/data-provider';
import { ticketUnmerged } from '@/lib/events';
import { eventBus } from '@/lib/realtime/events';
import { evaluateAutomation } from '@/lib/automation/executor';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function POST(request: NextRequest) {
  const authResult = await requirePerm(request, 'tickets:merge', 'admin');
  if ('error' in authResult) return authResult.error;

  try {
    const body = await request.json();
    const { mergeLogId, unmergedBy } = body as {
      mergeLogId?: string;
      unmergedBy?: string;
    };

    if (!mergeLogId) {
      return NextResponse.json(
        { error: 'mergeLogId is required' },
        { status: 400 },
      );
    }

    if (!UUID_RE.test(mergeLogId)) {
      return NextResponse.json(
        { error: 'mergeLogId must be a valid UUID' },
        { status: 400 },
      );
    }

    const provider = await getDataProvider();
    await provider.unmergeTicket({ mergeLogId, unmergedBy });

    ticketUnmerged({ mergeLogId });
    eventBus.emit({
      type: 'ticket:unmerged',
      data: { mergeLogId },
      timestamp: Date.now(),
    });

    // Fire automation rules for unmerge event
    void evaluateAutomation('ticket.unmerged', {
      mergeLogId,
      unmergedBy,
    }, 'trigger').catch(() => {});

    return NextResponse.json({ status: 'ok', mergeLogId, undone: true });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Unmerge failed' },
      { status: 500 },
    );
  }
}
