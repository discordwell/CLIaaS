import { NextResponse } from "next/server";
import { getPool } from "@/db";
import { getRedis } from "@/lib/queue/connection";
import { getAllQueueStats } from "@/lib/queue/stats";

interface HealthCheck {
  status: "ok" | "error" | "not_configured";
  latencyMs?: number;
  error?: string;
}

export async function GET() {
  const checks: Record<string, HealthCheck> = {};

  // Database check
  const pool = getPool();
  if (pool) {
    const start = Date.now();
    try {
      await pool.query("SELECT 1");
      checks.database = { status: "ok", latencyMs: Date.now() - start };
    } catch (err) {
      checks.database = {
        status: "error",
        latencyMs: Date.now() - start,
        error: err instanceof Error ? err.message : "Unknown",
      };
    }
  } else {
    checks.database = { status: "not_configured" };
  }

  // Redis check
  const redis = getRedis();
  if (redis) {
    const start = Date.now();
    try {
      await redis.ping();
      checks.redis = { status: "ok", latencyMs: Date.now() - start };
    } catch (err) {
      checks.redis = {
        status: "error",
        latencyMs: Date.now() - start,
        error: err instanceof Error ? err.message : "Unknown",
      };
    }
  } else {
    checks.redis = { status: "not_configured" };
  }

  // Queue stats
  try {
    const stats = await getAllQueueStats();
    if (stats.length > 0) {
      checks.queues = { status: "ok" };
    } else {
      checks.queues = { status: "not_configured" };
    }
  } catch {
    checks.queues = { status: "not_configured" };
  }

  // Overall status: degraded if any configured service is in error
  const hasError = Object.values(checks).some(
    (c) => c.status === "error"
  );
  const overallStatus = hasError ? "degraded" : "ok";

  return NextResponse.json({
    service: "cliaas",
    status: overallStatus,
    timestamp: new Date().toISOString(),
    checks,
  });
}
