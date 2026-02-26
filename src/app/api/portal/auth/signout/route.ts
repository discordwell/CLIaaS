import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { PORTAL_COOKIE_NAME } from '@/lib/portal/cookie';

export const dynamic = 'force-dynamic';

export async function POST(request: NextRequest) {
  const response = NextResponse.redirect(new URL('/portal', request.url));

  response.cookies.delete(PORTAL_COOKIE_NAME);

  return response;
}
