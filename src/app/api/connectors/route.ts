import { NextResponse } from "next/server";
import { CONNECTORS } from "@/lib/connectors";

export async function GET() {
  return NextResponse.json({ connectors: CONNECTORS });
}
