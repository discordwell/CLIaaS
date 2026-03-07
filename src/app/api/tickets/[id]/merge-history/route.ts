import { safeErrorMessage } from '@/lib/parse-json-body';
import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { requirePerm } from '@/lib/rbac';
import { getDataProvider } from '@/lib/data-provider';

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const authResult = await requirePerm(request, 'tickets:view');
  if ('error' in authResult) return authResult.error;

  try {
    const { id } = await params;
    const provider = await getDataProvider();
    const history = await provider.getMergeHistory(id);

    return NextResponse.json({ ticketId: id, history });
  } catch (err) {
    return NextResponse.json(
      { error: safeErrorMessage(err, 'Failed to load merge history') },
      { status: 500 },
    );
  }
}
