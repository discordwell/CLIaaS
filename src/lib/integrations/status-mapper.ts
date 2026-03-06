/**
 * Bidirectional status mapping between CLIaaS ticket statuses and external systems.
 * Configurable per workspace — different teams use different Jira workflows.
 */

export type CLIaaSStatus = 'open' | 'pending' | 'on_hold' | 'solved' | 'closed';

export interface StatusMapping {
  externalStatus: string;
  cliaasStatus: CLIaaSStatus;
}

export interface StatusMapConfig {
  provider: 'jira' | 'linear' | 'github';
  mappings: StatusMapping[];
}

// ---- Default Mappings ----

export const DEFAULT_JIRA_MAPPINGS: StatusMapping[] = [
  { externalStatus: 'To Do', cliaasStatus: 'open' },
  { externalStatus: 'Open', cliaasStatus: 'open' },
  { externalStatus: 'Backlog', cliaasStatus: 'open' },
  { externalStatus: 'In Progress', cliaasStatus: 'pending' },
  { externalStatus: 'In Review', cliaasStatus: 'pending' },
  { externalStatus: 'Blocked', cliaasStatus: 'on_hold' },
  { externalStatus: 'Done', cliaasStatus: 'solved' },
  { externalStatus: 'Resolved', cliaasStatus: 'solved' },
  { externalStatus: 'Closed', cliaasStatus: 'closed' },
  { externalStatus: 'Won\'t Do', cliaasStatus: 'closed' },
];

export const DEFAULT_LINEAR_MAPPINGS: StatusMapping[] = [
  { externalStatus: 'Backlog', cliaasStatus: 'open' },
  { externalStatus: 'Todo', cliaasStatus: 'open' },
  { externalStatus: 'Triage', cliaasStatus: 'open' },
  { externalStatus: 'In Progress', cliaasStatus: 'pending' },
  { externalStatus: 'In Review', cliaasStatus: 'pending' },
  { externalStatus: 'Done', cliaasStatus: 'solved' },
  { externalStatus: 'Cancelled', cliaasStatus: 'closed' },
  { externalStatus: 'Duplicate', cliaasStatus: 'closed' },
];

export const DEFAULT_GITHUB_MAPPINGS: StatusMapping[] = [
  { externalStatus: 'open', cliaasStatus: 'open' },
  { externalStatus: 'closed', cliaasStatus: 'solved' },
];

const DEFAULT_CONFIGS: Record<string, StatusMapping[]> = {
  jira: DEFAULT_JIRA_MAPPINGS,
  linear: DEFAULT_LINEAR_MAPPINGS,
  github: DEFAULT_GITHUB_MAPPINGS,
};

// ---- Reverse Mapping (CLIaaS → External) ----

const CLIAAS_TO_JIRA: Record<CLIaaSStatus, string> = {
  open: 'To Do',
  pending: 'In Progress',
  on_hold: 'Blocked',
  solved: 'Done',
  closed: 'Closed',
};

const CLIAAS_TO_LINEAR: Record<CLIaaSStatus, string> = {
  open: 'Todo',
  pending: 'In Progress',
  on_hold: 'In Progress',
  solved: 'Done',
  closed: 'Cancelled',
};

const CLIAAS_TO_GITHUB: Record<CLIaaSStatus, string> = {
  open: 'open',
  pending: 'open',
  on_hold: 'open',
  solved: 'closed',
  closed: 'closed',
};

const REVERSE_MAPS: Record<string, Record<CLIaaSStatus, string>> = {
  jira: CLIAAS_TO_JIRA,
  linear: CLIAAS_TO_LINEAR,
  github: CLIAAS_TO_GITHUB,
};

// ---- API ----

/**
 * Map an external status to a CLIaaS status.
 * Uses custom mappings if provided, otherwise falls back to defaults.
 */
export function mapToCliaas(
  provider: string,
  externalStatus: string,
  customMappings?: StatusMapping[],
): CLIaaSStatus | null {
  const mappings = customMappings ?? DEFAULT_CONFIGS[provider] ?? [];
  const normalizedExternal = externalStatus.toLowerCase().trim();

  // Exact match first
  const exact = mappings.find(m => m.externalStatus.toLowerCase() === normalizedExternal);
  if (exact) return exact.cliaasStatus;

  // Fuzzy match — contains check
  const fuzzy = mappings.find(m => normalizedExternal.includes(m.externalStatus.toLowerCase()));
  if (fuzzy) return fuzzy.cliaasStatus;

  return null;
}

/**
 * Map a CLIaaS status to an external status.
 */
export function mapFromCliaas(
  provider: string,
  cliaasStatus: CLIaaSStatus,
  customMappings?: StatusMapping[],
): string | null {
  if (customMappings) {
    const match = customMappings.find(m => m.cliaasStatus === cliaasStatus);
    if (match) return match.externalStatus;
  }
  const reverseMap = REVERSE_MAPS[provider];
  return reverseMap?.[cliaasStatus] ?? null;
}

/**
 * Get the default mappings for a provider.
 */
export function getDefaultMappings(provider: string): StatusMapping[] {
  return DEFAULT_CONFIGS[provider] ?? [];
}
