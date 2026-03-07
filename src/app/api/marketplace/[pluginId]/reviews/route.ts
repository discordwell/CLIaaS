import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { requirePerm } from '@/lib/rbac';
import { parseJsonBody, safeErrorMessage } from '@/lib/parse-json-body';
import { getListing, getReviews, upsertReview } from '@/lib/plugins/marketplace-store';

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
    const reviews = await getReviews(listing.id);
    return NextResponse.json({ reviews });
  } catch (err) {
    return NextResponse.json(
      { error: safeErrorMessage(err, 'Failed to get reviews') },
      { status: 500 }
    );
  }
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ pluginId: string }> }
) {
  const auth = await requirePerm(request, 'admin:settings', 'admin');
  if ('error' in auth) return auth.error;

  const { pluginId } = await params;

  try {
    const listing = await getListing(pluginId);
    if (!listing) {
      return NextResponse.json({ error: 'Plugin not found' }, { status: 404 });
    }

    const parsed = await parseJsonBody<{
      rating?: number;
      title?: string;
      body?: string;
    }>(request);
    if ('error' in parsed) return parsed.error;

    const { rating, title, body } = parsed.data;

    if (!rating || rating < 1 || rating > 5) {
      return NextResponse.json({ error: 'Rating must be between 1 and 5' }, { status: 400 });
    }

    const review = await upsertReview({
      listingId: listing.id,
      workspaceId: auth.user.workspaceId,
      userId: auth.user.id,
      rating,
      title,
      body,
    });

    return NextResponse.json({ review }, { status: 201 });
  } catch (err) {
    return NextResponse.json(
      { error: safeErrorMessage(err, 'Failed to submit review') },
      { status: 500 }
    );
  }
}
