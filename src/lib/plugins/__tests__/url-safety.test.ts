import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock dns.resolve4 before importing the module
vi.mock('node:dns/promises', () => ({
  resolve4: vi.fn(),
}));

import { isPrivateUrl, isObviouslyPrivateUrl } from '../url-safety';
import { resolve4 } from 'node:dns/promises';

const mockResolve4 = resolve4 as ReturnType<typeof vi.fn>;

describe('url-safety', () => {
  beforeEach(() => {
    mockResolve4.mockReset();
    mockResolve4.mockResolvedValue(['93.184.216.34']); // default: public IP
  });

  describe('isObviouslyPrivateUrl (sync)', () => {
    it('blocks localhost', () => {
      expect(isObviouslyPrivateUrl('http://127.0.0.1/foo')).toBe(true);
    });

    it('blocks 10.x.x.x', () => {
      expect(isObviouslyPrivateUrl('http://10.0.0.1/api')).toBe(true);
    });

    it('blocks 172.16.x.x', () => {
      expect(isObviouslyPrivateUrl('http://172.16.0.1/')).toBe(true);
    });

    it('blocks 192.168.x.x', () => {
      expect(isObviouslyPrivateUrl('http://192.168.1.1/')).toBe(true);
    });

    it('blocks 169.254.x.x (link-local)', () => {
      expect(isObviouslyPrivateUrl('http://169.254.169.254/metadata')).toBe(true);
    });

    it('blocks 0.0.0.0', () => {
      expect(isObviouslyPrivateUrl('http://0.0.0.0/')).toBe(true);
    });

    it('blocks ::1 (IPv6 loopback)', () => {
      expect(isObviouslyPrivateUrl('http://[::1]/')).toBe(true);
    });

    it('blocks cloud metadata hostname', () => {
      expect(isObviouslyPrivateUrl('http://metadata.google.internal/')).toBe(true);
    });

    it('blocks octal-encoded 127.0.0.1 (0177.0.0.1)', () => {
      expect(isObviouslyPrivateUrl('http://0177.0.0.1/')).toBe(true);
    });

    it('blocks hex-encoded 127.0.0.1 (0x7f000001)', () => {
      expect(isObviouslyPrivateUrl('http://0x7f000001/')).toBe(true);
    });

    it('blocks decimal-encoded 127.0.0.1 (2130706433)', () => {
      expect(isObviouslyPrivateUrl('http://2130706433/')).toBe(true);
    });

    it('blocks non-http schemes', () => {
      expect(isObviouslyPrivateUrl('ftp://example.com/file')).toBe(true);
      expect(isObviouslyPrivateUrl('file:///etc/passwd')).toBe(true);
    });

    it('allows public URLs', () => {
      expect(isObviouslyPrivateUrl('https://example.com/api')).toBe(false);
    });

    it('blocks invalid URLs', () => {
      expect(isObviouslyPrivateUrl('not-a-url')).toBe(true);
    });
  });

  describe('isPrivateUrl (async with DNS)', () => {
    it('blocks URLs that resolve to private IPs', async () => {
      mockResolve4.mockResolvedValue(['10.0.0.1']);
      expect(await isPrivateUrl('https://internal.example.com/')).toBe(true);
    });

    it('allows URLs that resolve to public IPs', async () => {
      mockResolve4.mockResolvedValue(['93.184.216.34']);
      expect(await isPrivateUrl('https://example.com/')).toBe(false);
    });

    it('blocks when DNS resolution fails', async () => {
      mockResolve4.mockRejectedValue(new Error('ENOTFOUND'));
      expect(await isPrivateUrl('https://nonexistent.invalid/')).toBe(true);
    });

    it('blocks 169.254.169.254 (cloud metadata IP)', async () => {
      expect(await isPrivateUrl('http://169.254.169.254/latest/meta-data/')).toBe(true);
    });

    it('blocks 0x7f000001 (hex localhost)', async () => {
      expect(await isPrivateUrl('http://0x7f000001/')).toBe(true);
    });

    it('blocks CGNAT range 100.64.x.x', async () => {
      expect(await isPrivateUrl('http://100.64.0.1/')).toBe(true);
    });
  });
});
