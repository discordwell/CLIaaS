import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { MarketplaceListing, PluginManifestV2 } from '../types';

const mockRead = vi.fn().mockReturnValue([]);
const mockWrite = vi.fn();

vi.mock('@/lib/jsonl-store', () => ({
  readJsonlFile: (...args: unknown[]) => mockRead(...(args as [])),
  writeJsonlFile: (...args: unknown[]) => mockWrite(...(args as [])),
}));

vi.mock('@/db', () => ({ getDb: () => null }));

const { getListings, getListing, upsertListing, getReviews, upsertReview, incrementInstallCount, recalculateRating } =
  await import('../marketplace-store');

const testManifest: PluginManifestV2 = {
  id: 'test-plugin',
  name: 'Test Plugin',
  version: '1.0.0',
  description: 'A test plugin',
  author: 'Test',
  hooks: ['ticket.created'],
  permissions: ['tickets:read'],
  actions: [],
  uiSlots: [],
  oauthRequirements: [],
  runtime: 'node',
};

function makeListing(overrides: Partial<MarketplaceListing> = {}): MarketplaceListing {
  return {
    id: 'listing-1',
    pluginId: 'test-plugin',
    manifest: testManifest,
    status: 'published',
    installCount: 0,
    averageRating: null,
    reviewCount: 0,
    featured: false,
    createdAt: '2026-01-01T00:00:00Z',
    updatedAt: '2026-01-01T00:00:00Z',
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  mockRead.mockReturnValue([]);
});

describe('getListings', () => {
  it('returns published listings by default', async () => {
    mockRead.mockReturnValue([
      makeListing({ status: 'published' }),
      makeListing({ id: 'listing-2', pluginId: 'draft-plugin', status: 'draft' }),
    ]);
    const result = await getListings();
    expect(result).toHaveLength(1);
    expect(result[0].pluginId).toBe('test-plugin');
  });

  it('filters by search', async () => {
    mockRead.mockReturnValue([makeListing()]);
    const result = await getListings({ search: 'nonexistent' });
    expect(result).toHaveLength(0);
  });

  it('finds by search term', async () => {
    mockRead.mockReturnValue([makeListing()]);
    const result = await getListings({ search: 'test' });
    expect(result).toHaveLength(1);
  });
});

describe('getListing', () => {
  it('returns null for missing plugin', async () => {
    const result = await getListing('nope');
    expect(result).toBeNull();
  });

  it('finds by pluginId', async () => {
    mockRead.mockReturnValue([makeListing()]);
    const result = await getListing('test-plugin');
    expect(result?.manifest.name).toBe('Test Plugin');
  });
});

describe('upsertListing', () => {
  it('creates a new listing', async () => {
    const result = await upsertListing({
      pluginId: 'new-plugin',
      manifest: { ...testManifest, id: 'new-plugin', name: 'New' },
    });
    expect(result.pluginId).toBe('new-plugin');
    expect(result.status).toBe('published');
    expect(mockWrite).toHaveBeenCalled();
  });

  it('updates an existing listing', async () => {
    mockRead.mockReturnValue([makeListing()]);
    const result = await upsertListing({
      pluginId: 'test-plugin',
      manifest: { ...testManifest, version: '2.0.0' },
    });
    expect(result.manifest.version).toBe('2.0.0');
  });
});

describe('incrementInstallCount', () => {
  it('increments count', async () => {
    mockRead.mockReturnValue([makeListing({ installCount: 5 })]);
    await incrementInstallCount('test-plugin');
    const writeArgs = mockWrite.mock.calls[0];
    expect(writeArgs[1][0].installCount).toBe(6);
  });
});

describe('reviews', () => {
  it('returns empty reviews for new listing', async () => {
    const reviews = await getReviews('listing-1');
    expect(reviews).toEqual([]);
  });
});
