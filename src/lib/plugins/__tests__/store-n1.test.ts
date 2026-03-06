import { describe, it, expect, vi, beforeEach } from 'vitest';

// Track readJsonlFile calls
const readJsonlMock = vi.fn().mockReturnValue([]);
const writeJsonlMock = vi.fn();

vi.mock('../../jsonl-store', () => ({
  readJsonlFile: (...args: unknown[]) => readJsonlMock(...args),
  writeJsonlFile: (...args: unknown[]) => writeJsonlMock(...args),
}));

vi.mock('../../store-helpers', () => ({
  tryDb: vi.fn().mockResolvedValue(null), // force JSONL path
  getDefaultWorkspaceId: vi.fn().mockResolvedValue('default'),
}));

import { getEnabledInstallationsForHook } from '../store';

describe('getEnabledInstallationsForHook N+1 fix', () => {
  beforeEach(() => {
    readJsonlMock.mockReset();
    readJsonlMock.mockImplementation((file: string) => {
      if (file === 'plugin-installations.jsonl') {
        return [
          { id: '1', pluginId: 'p1', enabled: true, config: {} },
          { id: '2', pluginId: 'p2', enabled: true, config: {} },
          { id: '3', pluginId: 'p3', enabled: false, config: {} },
        ];
      }
      if (file === 'marketplace-listings.jsonl') {
        return [
          { pluginId: 'p1', manifest: { hooks: ['ticket.created'] } },
          { pluginId: 'p2', manifest: { hooks: ['ticket.updated'] } },
        ];
      }
      return [];
    });
  });

  it('reads marketplace-listings.jsonl only once (not per installation)', async () => {
    await getEnabledInstallationsForHook('ticket.created');

    // Should read installations once + listings once = 2 calls total
    const listingCalls = readJsonlMock.mock.calls.filter(
      (c: unknown[]) => c[0] === 'marketplace-listings.jsonl'
    );
    expect(listingCalls).toHaveLength(1);
  });

  it('returns only installations matching the hook', async () => {
    const results = await getEnabledInstallationsForHook('ticket.created');
    expect(results).toHaveLength(1);
    expect(results[0].pluginId).toBe('p1');
  });

  it('skips disabled installations', async () => {
    const results = await getEnabledInstallationsForHook('ticket.updated');
    expect(results).toHaveLength(1);
    expect(results[0].pluginId).toBe('p2');
  });
});
