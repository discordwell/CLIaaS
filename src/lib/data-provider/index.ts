/**
 * DataProvider factory — returns the correct provider based on environment/config.
 *
 * Resolution order:
 *   1. Explicit CLIAAS_MODE env var ('local' | 'db' | 'remote' | 'hybrid')
 *   2. DATABASE_URL present → 'db'
 *   3. Fallback → 'local' (JSONL)
 */

export type { DataProvider, DataMode, ProviderCapabilities } from './types';
export type {
  Ticket,
  Message,
  KBArticle,
  Customer,
  Organization,
  RuleRecord,
  CSATRating,
  TicketCreateParams,
  TicketUpdateParams,
  MessageCreateParams,
  KBArticleCreateParams,
} from './types';

import type { DataProvider, DataMode } from './types';
import { JsonlProvider } from './jsonl-provider';

let _cached: DataProvider | null = null;
let _cachedMode: DataMode | null = null;

/**
 * Detect the current data mode from environment.
 */
export function detectDataMode(): DataMode {
  const explicit = process.env.CLIAAS_MODE as DataMode | undefined;
  if (explicit && ['local', 'db', 'remote', 'hybrid'].includes(explicit)) {
    return explicit;
  }
  if (process.env.DATABASE_URL) return 'db';
  return 'local';
}

/**
 * Get the singleton DataProvider for the current mode.
 * Pass `dir` to override the JSONL export directory (for MCP `dir` param).
 *
 * If `dir` is provided, returns a fresh (non-cached) JsonlProvider
 * regardless of the detected mode, since the directory override is per-call.
 */
export async function getDataProvider(dir?: string): Promise<DataProvider> {
  const mode = detectDataMode();

  // dir override → always fresh JsonlProvider regardless of mode
  if (dir) {
    return new JsonlProvider(dir);
  }

  if (_cached && _cachedMode === mode) return _cached;

  let provider: DataProvider;

  switch (mode) {
    case 'db': {
      const { DbProvider } = await import('./db-provider');
      provider = new DbProvider();
      break;
    }
    case 'remote': {
      const { RemoteProvider } = await import('./remote-provider');
      provider = new RemoteProvider();
      break;
    }
    case 'hybrid': {
      const { HybridProvider } = await import('./hybrid-provider');
      provider = new HybridProvider();
      break;
    }
    case 'local':
    default:
      provider = new JsonlProvider();
      break;
  }

  _cached = provider;
  _cachedMode = mode;
  return provider;
}

/**
 * Reset the cached provider (useful for tests or config changes).
 */
export function resetDataProvider(): void {
  _cached = null;
  _cachedMode = null;
}
