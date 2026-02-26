import type { NextRequest } from 'next/server';
import { PORTAL_COOKIE_NAME, verify } from './cookie';

export function getPortalEmail(request: NextRequest): string | null {
  const raw = request.cookies.get(PORTAL_COOKIE_NAME)?.value;
  if (!raw) return null;
  return verify(raw);
}
