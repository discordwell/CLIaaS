import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { requireScope } from '@/lib/api-auth';
import { parseJsonBody } from '@/lib/parse-json-body';
import { executeViewQuery } from '@/lib/views/executor';
import { loadTickets } from '@/lib/data';
import type { ViewQuery } from '@/lib/views/types';

export const dynamic = 'force-dynamic';

export async function POST(request: NextRequest) {
  const authResult = await requireScope(request, 'tickets:read');
  if ('error' in authResult) return authResult.error;

  const parsed = await parseJsonBody<{ query: ViewQuery }>(request);
  if ('error' in parsed) return parsed.error;
  const { query } = parsed.data;

  if (!query?.conditions) {
    return NextResponse.json({ error: 'query required' }, { status: 400 });
  }

  try {
    const tickets = await loadTickets();
    const count = executeViewQuery(query, tickets, authResult.user.id).length;
    return NextResponse.json({ count });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Failed' },
      { status: 500 },
    );
  }
}
