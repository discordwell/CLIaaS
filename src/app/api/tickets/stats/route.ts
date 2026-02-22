import { NextResponse } from "next/server";
import { loadTickets, computeStats } from "@/lib/data";

export const dynamic = "force-dynamic";

export async function GET() {
  const tickets = await loadTickets();
  const stats = computeStats(tickets);
  return NextResponse.json(stats);
}
