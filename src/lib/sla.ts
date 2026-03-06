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
  businessHoursId?: string;
  enabled: boolean;
  createdAt: string;
}

export interface SLACheckResult {
  ticketId: string;
  policyId: string;
  policyName: string;
  businessHoursId?: string;
  firstResponse: {
    targetMinutes: number;
    elapsedMinutes: number;
    calendarElapsedMinutes?: number;
    businessElapsedMinutes?: number;
    remainingMinutes: number;
    dueAt?: string;
    status: 'ok' | 'warning' | 'breached';
    breachedAt?: string;
  };
  resolution: {
    targetMinutes: number;
    elapsedMinutes: number;
    calendarElapsedMinutes?: number;
    businessElapsedMinutes?: number;
    remainingMinutes: number;
    dueAt?: string;
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

async function loadPoliciesFromDb(workspaceId?: string): Promise<SLAPolicy[]> {
  if (!process.env.DATABASE_URL) return [];
  try {
    const { db } = await import('@/db');
    const schema = await import('@/db/schema');

    let query;
    if (workspaceId) {
      const { eq } = await import('drizzle-orm');
      query = db.select().from(schema.slaPolicies).where(eq(schema.slaPolicies.workspaceId, workspaceId));
    } else {
      query = db.select().from(schema.slaPolicies);
    }
    const rows = await query;
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
        businessHoursId: r.businessHoursId ?? undefined,
        enabled: r.enabled,
        createdAt: r.createdAt.toISOString(),
      };
    });
  } catch {
    return [];
  }
}

// ---- Public API ----

export async function listPolicies(workspaceId?: string): Promise<SLAPolicy[]> {
  if (process.env.DATABASE_URL) {
    try {
      const dbPolicies = await loadPoliciesFromDb(workspaceId);
      if (dbPolicies.length > 0) return dbPolicies;
    } catch {
      // fall through
    }
  }
  ensureDefaults();
  return [...demoPolicies];
}

