import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { requireAuth } from '@/lib/api-auth';
import { parseJsonBody } from '@/lib/parse-json-body';
import { evaluateSegment, type SegmentQuery, type EvaluableCustomer } from '@/lib/segments/evaluator';

export const dynamic = 'force-dynamic';

export async function POST(request: NextRequest) {
  const auth = await requireAuth(request);
  if ('error' in auth) return auth.error;

  const parsed = await parseJsonBody<{ query: SegmentQuery; limit?: number }>(request);
  if ('error' in parsed) return parsed.error;

  const { query, limit = 20 } = parsed.data;
  if (!query) {
    return NextResponse.json({ error: 'query is required' }, { status: 400 });
  }

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

  const matching = evaluateSegment(customers, query);
  const cappedLimit = Math.min(Math.max(1, limit), 100);

  return NextResponse.json({
    total: customers.length,
    matchCount: matching.length,
    customers: matching.slice(0, cappedLimit).map(c => ({ id: c.id, email: c.email, name: c.name })),
  });
}
