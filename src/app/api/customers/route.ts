import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { loadCustomers, loadOrganizations } from '@/lib/data';
import { requireAuth } from '@/lib/api-auth';

export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  const auth = await requireAuth(request);
  if ('error' in auth) return auth.error;

  const { searchParams } = new URL(request.url);
  const q = searchParams.get('q')?.toLowerCase();
  const source = searchParams.get('source');

  let customers = await loadCustomers();
  const organizations = await loadOrganizations();

  if (source) {
    customers = customers.filter(c => c.source === source);
  }

  if (q) {
    customers = customers.filter(
      c =>
        c.name?.toLowerCase().includes(q) ||
        c.email?.toLowerCase().includes(q),
    );
  }

  return NextResponse.json({ customers, organizations });
}
