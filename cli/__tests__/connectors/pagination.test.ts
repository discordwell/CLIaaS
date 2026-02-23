import { describe, it, expect } from 'vitest';
import { paginatePages, paginateCursor, paginateOffset, paginateNextPage, type FetchFn } from '../../connectors/base/pagination.js';

// Helper: create a mock fetch that returns items from a list of pages
function mockFetchSequence(pages: unknown[]): FetchFn {
  let idx = 0;
  return (async () => pages[idx++]) as FetchFn;
}

describe('paginatePages', () => {
  it('traverses multiple pages until items < pageSize', async () => {
    const collected: number[] = [];

    await paginatePages<number>({
      fetch: mockFetchSequence([[1, 2, 3], [4, 5]]),
      path: '/items',
      pageSize: 3,
      onPage: (items) => { collected.push(...items); },
    });

    expect(collected).toEqual([1, 2, 3, 4, 5]);
  });

  it('handles empty first page', async () => {
    const collected: number[] = [];

    await paginatePages<number>({
      fetch: mockFetchSequence([[]]),
      path: '/items',
      pageSize: 10,
      onPage: (items) => { collected.push(...items); },
    });

    expect(collected).toEqual([]);
  });

  it('handles single page with exact pageSize', async () => {
    const collected: number[] = [];

    await paginatePages<number>({
      fetch: mockFetchSequence([[1, 2, 3], []]),
      path: '/items',
      pageSize: 3,
      onPage: (items) => { collected.push(...items); },
    });

    expect(collected).toEqual([1, 2, 3]);
  });

  it('supports dataKey for wrapped responses', async () => {
    const collected: number[] = [];

    await paginatePages<number>({
      fetch: mockFetchSequence([{ results: [1, 2] }, { results: [] }]),
      path: '/items',
      pageSize: 2,
      dataKey: 'results',
      onPage: (items) => { collected.push(...items); },
    });

    expect(collected).toEqual([1, 2]);
  });
});

describe('paginateCursor', () => {
  it('follows cursor until getNextUrl returns null', async () => {
    const collected: number[] = [];

    await paginateCursor<number>({
      fetch: mockFetchSequence([
        { items: [1, 2], next: '/items?cursor=abc' },
        { items: [3], next: null },
      ]),
      initialUrl: '/items',
      getData: (r) => r.items as number[],
      getNextUrl: (r) => r.next as string | null,
      onPage: (items) => { collected.push(...items); },
    });

    expect(collected).toEqual([1, 2, 3]);
  });

  it('handles empty result on first page', async () => {
    const collected: number[] = [];

    await paginateCursor<number>({
      fetch: mockFetchSequence([{ items: [], next: null }]),
      initialUrl: '/items',
      getData: (r) => r.items as number[],
      getNextUrl: (r) => r.next as string | null,
      onPage: (items) => { collected.push(...items); },
    });

    expect(collected).toEqual([]);
  });
});

describe('paginateOffset', () => {
  it('increments offset until items < limit', async () => {
    const collected: number[] = [];

    await paginateOffset<number>({
      fetch: mockFetchSequence([[1, 2], [3]]),
      path: '/items',
      limit: 2,
      onPage: (items) => { collected.push(...items); },
    });

    expect(collected).toEqual([1, 2, 3]);
  });

  it('handles empty first page', async () => {
    const collected: number[] = [];

    await paginateOffset<number>({
      fetch: mockFetchSequence([[]]),
      path: '/items',
      limit: 10,
      onPage: (items) => { collected.push(...items); },
    });

    expect(collected).toEqual([]);
  });
});

describe('paginateNextPage', () => {
  it('follows next_page links until null', async () => {
    const collected: number[] = [];

    await paginateNextPage<number>({
      fetch: mockFetchSequence([
        { data: [1, 2], next_page: 'https://api.test.com/items?page=2' },
        { data: [3], next_page: null },
      ]),
      initialUrl: '/items',
      dataKey: 'data',
      onPage: (items) => { collected.push(...items); },
    });

    expect(collected).toEqual([1, 2, 3]);
  });

  it('supports nested next page key (links.next)', async () => {
    const collected: number[] = [];

    await paginateNextPage<number>({
      fetch: mockFetchSequence([
        { data: [1], links: { next: '/page2' } },
        { data: [2], links: { next: null } },
      ]),
      initialUrl: '/items',
      dataKey: 'data',
      nextPageKey: 'links.next',
      onPage: (items) => { collected.push(...items); },
    });

    expect(collected).toEqual([1, 2]);
  });
});
