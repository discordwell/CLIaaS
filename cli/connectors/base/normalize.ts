/**
 * Shared normalization utilities for connectors.
 * Eliminates duplicate status/priority mapping, counts initialization,
 * and organization-from-company-name collection patterns.
 */

import type { TicketStatus, TicketPriority, Organization } from '../../schema/types';
import type { ConnectorSource, ExportCounts, StatusMap, PriorityMap } from './types';
import { appendJsonl } from './export-setup';

/**
 * Create a zero-initialized counts object for export.
 * Eliminates the identical `{ tickets: 0, messages: 0, ... }` in every connector.
 */
export function initCounts(extra?: Record<string, number>): ExportCounts {
  return {
    tickets: 0,
    messages: 0,
    customers: 0,
    organizations: 0,
    kbArticles: 0,
    rules: 0,
    ...extra,
  };
}

/**
 * Resolve a status value through a StatusMap.
 * If the map is a Record, does a direct lookup with fallback.
 * If the map is a function, delegates to it directly.
 */
export function resolveStatus(raw: string, map: StatusMap, fallback: TicketStatus = 'open'): TicketStatus {
  if (typeof map === 'function') return map(raw);
  return map[raw] ?? fallback;
}

/**
 * Resolve a priority value through a PriorityMap.
 * If the map is a Record, does a direct lookup with fallback.
 * If the map is a function, delegates to it directly.
 */
export function resolvePriority(raw: string | null, map: PriorityMap, fallback: TicketPriority = 'normal'): TicketPriority {
  if (typeof map === 'function') return map(raw);
  if (raw === null) return fallback;
  return map[raw] ?? fallback;
}

/**
 * Fuzzy status matcher for platforms that return free-text labels (Kayako, Zoho Desk).
 * Checks substrings in the label against common status keywords.
 */
export function fuzzyStatusMatch(label: string): TicketStatus {
  const lower = label.toLowerCase();
  if (lower.includes('new') || lower.includes('open')) return 'open';
  if (lower.includes('pending')) return 'pending';
  if (lower.includes('hold') || lower.includes('wait')) return 'on_hold';
  if (lower.includes('solved') || lower.includes('resolved') || lower.includes('completed')) return 'solved';
  if (lower.includes('closed')) return 'closed';
  return 'open';
}

/**
 * Fuzzy priority matcher for platforms that return free-text labels.
 */
export function fuzzyPriorityMatch(label: string | null): TicketPriority {
  if (!label) return 'normal';
  const lower = label.toLowerCase();
  if (lower.includes('low')) return 'low';
  if (lower.includes('high')) return 'high';
  if (lower.includes('urgent') || lower.includes('critical') || lower.includes('emergency')) return 'urgent';
  return 'normal';
}

/**
 * Collect unique organization names from customer records and write them as
 * Organization entities. Shared by Groove, HelpScout, and HelpCrunch which derive
 * orgs from customer company_name fields rather than a dedicated orgs API.
 */
export function flushCollectedOrgs(
  orgNames: Set<string>,
  prefix: string,
  source: ConnectorSource,
  filePath: string,
  counts: ExportCounts,
): void {
  for (const name of orgNames) {
    const org: Organization = {
      id: `${prefix}-org-${name}`,
      externalId: name,
      source,
      name,
      domains: [],
    };
    appendJsonl(filePath, org);
    counts.organizations++;
  }
}

/**
 * Convert a UNIX epoch (seconds) to ISO 8601 string.
 * Shared by Intercom (number epochs) and HelpCrunch (string epochs).
 */
export function epochToISO(epoch: number | string | null): string {
  if (epoch === null || epoch === undefined) return new Date().toISOString();
  const num = typeof epoch === 'string' ? parseInt(epoch, 10) : epoch;
  if (isNaN(num)) return new Date().toISOString();
  return new Date(num * 1000).toISOString();
}
