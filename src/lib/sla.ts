import type { Ticket } from '@/lib/data';

// ---- Types ----

export interface SLAPolicy {
  id: string;
  name: string;
  conditions: {
    priority?: string[];
    tags?: string[];
    source?: string[];
  };
  targets: {
    firstResponse: number; // minutes
    resolution: number;    // minutes
  };
  escalation: Array<{
    afterMinutes: number;
    action: 'notify' | 'escalate' | 'reassign';
    to?: string;
  }>;
  enabled: boolean;
  createdAt: string;
}

export interface SLACheckResult {
  ticketId: string;
  policyId: string;
  policyName: string;
  firstResponse: {
    targetMinutes: number;
    elapsedMinutes: number;
    remainingMinutes: number;
    status: 'ok' | 'warning' | 'breached';
    breachedAt?: string;
  };
  resolution: {
    targetMinutes: number;
    elapsedMinutes: number;
    remainingMinutes: number;
    status: 'ok' | 'warning' | 'breached';
    breachedAt?: string;
  };
  escalations: Array<{
    afterMinutes: number;
    action: 'notify' | 'escalate' | 'reassign';
    to?: string;
    triggered: boolean;
  }>;
}

// ---- In-memory policy store (demo mode) ----

const demoPolicies: SLAPolicy[] = [];

// Default policies loaded on first access
let defaultsLoaded = false;

function ensureDefaults(): void {
  if (defaultsLoaded) return;
  defaultsLoaded = true;

  demoPolicies.push(
    {
      id: 'sla-urgent',
      name: 'Urgent Priority',
      conditions: { priority: ['urgent'] },
      targets: { firstResponse: 15, resolution: 240 },
      escalation: [
        { afterMinutes: 10, action: 'notify', to: 'manager' },
        { afterMinutes: 30, action: 'escalate', to: 'senior-agent' },
        { afterMinutes: 120, action: 'reassign', to: 'manager' },
      ],
      enabled: true,
      createdAt: new Date().toISOString(),
    },
    {
      id: 'sla-high',
      name: 'High Priority',
      conditions: { priority: ['high'] },
      targets: { firstResponse: 60, resolution: 480 },
      escalation: [
        { afterMinutes: 45, action: 'notify', to: 'team-lead' },
        { afterMinutes: 120, action: 'escalate', to: 'senior-agent' },
      ],
      enabled: true,
      createdAt: new Date().toISOString(),
    },
    {
      id: 'sla-normal',
      name: 'Normal Priority',
      conditions: { priority: ['normal'] },
      targets: { firstResponse: 240, resolution: 1440 },
      escalation: [
        { afterMinutes: 180, action: 'notify', to: 'team-lead' },
      ],
      enabled: true,
      createdAt: new Date().toISOString(),
    },
    {
      id: 'sla-low',
      name: 'Low Priority',
      conditions: { priority: ['low'] },
      targets: { firstResponse: 480, resolution: 2880 },
      escalation: [],
      enabled: true,
      createdAt: new Date().toISOString(),
    }
  );
}

// ---- DB helpers ----

async function loadPoliciesFromDb(): Promise<SLAPolicy[]> {
  if (!process.env.DATABASE_URL) return [];
  try {
    const { db } = await import('@/db');
    const schema = await import('@/db/schema');
    const rows = await db
      .select()
      .from(schema.slaPolicies);
    return rows.map((r) => {
      const targets = (r.targets as Record<string, number>) ?? {};
      const schedules = (r.schedules as Record<string, unknown>) ?? {};
      return {
        id: r.id,
        name: r.name,
        conditions: (schedules.conditions as SLAPolicy['conditions']) ?? {},
        targets: {
          firstResponse: targets.firstResponse ?? 60,
          resolution: targets.resolution ?? 1440,
        },
        escalation: ((schedules.escalation as SLAPolicy['escalation']) ?? []),
        enabled: r.enabled,
        createdAt: r.createdAt.toISOString(),
      };
    });
  } catch {
    return [];
  }
}

// ---- Public API ----

export async function listPolicies(): Promise<SLAPolicy[]> {
  if (process.env.DATABASE_URL) {
    try {
      const dbPolicies = await loadPoliciesFromDb();
      if (dbPolicies.length > 0) return dbPolicies;
    } catch {
      // fall through
    }
  }
  ensureDefaults();
  return [...demoPolicies];
}