export async function createPolicy(
  input: Omit<SLAPolicy, 'id' | 'createdAt'>,
  workspaceId?: string,
): Promise<SLAPolicy> {
  if (process.env.DATABASE_URL) {
    try {
      const { db } = await import('@/db');
      const schema = await import('@/db/schema');

      // Use the authenticated user's workspace, fall back to env/first workspace
      let wsId = workspaceId ?? null;
      if (!wsId) {
        const { eq } = await import('drizzle-orm');
        const workspaceName = process.env.CLIAAS_WORKSPACE;
        if (workspaceName) {
          const byName = await db
            .select({ id: schema.workspaces.id })
            .from(schema.workspaces)
            .where(eq(schema.workspaces.name, workspaceName))
            .limit(1);
          wsId = byName[0]?.id ?? null;
        }
        if (!wsId) {
          const rows = await db
            .select({ id: schema.workspaces.id })
            .from(schema.workspaces)
            .orderBy(schema.workspaces.createdAt)
            .limit(1);
          wsId = rows[0]?.id ?? null;
        }
      }

      if (wsId) {
        const [row] = await db
          .insert(schema.slaPolicies)
          .values({
            workspaceId: wsId,
            name: input.name,
            enabled: input.enabled,
            targets: input.targets,
            schedules: {
              conditions: input.conditions,
              escalation: input.escalation,
            },
            businessHoursId: input.businessHoursId ?? null,
          })
          .returning();

        return {
          id: row.id,
          name: row.name,
          conditions: input.conditions,
          targets: input.targets,
          escalation: input.escalation,
          businessHoursId: row.businessHoursId ?? undefined,
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

  // Lazy-load business hours helpers
  let bhCache: Map<string, import('./wfm/types').BusinessHoursConfig> | null = null;
  async function loadBHConfig(bhId: string) {
    if (!bhCache) bhCache = new Map();
    if (bhCache.has(bhId)) return bhCache.get(bhId)!;
    const { getBusinessHours } = await import('./wfm/business-hours');
    const configs = getBusinessHours(bhId);
    const config = configs[0] ?? null;
    if (config) bhCache.set(bhId, config);
    return config;
  }

  for (const policy of enabledPolicies) {
    if (!ticketMatchesPolicy(input.ticket, policy)) continue;

    const createdAt = new Date(input.ticket.createdAt);

    // Load business hours config if policy references one
    let bhConfig: import('./wfm/types').BusinessHoursConfig | null = null;
    if (policy.businessHoursId) {
      bhConfig = await loadBHConfig(policy.businessHoursId);
    }

    // Load business hours calculation functions if needed
    let bhCalc: { getElapsedBusinessMinutes: typeof import('./wfm/business-hours').getElapsedBusinessMinutes; addBusinessMinutes: typeof import('./wfm/business-hours').addBusinessMinutes } | null = null;
    if (bhConfig) {
      bhCalc = await import('./wfm/business-hours');
    }

    // Helper: compute elapsed minutes (business or calendar)
    function computeElapsed(fromDate: Date, toDate: Date): { elapsed: number; calendarElapsed: number; businessElapsed?: number } {
      const calendarMs = toDate.getTime() - fromDate.getTime();
      const calendarMin = calendarMs / 60000;
      if (!bhConfig || !bhCalc) return { elapsed: calendarMin, calendarElapsed: calendarMin };
      const bizMin = bhCalc.getElapsedBusinessMinutes(bhConfig, fromDate, toDate);
      return { elapsed: bizMin, calendarElapsed: calendarMin, businessElapsed: bizMin };
    }

    // Helper: compute SLA due date
    function computeDueAt(fromDate: Date, targetMinutes: number): string | undefined {
      if (!bhConfig || !bhCalc) return undefined;
      return bhCalc.addBusinessMinutes(bhConfig, fromDate, targetMinutes).toISOString();
    }

    // First response check
    const frTargetMin = policy.targets.firstResponse;
    const frTargetMs = frTargetMin * 60 * 1000;
    let frElapsedMin: number;
    let frCalendarElapsed: number | undefined;
    let frBusinessElapsed: number | undefined;
    let frStatus: 'ok' | 'warning' | 'breached';
    let frBreachedAt: string | undefined;
    const frDueAt = computeDueAt(createdAt, frTargetMin);

    if (input.firstReplyAt) {
      const e = computeElapsed(createdAt, new Date(input.firstReplyAt));
      frElapsedMin = e.elapsed;
      frCalendarElapsed = e.calendarElapsed;
      frBusinessElapsed = e.businessElapsed;
      frStatus = frElapsedMin > frTargetMin ? 'breached' : 'ok';
      if (frStatus === 'breached') {
        frBreachedAt = frDueAt ?? new Date(createdAt.getTime() + frTargetMs).toISOString();
      }
    } else if (input.ticket.status === 'solved' || input.ticket.status === 'closed') {
      const e = computeElapsed(createdAt, new Date(input.ticket.updatedAt));
      frElapsedMin = e.elapsed;
      frCalendarElapsed = e.calendarElapsed;
      frBusinessElapsed = e.businessElapsed;
      frStatus = frElapsedMin > frTargetMin ? 'breached' : 'ok';
    } else {
      const e = computeElapsed(createdAt, now);
      frElapsedMin = e.elapsed;
      frCalendarElapsed = e.calendarElapsed;
      frBusinessElapsed = e.businessElapsed;
      if (frElapsedMin > frTargetMin) {
        frStatus = 'breached';
        frBreachedAt = frDueAt ?? new Date(createdAt.getTime() + frTargetMs).toISOString();
      } else if (frElapsedMin > frTargetMin * 0.75) {
        frStatus = 'warning';
      } else {
        frStatus = 'ok';
      }
    }

    // Resolution check
    const resTargetMin = policy.targets.resolution;
    const resTargetMs = resTargetMin * 60 * 1000;
    let resElapsedMin: number;
    let resCalendarElapsed: number | undefined;
    let resBusinessElapsed: number | undefined;
    let resStatus: 'ok' | 'warning' | 'breached';
    let resBreachedAt: string | undefined;
    const resDueAt = computeDueAt(createdAt, resTargetMin);

    if (input.resolvedAt || input.ticket.status === 'solved' || input.ticket.status === 'closed') {
      const resolvedDate = input.resolvedAt
        ? new Date(input.resolvedAt)
        : new Date(input.ticket.updatedAt);
      const e = computeElapsed(createdAt, resolvedDate);
      resElapsedMin = e.elapsed;
      resCalendarElapsed = e.calendarElapsed;
      resBusinessElapsed = e.businessElapsed;
      resStatus = resElapsedMin > resTargetMin ? 'breached' : 'ok';
      if (resStatus === 'breached') {
        resBreachedAt = resDueAt ?? new Date(createdAt.getTime() + resTargetMs).toISOString();
      }
    } else {
      const e = computeElapsed(createdAt, now);
      resElapsedMin = e.elapsed;
      resCalendarElapsed = e.calendarElapsed;
      resBusinessElapsed = e.businessElapsed;
      if (resElapsedMin > resTargetMin) {
        resStatus = 'breached';
        resBreachedAt = resDueAt ?? new Date(createdAt.getTime() + resTargetMs).toISOString();
      } else if (resElapsedMin > resTargetMin * 0.75) {
        resStatus = 'warning';
      } else {
        resStatus = 'ok';
      }
    }

    // Escalation checks — use business elapsed if available
    const maxElapsedMinutes = Math.max(frElapsedMin, resElapsedMin);
    const escalations = policy.escalation.map((esc) => ({
      ...esc,
      triggered: maxElapsedMinutes >= esc.afterMinutes,
    }));

    results.push({
      ticketId: input.ticket.id,
      policyId: policy.id,
      policyName: policy.name,
      businessHoursId: policy.businessHoursId,
      firstResponse: {
        targetMinutes: frTargetMin,
        elapsedMinutes: Math.round(frElapsedMin),
        calendarElapsedMinutes: frCalendarElapsed != null ? Math.round(frCalendarElapsed) : undefined,
        businessElapsedMinutes: frBusinessElapsed != null ? Math.round(frBusinessElapsed) : undefined,
        remainingMinutes: Math.max(0, Math.round(frTargetMin - frElapsedMin)),
        dueAt: frDueAt,
        status: frStatus,
        breachedAt: frBreachedAt,
      },
      resolution: {
        targetMinutes: resTargetMin,
        elapsedMinutes: Math.round(resElapsedMin),
        calendarElapsedMinutes: resCalendarElapsed != null ? Math.round(resCalendarElapsed) : undefined,
        businessElapsedMinutes: resBusinessElapsed != null ? Math.round(resBusinessElapsed) : undefined,
        remainingMinutes: Math.max(0, Math.round(resTargetMin - resElapsedMin)),
        dueAt: resDueAt,
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
