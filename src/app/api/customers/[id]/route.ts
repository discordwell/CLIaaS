import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { requireAuth } from '@/lib/api-auth';
import { parseJsonBody } from '@/lib/parse-json-body';
import { loadCustomers } from '@/lib/data';
import {
  getCustomerActivities,
  getCustomerNotes,
} from '@/lib/customers/customer-store';

export const dynamic = 'force-dynamic';

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const auth = await requireAuth(request);
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

    const activities = getCustomerActivities(customer.id);
    const notes = getCustomerNotes(customer.id);

    return NextResponse.json({
      customer: {
        ...customer,
        activityCount: activities.length,
        noteCount: notes.length,
      },
    });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Failed to load customer' },
      { status: 500 },
    );
  }
}

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const auth = await requireAuth(request);
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

    // Merge updates into customer (in-memory only for demo)
    const enriched = { ...customer, ...updates };

    return NextResponse.json({ customer: enriched });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Failed to update customer' },
      { status: 500 },
    );
  }
}
