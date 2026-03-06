import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { getTours, getTourSteps, getTourProgress } from '@/lib/tours/tour-store';

export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const customerId = searchParams.get('customerId');
  const currentUrl = searchParams.get('url') ?? '';

  if (!customerId) {
    return NextResponse.json({ error: 'customerId is required' }, { status: 400 });
  }

  const activeTours = getTours().filter(t => {
    if (!t.isActive) return false;
    if (t.targetUrlPattern !== '*') {
      const escaped = t.targetUrlPattern.replace(/[.+?^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*');
      if (!new RegExp(`^${escaped}$`).test(currentUrl)) return false;
    }
    const progress = getTourProgress(t.id, customerId);
    if (progress && (progress.status === 'completed' || progress.status === 'dismissed')) return false;
    return true;
  });

  if (activeTours.length === 0) {
    return NextResponse.json({ tour: null });
  }

  const tour = activeTours[0];
  const steps = getTourSteps(tour.id);
  const progress = getTourProgress(tour.id, customerId);

  return NextResponse.json({
    tour: {
      ...tour,
      steps,
      currentStep: progress?.currentStep ?? 0,
    },
  });
}
