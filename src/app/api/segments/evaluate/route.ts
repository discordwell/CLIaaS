import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { requireAuth } from '@/lib/api-auth';
import { parseJsonBody } from '@/lib/parse-json-body';
import { evaluateSegmentWithStats, type SegmentQuery, type EvaluableCustomer } from '@/lib/segments/evaluator';

export const dynamic = 'force-dynamic';

export async function POST(request: NextRequest) {
  const auth = await requireAuth(request);
  if ('error' in auth) return auth.error;

  const parsed = await parseJsonBody<{ query: SegmentQuery }>(request);
  if ('error' in parsed) return parsed.error;

  const { query } = parsed.data;
  if (!query) {
    return NextResponse.json({ error: 'query is required' }, { status: 400 });
  }

  // Load customers from the data provider
  let customers: EvaluableCustomer[];
  try {
    const { getDataProvider } = await import('@/lib/data');
    const provider = getDataProvider();
    const rawCustomers = await provider.loadCustomers();
    customers = rawCustomers.map(c => ({
      id: c.id,
      email: c.email,
      name: c.name,
      tags: c.tags,
      ...((c as Record<string, unknown>).customAttributes ? { customAttributes: (c as Record<string, unknown>).customAttributes as Record<string, unknown> } : {}),
    }));
  } catch {
    customers = [];
  }

  const result = evaluateSegmentWithStats(customers, query);
  return NextResponse.json(result);
}
