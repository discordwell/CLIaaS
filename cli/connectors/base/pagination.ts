/**
 * Shared pagination helpers for connectors.
 * Three patterns cover all 10 connectors.
 */

/** Fetch function type matching ConnectorClient.request or custom fetch. */
export type FetchFn = <T>(path: string, options?: { method?: string; body?: unknown }) => Promise<T>;

/**
 * Page-based pagination (freshdesk, groove, helpscout).
 * Increments a page parameter until results < pageSize.
 */
export async function paginatePages<T>(opts: {
  fetch: FetchFn;
  path: string;
  pageSize?: number;
  /** Response key containing the array (e.g. "tickets", "conversations"). */
  dataKey?: string;
  /** Field name for total pages (helpscout uses "totalPages"). */
  totalPagesKey?: string;
  onPage: (items: T[]) => void | Promise<void>;
}): Promise<void> {
  const { fetch: fetchFn, path, pageSize = 100, dataKey, totalPagesKey, onPage } = opts;
  let page = 1;
  let hasMore = true;

  while (hasMore) {
    const separator = path.includes('?') ? '&' : '?';
    const url = `${path}${separator}per_page=${pageSize}&page=${page}`;
    const response: Record<string, unknown> = await fetchFn<Record<string, unknown>>(url);

    const items = (dataKey ? response[dataKey] : response) as T[];
    if (!Array.isArray(items)) break;

    await onPage(items);

    if (totalPagesKey && typeof response[totalPagesKey] === 'number') {
      hasMore = page < (response[totalPagesKey] as number);
    } else {
      hasMore = items.length >= pageSize;
    }
    page++;
  }
}

/**
 * Cursor-based pagination (zendesk incremental, intercom, hubspot).
 * Follows a cursor/after value until end of stream.
 */
export async function paginateCursor<T>(opts: {
  fetch: FetchFn;
  initialUrl: string;
  /** Extract items from the response. */
  getData: (response: Record<string, unknown>) => T[];
  /** Extract next URL or null from the response. */
  getNextUrl: (response: Record<string, unknown>) => string | null;
  onPage: (items: T[]) => void | Promise<void>;
}): Promise<void> {
  const { fetch: fetchFn, initialUrl, getData, getNextUrl, onPage } = opts;
  let url: string | null = initialUrl;

  while (url) {
    const response: Record<string, unknown> = await fetchFn<Record<string, unknown>>(url);
    const items = getData(response);
    if (items.length > 0) {
      await onPage(items);
    }
    url = getNextUrl(response);
  }
}

/**
 * Offset-based pagination (helpcrunch, zoho-desk, kayako).
 * Increments offset by limit until results < limit.
 */
export async function paginateOffset<T>(opts: {
  fetch: FetchFn;
  path: string;
  limit?: number;
  /** Response key containing the array. */
  dataKey?: string;
  /** Query param name for offset (default: "offset"). */
  offsetParam?: string;
  /** Query param name for limit (default: "limit"). */
  limitParam?: string;
  onPage: (items: T[]) => void | Promise<void>;
}): Promise<void> {
  const {
    fetch: fetchFn,
    path,
    limit = 100,
    dataKey,
    offsetParam = 'offset',
    limitParam = 'limit',
    onPage,
  } = opts;
  let offset = 0;
  let hasMore = true;

  while (hasMore) {
    const separator = path.includes('?') ? '&' : '?';
    const url = `${path}${separator}${offsetParam}=${offset}&${limitParam}=${limit}`;
    const response: Record<string, unknown> = await fetchFn<Record<string, unknown>>(url);

    const items = (dataKey ? response[dataKey] : response) as T[];
    if (!Array.isArray(items)) break;

    await onPage(items);

    hasMore = items.length >= limit;
    offset += limit;
  }
}

/**
 * next_page link pagination (zendesk list endpoints).
 * Follows next_page URL until null.
 */
export async function paginateNextPage<T>(opts: {
  fetch: FetchFn;
  initialUrl: string;
  /** Response key containing the array. */
  dataKey: string;
  /** Response key containing the next page URL (default: "next_page"). */
  nextPageKey?: string;
  onPage: (items: T[]) => void | Promise<void>;
}): Promise<void> {
  const { fetch: fetchFn, initialUrl, dataKey, nextPageKey = 'next_page', onPage } = opts;
  let url: string | null = initialUrl;

  while (url) {
    const response: Record<string, unknown> = await fetchFn<Record<string, unknown>>(url);
    const items = response[dataKey] as T[];
    if (!Array.isArray(items) || items.length === 0) break;

    await onPage(items);

    // Handle nested links (e.g. response.links.next)
    if (nextPageKey.includes('.')) {
      const keys = nextPageKey.split('.');
      let val: unknown = response;
      for (const k of keys) {
        val = (val as Record<string, unknown>)?.[k];
      }
      url = (val as string) ?? null;
    } else {
      url = (response[nextPageKey] as string) ?? null;
    }
  }
}
