import { safeErrorMessage } from '@/lib/parse-json-body';
import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { getListings } from '@/lib/plugins/marketplace-store';

export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);

  try {
    const listings = await getListings({
      category: searchParams.get('category') ?? undefined,
      status: searchParams.get('status') ?? undefined,
      search: searchParams.get('search') ?? undefined,
      featured: searchParams.has('featured') ? searchParams.get('featured') === 'true' : undefined,
    });
    return NextResponse.json({ listings });
  } catch (err) {
    return NextResponse.json(
      { error: safeErrorMessage(err, 'Failed to list marketplace') },
      { status: 500 }
    );
  }
}
