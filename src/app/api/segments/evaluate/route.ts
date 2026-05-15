import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { requirePerm } from '@/lib/rbac';
import { parseJsonBody } from '@/lib/parse-json-body';
import { evaluateSegmentWithStats, type SegmentQuery, type EvaluableCustomer } from '@/lib/segments/evaluator';

export const dynamic = 'force-dynamic';

export async function POST(request: NextRequest) {
  const auth = await requirePerm(request, 'tickets:view');
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
    const { getDataProvider } = await import('@/lib/data-provider/index');
    const provider = await getDataProvider();
    const rawCustomers = await provider.loadCustomers();
    customers = rawCustomers.map(c => {
      const extra = c as typeof c & { tags?: unknown };
      return {
        id: c.id,
        email: c.email,
        name: c.name,
        tags: Array.isArray(extra.tags) ? extra.tags.filter((tag): tag is string => typeof tag === 'string') : undefined,
        ...(c.customAttributes ? { customAttributes: c.customAttributes } : {}),
      };
    });
  } catch {
    customers = [];
  }

  const result = evaluateSegmentWithStats(customers, query);
  return NextResponse.json(result);
}
