import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { loadTickets, computeStats } from "@/lib/data";
import { requireAuth } from '@/lib/api-auth';

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const auth = await requireAuth(request);
  if ('error' in auth) return auth.error;

  const tickets = await loadTickets();
  const stats = computeStats(tickets);
  return NextResponse.json(stats);
}
