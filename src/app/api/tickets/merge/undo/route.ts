import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { requireScope } from '@/lib/api-auth';
import { getDataProvider } from '@/lib/data-provider';
import { ticketUnmerged } from '@/lib/events';
import { eventBus } from '@/lib/realtime/events';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function POST(request: NextRequest) {
  const authResult = await requireScope(request, 'tickets:write');
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

    return NextResponse.json({ status: 'ok', mergeLogId, undone: true });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Unmerge failed' },
      { status: 500 },
    );
  }
}
