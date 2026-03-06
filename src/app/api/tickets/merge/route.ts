import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { getDataProvider } from '@/lib/data-provider';
import { ticketMerged } from '@/lib/events';
import { eventBus } from '@/lib/realtime/events';

export async function POST(request: NextRequest) {
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

    const provider = await getDataProvider();
    const result = await provider.mergeTickets({ primaryTicketId, mergedTicketIds, mergedBy });

    ticketMerged({ ...result, mergedTicketIds });
    eventBus.emit({
      type: 'ticket:merged',
      data: { primaryTicketId, mergedTicketIds, mergedCount: result.mergedCount },
      timestamp: Date.now(),
    });

    return NextResponse.json(result);
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Merge failed' },
      { status: 500 },
    );
  }
}
