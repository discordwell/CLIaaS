/**
 * Client IP extraction from reverse-proxy headers.
 */

/** Extract client IP from proxy headers.
 *  Prefers x-real-ip (set by Caddy/Nginx from actual connection).
 *  Falls back to last entry of x-forwarded-for (appended by trusted proxy). */
export function getClientIp(request: Pick<Request, 'headers'>): string {
  const realIp = request.headers.get('x-real-ip');
  if (realIp) return realIp.trim();
  const forwarded = request.headers.get('x-forwarded-for');
  if (forwarded) {
    const parts = forwarded.split(',');
    return parts[parts.length - 1].trim();
  }
  return 'unknown';
}
