import { safeErrorMessage } from '@/lib/parse-json-body';
import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { getListing } from '@/lib/plugins/marketplace-store';

export const dynamic = 'force-dynamic';

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ pluginId: string }> }
) {
  const { pluginId } = await params;

  try {
    const listing = await getListing(pluginId);
    if (!listing) {
      return NextResponse.json({ error: 'Plugin not found' }, { status: 404 });
    }
    return NextResponse.json({ listing });
  } catch (err) {
    return NextResponse.json(
      { error: safeErrorMessage(err, 'Failed to get listing') },
      { status: 500 }
    );
  }
}
