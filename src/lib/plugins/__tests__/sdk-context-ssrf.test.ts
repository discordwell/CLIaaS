import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('node:dns/promises', () => ({
  resolve4: vi.fn().mockResolvedValue(['93.184.216.34']),
}));

import { createPluginSDK } from '../sdk-context';

describe('sdk-context SSRF prevention', () => {
  const sdk = createPluginSDK(['oauth:external'], {}, 'test-ws');

  it('rejects fetch to 127.0.0.1', async () => {
    await expect(sdk.http.get('http://127.0.0.1/secrets')).rejects.toThrow(/blocked/i);
  });

  it('rejects fetch to 169.254.169.254 (cloud metadata)', async () => {
    await expect(sdk.http.get('http://169.254.169.254/latest/meta-data/')).rejects.toThrow(/blocked/i);
  });

  it('rejects fetch to 0x7f000001 (hex-encoded localhost)', async () => {
    await expect(sdk.http.get('http://0x7f000001/')).rejects.toThrow(/blocked/i);
  });

  it('rejects fetch to 10.0.0.1 (private)', async () => {
    await expect(sdk.http.get('http://10.0.0.1/internal')).rejects.toThrow(/blocked/i);
  });

  it('rejects POST to private IPs', async () => {
    await expect(sdk.http.post('http://192.168.1.1/api', { data: 1 })).rejects.toThrow(/blocked/i);
  });

  it('rejects non-http schemes', async () => {
    await expect(sdk.http.get('ftp://files.example.com/data')).rejects.toThrow(/blocked/i);
  });
});