export async function createPolicy(
  input: Omit<SLAPolicy, 'id' | 'createdAt'>
): Promise<SLAPolicy> {
  if (process.env.DATABASE_URL) {
    try {
      const { db } = await import('@/db');
      const schema = await import('@/db/schema');
      const { eq } = await import('drizzle-orm');

      // Get workspace
      const workspaceName = process.env.CLIAAS_WORKSPACE;
      let workspaceId: string | null = null;
      if (workspaceName) {
        const byName = await db
          .select({ id: schema.workspaces.id })
          .from(schema.workspaces)
          .where(eq(schema.workspaces.name, workspaceName))
          .limit(1);
        workspaceId = byName[0]?.id ?? null;
      }
      if (!workspaceId) {
        const rows = await db
          .select({ id: schema.workspaces.id })
          .from(schema.workspaces)
          .orderBy(schema.workspaces.createdAt)
          .limit(1);
        workspaceId = rows[0]?.id ?? null;
      }

      if (workspaceId) {
        const [row] = await db
          .insert(schema.slaPolicies)
          .values({
            workspaceId,
            name: input.name,
            enabled: input.enabled,
            targets: input.targets,
            schedules: {
              conditions: input.conditions,
              escalation: input.escalation,
            },
          })
          .returning();

        return {
          id: row.id,
          name: row.name,
          conditions: input.conditions,
          targets: input.targets,
          escalation: input.escalation,
          enabled: row.enabled,
          createdAt: row.createdAt.toISOString(),
        };
      }
    } catch {
      // fall through to demo mode
    }
  }

  ensureDefaults();
  const policy: SLAPolicy = {
    ...input,
    id: `sla-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    createdAt: new Date().toISOString(),
  };
  demoPolicies.push(policy);
  return policy;
}

// ---- SLA check engine ----

function ticketMatchesPolicy(ticket: Ticket, policy: SLAPolicy): boolean {
  const { conditions } = policy;

  if (conditions.priority && conditions.priority.length > 0) {
    if (!conditions.priority.includes(ticket.priority)) return false;
  }

  if (conditions.tags && conditions.tags.length > 0) {
    const hasMatchingTag = conditions.tags.some((tag) => ticket.tags.includes(tag));
    if (!hasMatchingTag) return false;
  }

  if (conditions.source && conditions.source.length > 0) {
    if (!conditions.source.includes(ticket.source)) return false;
  }

  return true;
}

export interface CheckTicketInput {
  ticket: Ticket;
  firstReplyAt?: string | null; // ISO timestamp of first agent reply
  resolvedAt?: string | null;   // ISO timestamp of resolution
}

export async function checkTicketSLA(input: CheckTicketInput): Promise<SLACheckResult[]> {
  const policies = await listPolicies();
  const enabledPolicies = policies.filter((p) => p.enabled);
  const results: SLACheckResult[] = [];
  const now = new Date();

  for (const policy of enabledPolicies) {
    if (!ticketMatchesPolicy(input.ticket, policy)) continue;

    const createdAt = new Date(input.ticket.createdAt);

    // First response check
    const frTargetMs = policy.targets.firstResponse * 60 * 1000;
    let frElapsedMs: number;
    let frStatus: 'ok' | 'warning' | 'breached';
    let frBreachedAt: string | undefined;

    if (input.firstReplyAt) {
      // Already replied
      frElapsedMs = new Date(input.firstReplyAt).getTime() - createdAt.getTime();
      frStatus = frElapsedMs > frTargetMs ? 'breached' : 'ok';
      if (frStatus === 'breached') {
        frBreachedAt = new Date(createdAt.getTime() + frTargetMs).toISOString();
      }
    } else if (input.ticket.status === 'solved' || input.ticket.status === 'closed') {
      // Resolved without tracked first reply
      frElapsedMs = new Date(input.ticket.updatedAt).getTime() - createdAt.getTime();
      frStatus = frElapsedMs > frTargetMs ? 'breached' : 'ok';
    } else {
      // Still waiting for first response
      frElapsedMs = now.getTime() - createdAt.getTime();
      if (frElapsedMs > frTargetMs) {
        frStatus = 'breached';
        frBreachedAt = new Date(createdAt.getTime() + frTargetMs).toISOString();
      } else if (frElapsedMs > frTargetMs * 0.75) {
        frStatus = 'warning';
      } else {
        frStatus = 'ok';
      }
    }

    // Resolution check
    const resTargetMs = policy.targets.resolution * 60 * 1000;
    let resElapsedMs: number;
    let resStatus: 'ok' | 'warning' | 'breached';
    let resBreachedAt: string | undefined;

    if (input.resolvedAt || input.ticket.status === 'solved' || input.ticket.status === 'closed') {
      const resolvedTime = input.resolvedAt
        ? new Date(input.resolvedAt).getTime()
        : new Date(input.ticket.updatedAt).getTime();
      resElapsedMs = resolvedTime - createdAt.getTime();
      resStatus = resElapsedMs > resTargetMs ? 'breached' : 'ok';
      if (resStatus === 'breached') {
        resBreachedAt = new Date(createdAt.getTime() + resTargetMs).toISOString();
      }
    } else {
      resElapsedMs = now.getTime() - createdAt.getTime();
      if (resElapsedMs > resTargetMs) {
        resStatus = 'breached';
        resBreachedAt = new Date(createdAt.getTime() + resTargetMs).toISOString();
      } else if (resElapsedMs > resTargetMs * 0.75) {
        resStatus = 'warning';
      } else {
        resStatus = 'ok';
      }
    }

    // Escalation checks
    const maxElapsedMs = Math.max(frElapsedMs, resElapsedMs);
    const maxElapsedMinutes = maxElapsedMs / (60 * 1000);
    const escalations = policy.escalation.map((esc) => ({
      ...esc,
      triggered: maxElapsedMinutes >= esc.afterMinutes,
    }));

    results.push({
      ticketId: input.ticket.id,
      policyId: policy.id,
      policyName: policy.name,
      firstResponse: {
        targetMinutes: policy.targets.firstResponse,
        elapsedMinutes: Math.round(frElapsedMs / (60 * 1000)),
        remainingMinutes: Math.max(0, Math.round((frTargetMs - frElapsedMs) / (60 * 1000))),
        status: frStatus,
        breachedAt: frBreachedAt,
      },
      resolution: {
        targetMinutes: policy.targets.resolution,
        elapsedMinutes: Math.round(resElapsedMs / (60 * 1000)),
        remainingMinutes: Math.max(0, Math.round((resTargetMs - resElapsedMs) / (60 * 1000))),
        status: resStatus,
        breachedAt: resBreachedAt,
      },
      escalations,
    });
  }

  return results;
}

// ---- Bulk SLA check ----

export async function checkAllTicketsSLA(
  tickets: Ticket[],
  messages?: Array<{ ticketId: string; author: string; type: string; createdAt: string }>
): Promise<SLACheckResult[]> {
  const messagesByTicket = new Map<string, typeof messages>();
  if (messages) {
    for (const m of messages) {
      const existing = messagesByTicket.get(m.ticketId) ?? [];
      existing.push(m);
      messagesByTicket.set(m.ticketId, existing);
    }
  }

  const allResults: SLACheckResult[] = [];

  for (const ticket of tickets) {
    const ticketMessages = messagesByTicket.get(ticket.id) ?? [];
    const sortedMsgs = [...ticketMessages].sort(
      (a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime()
    );
    const firstReply = sortedMsgs.find(
      (m) => m.type === 'reply' && m.author !== ticket.requester
    );

    const results = await checkTicketSLA({
      ticket,
      firstReplyAt: firstReply?.createdAt ?? null,
      resolvedAt: (ticket.status === 'solved' || ticket.status === 'closed')
        ? ticket.updatedAt
        : null,
    });

    allResults.push(...results);
  }

  return allResults;
}

// ---- Format helpers ----

export function formatMinutes(minutes: number): string {
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  const mins = minutes % 60;
  if (hours < 24) return mins > 0 ? `${hours}h ${mins}m` : `${hours}h`;
  const days = Math.floor(hours / 24);
  const remainHours = hours % 24;
  return remainHours > 0 ? `${days}d ${remainHours}h` : `${days}d`;
}
