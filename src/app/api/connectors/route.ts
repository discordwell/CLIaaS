import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { CONNECTORS } from "@/lib/connectors";
import { requireRole } from "@/lib/api-auth";

export async function GET(request: NextRequest) {
  const auth = await requireRole(request, 'admin');
  if ('error' in auth) return auth.error;

  return NextResponse.json({ connectors: CONNECTORS });
}
