import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { requirePerm } from '@/lib/rbac';
import { getDataProvider } from '@/lib/data-provider';
import { ticketMerged } from '@/lib/events';
import { eventBus } from '@/lib/realtime/events';
import { evaluateAutomation } from '@/lib/automation/executor';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function POST(request: NextRequest) {
  const authResult = await requirePerm(request, 'tickets:merge');
  if ('error' in authResult) return authResult.error;

  try {
    const body = await request.json();
    const { primaryTicketId, mergedTicketIds, mergedBy } = body as {
      primaryTicketId?: string;
      mergedTicketIds?: string[];
      mergedBy?: string;
    };

    if (!primaryTicketId || !mergedTicketIds?.length) {
      return NextResponse.json(
        { error: 'primaryTicketId and mergedTicketIds are required' },
        { status: 400 },
      );
    }

    if (!UUID_RE.test(primaryTicketId) || !mergedTicketIds.every(id => UUID_RE.test(id))) {
      return NextResponse.json(
        { error: 'All ticket IDs must be valid UUIDs' },
        { status: 400 },
      );
    }

    const provider = await getDataProvider();
    const result = await provider.mergeTickets({ primaryTicketId, mergedTicketIds, mergedBy });

    ticketMerged({ ...result, mergedTicketIds });
    eventBus.emit({
      type: 'ticket:merged',
      data: { primaryTicketId, mergedTicketIds, mergedCount: result.mergedCount },
      timestamp: Date.now(),
    });

    // Fire automation rules for merge event
    void evaluateAutomation('ticket.merged', {
      ticketId: primaryTicketId,
      primaryTicketId,
      mergedTicketIds,
      mergedBy,
      mergedCount: result.mergedCount,
    }, 'trigger').catch(() => {});

    return NextResponse.json(result);
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Merge failed' },
      { status: 500 },
    );
  }
}
