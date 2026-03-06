import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { getDataProvider } from '@/lib/data-provider';

export async function POST(request: NextRequest) {
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

    const provider = await getDataProvider();
    await provider.unmergeTicket({ mergeLogId, unmergedBy });

    return NextResponse.json({ status: 'ok', mergeLogId, undone: true });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Unmerge failed' },
      { status: 500 },
    );
  }
}
