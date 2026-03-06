import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { CONNECTORS } from "@/lib/connectors";
import { requirePerm } from '@/lib/rbac';

export async function GET(request: NextRequest) {
  const auth = await requirePerm(request, 'admin:settings', 'admin');
  if ('error' in auth) return auth.error;

  return NextResponse.json({ connectors: CONNECTORS });
}
