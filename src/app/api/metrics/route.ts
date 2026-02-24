/**
 * GET /api/metrics — Prometheus text format endpoint.
 * Updates queue gauges before each scrape.
 */

import { NextResponse } from 'next/server';
import { registry, queueDepth, queueActiveJobs } from '@/lib/metrics';
import { getAllQueueStats } from '@/lib/queue/stats';

export async function GET() {
  // Update queue gauges before scrape
  try {
    const stats = await getAllQueueStats();
    // Reset gauges so removed queues don't leave stale data
    queueDepth.reset();
    queueActiveJobs.reset();
    for (const s of stats) {
      queueDepth.set({ queue: s.name }, s.waiting);
      queueActiveJobs.set({ queue: s.name }, s.active);
    }
  } catch {
    // Queue stats unavailable — gauges stay at last known values
  }

  const metrics = await registry.metrics();
  return new NextResponse(metrics, {
    status: 200,
    headers: {
      'Content-Type': registry.contentType,
      'Cache-Control': 'no-store',
    },
  });
}
