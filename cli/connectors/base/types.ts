/**
 * Shared types for connector base modules.
 */

import type { TicketStatus, TicketPriority } from '../../schema/types';

/** Function that returns auth headers (sync or async for OAuth2 token refresh). */
export type AuthHeaderFn = () => Record<string, string> | Promise<Record<string, string>>;

/**
 * Middleware invoked after every successful JSON response.
 * Use this to capture session IDs or other response-level data (e.g. Kayako X-Session-ID).
 */
export type ResponseMiddleware = (json: unknown, res: Response) => void;

/**
 * Custom error handler invoked on non-OK, non-rate-limit responses before the
 * default error is thrown. Return an Error to throw it instead of the default.
 * Return null to fall through to the default error handler.
 */
export type ErrorHandler = (res: Response, body: string) => Error | null;

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
  /** Middleware invoked after every successful JSON parse (e.g. to capture session IDs). */
  responseMiddleware?: ResponseMiddleware;
  /** Custom error handler for non-OK responses (e.g. Kayako MFA 403 handling). */
  errorHandler?: ErrorHandler;
}

/** Options for individual requests. */
export interface RequestOptions {
  method?: string;
  body?: unknown;
  /** Override default headers for this request. */
  headers?: Record<string, string>;
}

/**
 * Mapping definition for status/priority normalization.
 * Can be a simple lookup map or a function for complex matching (e.g. substring checks).
 */
export type StatusMap = Record<string, TicketStatus> | ((raw: string) => TicketStatus);
export type PriorityMap = Record<string, TicketPriority> | ((raw: string | null) => TicketPriority);

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

/** Standard export counts structure shared across all connectors. */
export interface ExportCounts {
  tickets: number;
  messages: number;
  customers: number;
  organizations: number;
  kbArticles: number;
  rules: number;
  [key: string]: number;
}
