import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { requireAuth } from '@/lib/api-auth';
import { parseJsonBody } from '@/lib/parse-json-body';
import { loadCustomers } from '@/lib/data';
import { mergeCustomers } from '@/lib/customers/customer-store';

export const dynamic = 'force-dynamic';

export async function POST(request: NextRequest) {
  const auth = await requireAuth(request);
  if ('error' in auth) return auth.error;

  const parsed = await parseJsonBody(request);
  if ('error' in parsed) return parsed.error;

  try {
    const { primaryId, mergedId } = parsed.data;

    if (!primaryId || !mergedId) {
      return NextResponse.json(
        { error: 'primaryId and mergedId are required' },
        { status: 400 },
      );
    }

    if (primaryId === mergedId) {
      return NextResponse.json(
        { error: 'Cannot merge a customer with itself' },
        { status: 400 },
      );
    }

    const customers = await loadCustomers();
    const primary = customers.find((c) => c.id === primaryId);
    const merged = customers.find((c) => c.id === mergedId);

    if (!primary) {
      return NextResponse.json(
        { error: `Primary customer not found: ${primaryId}` },
        { status: 404 },
      );
    }

    if (!merged) {
      return NextResponse.json(
        { error: `Merged customer not found: ${mergedId}` },
        { status: 404 },
      );
    }

    const entry = mergeCustomers(
      primaryId,
      mergedId,
      { name: merged.name, email: merged.email, source: merged.source },
      auth.user.id,
    );

    return NextResponse.json({ merge: entry }, { status: 201 });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Failed to merge customers' },
      { status: 500 },
    );
  }
}
