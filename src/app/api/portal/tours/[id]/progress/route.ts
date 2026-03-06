import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { parseJsonBody } from '@/lib/parse-json-body';
import { upsertTourProgress, getTourProgress, getTourSteps } from '@/lib/tours/tour-store';
import { dispatch } from '@/lib/events/dispatcher';

export const dynamic = 'force-dynamic';

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const parsed = await parseJsonBody<{
    customerId: string;
    action: 'next' | 'complete' | 'dismiss';
  }>(request);
  if ('error' in parsed) return parsed.error;

  const { customerId, action } = parsed.data;
  if (!customerId || !action) {
    return NextResponse.json({ error: 'customerId and action are required' }, { status: 400 });
  }

  const steps = getTourSteps(id);

  if (action === 'dismiss') {
    const progress = upsertTourProgress(id, customerId, { status: 'dismissed' });
    dispatch('tour.dismissed', { tourId: id, customerId });
    return NextResponse.json({ progress });
  }

  if (action === 'complete') {
    const progress = upsertTourProgress(id, customerId, {
      status: 'completed',
      currentStep: steps.length - 1,
      completedAt: new Date().toISOString(),
    });
    dispatch('tour.completed', { tourId: id, customerId });
    return NextResponse.json({ progress });
  }

  // next — check existing progress first (read-only), then mutate
  const existing = getTourProgress(id, customerId);
  const isNew = !existing;
  const currentStep = existing?.currentStep ?? 0;

  // Emit started event on first interaction
  if (isNew || (currentStep === 0 && existing?.status === 'in_progress')) {
    dispatch('tour.started', { tourId: id, customerId });
  }

  const nextStep = currentStep + 1;

  if (nextStep >= steps.length) {
    const progress = upsertTourProgress(id, customerId, {
      status: 'completed',
      currentStep: steps.length - 1,
      completedAt: new Date().toISOString(),
    });
    dispatch('tour.completed', { tourId: id, customerId });
    return NextResponse.json({ progress });
  }

  const progress = upsertTourProgress(id, customerId, { currentStep: nextStep });
  return NextResponse.json({ progress });
}
