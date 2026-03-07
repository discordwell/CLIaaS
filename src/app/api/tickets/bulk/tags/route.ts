import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { requirePerm } from '@/lib/rbac';
import { parseJsonBody, safeErrorMessage } from '@/lib/parse-json-body';

export const dynamic = 'force-dynamic';

export async function POST(request: NextRequest) {
  const authResult = await requirePerm(request, 'tickets:update_status');
  if ('error' in authResult) return authResult.error;

  const parsed = await parseJsonBody<{
    ticketIds: string[];
    addTags?: string[];
    removeTags?: string[];
  }>(request);
  if ('error' in parsed) return parsed.error;
  const { ticketIds: rawIds, addTags, removeTags } = parsed.data;
  const ticketIds = [...new Set(rawIds)];

  if (!ticketIds?.length) {
    return NextResponse.json({ error: 'ticketIds required' }, { status: 400 });
  }
  if (ticketIds.length > 200) {
    return NextResponse.json({ error: 'Maximum 200 tickets per bulk operation' }, { status: 400 });
  }
  if (!addTags?.length && !removeTags?.length) {
    return NextResponse.json({ error: 'addTags or removeTags required' }, { status: 400 });
  }

  try {
    const { getDataProvider } = await import('@/lib/data-provider/index');
    const provider = await getDataProvider();

    let successCount = 0;
    const errors: string[] = [];

    for (const ticketId of ticketIds) {
      try {
        await provider.updateTicket(ticketId, {
          addTags: addTags?.length ? addTags : undefined,
          removeTags: removeTags?.length ? removeTags : undefined,
        });
        successCount++;
      } catch (err) {
        errors.push(`${ticketId}: ${safeErrorMessage(err, 'failed')}`);
      }
    }

    return NextResponse.json({
      success: successCount,
      total: ticketIds.length,
      errors: errors.length > 0 ? errors : undefined,
    });
  } catch (err) {
    return NextResponse.json(
      { error: safeErrorMessage(err, 'Bulk operation failed') },
      { status: 500 },
    );
  }
}
