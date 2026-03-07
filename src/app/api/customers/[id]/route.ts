import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { requirePerm } from '@/lib/rbac';
import { parseJsonBody, safeErrorMessage } from '@/lib/parse-json-body';
import { loadCustomers } from '@/lib/data';
import {
  getCustomerActivities,
  getCustomerNotes,
  getCustomerEnrichment,
  updateCustomerEnrichment,
} from '@/lib/customers/customer-store';

export const dynamic = 'force-dynamic';

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const auth = await requirePerm(request, 'customers:view');
  if ('error' in auth) return auth.error;

  try {
    const { id } = await params;
    const customers = await loadCustomers();
    const customer = customers.find((c) => c.id === id || c.email === id);

    if (!customer) {
      return NextResponse.json(
        { error: `Customer not found: ${id}` },
        { status: 404 },
      );
    }

    const activities = await getCustomerActivities(customer.id);
    const notes = await getCustomerNotes(customer.id);
    const enrichment = getCustomerEnrichment(customer.id);

    return NextResponse.json({
      customer: {
        ...customer,
        ...(enrichment ?? {}),
        activityCount: activities.length,
        noteCount: notes.length,
      },
    });
  } catch (err) {
    return NextResponse.json(
      { error: safeErrorMessage(err, 'Failed to load customer') },
      { status: 500 },
    );
  }
}

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const auth = await requirePerm(request, 'customers:edit');
  if ('error' in auth) return auth.error;

  const parsed = await parseJsonBody(request);
  if ('error' in parsed) return parsed.error;

  try {
    const { id } = await params;
    const customers = await loadCustomers();
    const customer = customers.find((c) => c.id === id || c.email === id);

    if (!customer) {
      return NextResponse.json(
        { error: `Customer not found: ${id}` },
        { status: 404 },
      );
    }

    // Apply enrichment fields to the customer object
    const enrichmentFields = [
      'customAttributes',
      'avatarUrl',
      'locale',
      'timezone',
      'lastSeenAt',
      'browser',
      'os',
      'ipAddress',
      'signupDate',
      'plan',
    ];

    const updates: Record<string, unknown> = {};
    for (const field of enrichmentFields) {
      if (parsed.data[field] !== undefined) {
        updates[field] = parsed.data[field];
      }
    }

    // Persist enrichment to JSONL overlay store
    const enrichment = updateCustomerEnrichment(customer.id, updates);
    const enriched = { ...customer, ...enrichment };

    return NextResponse.json({ customer: enriched });
  } catch (err) {
    return NextResponse.json(
      { error: safeErrorMessage(err, 'Failed to update customer') },
      { status: 500 },
    );
  }
}
