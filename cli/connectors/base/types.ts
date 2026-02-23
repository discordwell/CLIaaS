/**
 * Shared types for connector base modules.
 */

/** Function that returns auth headers (sync or async for OAuth2 token refresh). */
export type AuthHeaderFn = () => Record<string, string> | Promise<Record<string, string>>;

/** Configuration for createClient(). */
export interface ClientConfig {
  baseUrl: string;
  authHeaders: AuthHeaderFn;
  /** Source name for error messages (e.g. "Freshdesk", "Zendesk"). */
  sourceName: string;
  /** Max retry attempts on rate-limit (default: 5). */
  maxRetries?: number;
  /** Default Retry-After seconds when header is missing (default: 10). */
  defaultRetryAfterSeconds?: number;
  /** Sleep before each request, in ms (Groove: 2500). */
  preRequestDelayMs?: number;
  /** Extra static headers merged into every request. */
  extraHeaders?: Record<string, string>;
  /** HTTP status codes treated as rate-limit (default: [429]). */
  rateLimitStatuses?: number[];
}

/** Options for individual requests. */
export interface RequestOptions {
  method?: string;
  body?: unknown;
  /** Override default headers for this request. */
  headers?: Record<string, string>;
}

/** All connector source names. */
export type ConnectorSource =
  | 'freshdesk'
  | 'groove'
  | 'helpscout'
  | 'hubspot'
  | 'helpcrunch'
  | 'intercom'
  | 'zoho-desk'
  | 'kayako'
  | 'kayako-classic'
  | 'zendesk';
