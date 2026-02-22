import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { startTimer, stopTimer, getActiveTimers } from '@/lib/time-tracking';

export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    const timers = getActiveTimers();
    return NextResponse.json({ timers });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Failed to get active timers' },
      { status: 500 }
    );
  }
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { ticketId, userId, userName, action } = body;

    if (!ticketId || !userId) {
      return NextResponse.json(
        { error: 'ticketId and userId are required' },
        { status: 400 }
      );
    }

    if (action === 'stop') {
      const entry = stopTimer(ticketId, userId);
      if (!entry) {
        return NextResponse.json(
          { error: 'No active timer found' },
          { status: 404 }
        );
      }
      return NextResponse.json({ entry, status: 'stopped' });
    }

    // Default: start
    if (!userName) {
      return NextResponse.json(
        { error: 'userName is required to start a timer' },
        { status: 400 }
      );
    }

    const entry = startTimer(ticketId, userId, userName);
    return NextResponse.json({ entry, status: 'started' }, { status: 201 });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Failed to toggle timer' },
      { status: 500 }
    );
  }
}
