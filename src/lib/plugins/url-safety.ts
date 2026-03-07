/**
 * Shared URL safety checks — SSRF prevention for plugins, webhooks, etc.
 *
 * Blocks private/reserved IP ranges, cloud metadata endpoints, and
 * normalizes octal/hex/decimal IP encodings to prevent bypass.
 */

import { resolve4 } from 'node:dns/promises';

// CIDR ranges in numeric form for fast checking
const PRIVATE_RANGES: Array<{ start: number; end: number }> = [
  { start: 0x00000000, end: 0x00FFFFFF },   // 0.0.0.0/8
  { start: 0x0A000000, end: 0x0AFFFFFF },   // 10.0.0.0/8
  { start: 0x7F000000, end: 0x7FFFFFFF },   // 127.0.0.0/8
  { start: 0xA9FE0000, end: 0xA9FEFFFF },   // 169.254.0.0/16
  { start: 0xAC100000, end: 0xAC1FFFFF },   // 172.16.0.0/12
  { start: 0xC0A80000, end: 0xC0A8FFFF },   // 192.168.0.0/16
  { start: 0x64400000, end: 0x647FFFFF },   // 100.64.0.0/10 (CGNAT)
];

const BLOCKED_HOSTNAMES = new Set([
  'localhost',
  'metadata.google.internal',
  'metadata.google',
  'kubernetes.default.svc',
]);

function ipToNumber(ip: string): number {
  const parts = ip.split('.');
  if (parts.length !== 4) return -1;
  let num = 0;
  for (const p of parts) {
    const v = parseInt(p, 10);
    if (isNaN(v) || v < 0 || v > 255) return -1;
    num = (num << 8) | v;
  }
  return num >>> 0; // unsigned
}

function isPrivateIp(ip: string): boolean {
  const num = ipToNumber(ip);
  if (num === -1) return true; // unparseable → block
  return PRIVATE_RANGES.some(r => num >= r.start && num <= r.end);
}

/**
 * Normalize exotic IP encodings (octal, hex, decimal integer) to dotted-quad.
 * E.g. 0x7f000001 → 127.0.0.1, 2130706433 → 127.0.0.1, 0177.0.0.1 → 127.0.0.1
 */
function normalizeIp(hostname: string): string | null {
  // Single decimal integer: e.g. 2130706433
  if (/^\d{4,}$/.test(hostname)) {
    const num = parseInt(hostname, 10);
    if (num >= 0 && num <= 0xFFFFFFFF) {
      return [
        (num >>> 24) & 0xFF,
        (num >>> 16) & 0xFF,
        (num >>> 8) & 0xFF,
        num & 0xFF,
      ].join('.');
    }
  }

  // Single hex integer: e.g. 0x7f000001
  if (/^0x[0-9a-fA-F]+$/.test(hostname)) {
    const num = parseInt(hostname, 16);
    if (num >= 0 && num <= 0xFFFFFFFF) {
      return [
        (num >>> 24) & 0xFF,
        (num >>> 16) & 0xFF,
        (num >>> 8) & 0xFF,
        num & 0xFF,
      ].join('.');
    }
  }

  // Dotted with octal/hex octets: e.g. 0177.0.0.1 or 0x7f.0.0.1
  const parts = hostname.split('.');
  if (parts.length === 4) {
    const octets: number[] = [];
    for (const p of parts) {
      let v: number;
      if (p.startsWith('0x') || p.startsWith('0X')) {
        v = parseInt(p, 16);
      } else if (p.startsWith('0') && p.length > 1 && /^[0-7]+$/.test(p)) {
        v = parseInt(p, 8); // octal
      } else {
        v = parseInt(p, 10);
      }
      if (isNaN(v) || v < 0 || v > 255) return null;
      octets.push(v);
    }
    return octets.join('.');
  }

  return null;
}

/**
 * Check if a URL targets a private/reserved network.
 * Resolves hostnames via DNS to catch DNS rebinding of public names to private IPs.
 */
export async function isPrivateUrl(urlString: string): Promise<boolean> {
  let parsed: URL;
  try {
    parsed = new URL(urlString);
  } catch {
    return true; // unparseable → block
  }

  // Only allow http(s)
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    return true;
  }

  const hostname = parsed.hostname.replace(/^\[|\]$/g, ''); // strip IPv6 brackets

  // Block known metadata hostnames
  if (BLOCKED_HOSTNAMES.has(hostname.toLowerCase())) {
    return true;
  }

  // Check IPv6 loopback
  if (hostname === '::1' || hostname === '0:0:0:0:0:0:0:1') {
    return true;
  }

  // Try normalizing exotic IP encodings
  const normalized = normalizeIp(hostname);
  if (normalized && isPrivateIp(normalized)) {
    return true;
  }

  // Check standard dotted-quad
  if (/^\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(hostname)) {
    return isPrivateIp(hostname);
  }

  // Resolve hostname via DNS and check resulting IPs
  try {
    const addresses = await resolve4(hostname);
    return addresses.some(ip => isPrivateIp(ip));
  } catch {
    // DNS resolution failed — could be internal-only name, block it
    return true;
  }
}

/**
 * Synchronous check for obviously-private URLs (no DNS resolution).
 * Use for fast pre-checks; follow up with the async version for full safety.
 */
export function isObviouslyPrivateUrl(urlString: string): boolean {
  let parsed: URL;
  try {
    parsed = new URL(urlString);
  } catch {
    return true;
  }

  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    return true;
  }

  const hostname = parsed.hostname.replace(/^\[|\]$/g, '');

  if (BLOCKED_HOSTNAMES.has(hostname.toLowerCase())) return true;
  if (hostname === '::1' || hostname === '0:0:0:0:0:0:0:1') return true;

  const normalized = normalizeIp(hostname);
  if (normalized && isPrivateIp(normalized)) return true;

  if (/^\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(hostname)) {
    return isPrivateIp(hostname);
  }

  return false;
}
