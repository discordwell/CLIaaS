/**
 * Prometheus metrics registry — prom-client with app-specific metrics.
 * Uses globalThis to survive HMR re-registration in development.
 */

import { Registry, Counter, Histogram, Gauge, collectDefaultMetrics } from 'prom-client';

declare global {
  var __cliaasPromRegistry: Registry | undefined;
}

function createRegistry(): Registry {
  if (global.__cliaasPromRegistry) return global.__cliaasPromRegistry;

  const reg = new Registry();
  collectDefaultMetrics({ register: reg });

  if (process.env.NODE_ENV !== 'production') {
    global.__cliaasPromRegistry = reg;
  }
  return reg;
}

export const registry = createRegistry();

// ---- HTTP metrics ----

export const httpRequestDuration = registry.getSingleMetric('http_request_duration_seconds') as Histogram ?? new Histogram({
  name: 'http_request_duration_seconds',
  help: 'Duration of HTTP requests in seconds',
  labelNames: ['method', 'route', 'status_code'] as const,
  buckets: [0.01, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10],
  registers: [registry],
});

export const httpRequestsTotal = registry.getSingleMetric('http_requests_total') as Counter ?? new Counter({
  name: 'http_requests_total',
  help: 'Total number of HTTP requests',
  labelNames: ['method', 'route', 'status_code'] as const,
  registers: [registry],
});

// ---- Application metrics ----

export const appErrorsTotal = registry.getSingleMetric('app_errors_total') as Counter ?? new Counter({
  name: 'app_errors_total',
  help: 'Total number of application errors',
  labelNames: ['module', 'type'] as const,
  registers: [registry],
});

// ---- Queue metrics ----

export const queueDepth = registry.getSingleMetric('queue_depth') as Gauge ?? new Gauge({
  name: 'queue_depth',
  help: 'Number of waiting jobs in queue',
  labelNames: ['queue'] as const,
  registers: [registry],
});

export const queueActiveJobs = registry.getSingleMetric('queue_active_jobs') as Gauge ?? new Gauge({
  name: 'queue_active_jobs',
  help: 'Number of active (in-progress) jobs in queue',
  labelNames: ['queue'] as const,
  registers: [registry],
});
