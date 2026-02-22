import { NextResponse } from 'next/server';
import { loadCustomers, loadOrganizations } from '@/lib/data';

export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
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
