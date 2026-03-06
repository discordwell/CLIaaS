/**
 * Report execution engine — branches on JSONL vs DB mode.
 * JSONL: loads via getDataProvider(), filters in-memory.
 * DB: Drizzle queries with WHERE/GROUP BY.
 * Returns { columns, rows, summary }.
 */

import { getMetric, type MetricDefinition } from './metrics';
import type { Ticket, Message } from '@/lib/data-provider/types';

export interface ReportDefinition {
  metric: string;
  groupBy?: string[];
  filters?: Record<string, unknown>;
  visualization?: string;
  formula?: string;
}

export interface DateRange {
  from: string; // ISO date string
  to: string;
}

export interface ReportResult {
  columns: string[];
  rows: Array<Record<string, unknown>>;
  summary: Record<string, number>;
  metric: string;
  dateRange?: DateRange;
}

function hoursBetween(a: string, b: string): number {
  return Math.abs(new Date(b).getTime() - new Date(a).getTime()) / (1000 * 60 * 60);
}

function toDateKey(d: Date): string {
  return d.toISOString().slice(0, 10);
}

function filterTicketsByDateRange(tickets: Ticket[], range?: DateRange): Ticket[] {
  if (!range) return tickets;
  const fromMs = new Date(range.from).getTime();
  const toMs = new Date(range.to + 'T23:59:59Z').getTime();
  return tickets.filter(t => {
    const ms = new Date(t.createdAt).getTime();
    return ms >= fromMs && ms <= toMs;
  });
}

function applyFilters(tickets: Ticket[], filters?: Record<string, unknown>): Ticket[] {
  if (!filters) return tickets;
  let result = tickets;
  if (filters.status) {
    result = result.filter(t => t.status === filters.status);
  }
  if (filters.priority) {
    result = result.filter(t => t.priority === filters.priority);
  }
  if (filters.assignee) {
    result = result.filter(t => t.assignee === filters.assignee);
  }
  if (filters.tag) {
    const tag = String(filters.tag);
    result = result.filter(t => t.tags?.includes(tag));
  }
  if (filters.source) {
    result = result.filter(t => t.source === filters.source);
  }
  return result;
}

function groupTickets(tickets: Ticket[], groupBy: string): Map<string, Ticket[]> {
  const groups = new Map<string, Ticket[]>();
  for (const t of tickets) {
    let key: string;
    switch (groupBy) {
      case 'date':
        key = toDateKey(new Date(t.createdAt));
        break;
      case 'status':
        key = t.status;
        break;
      case 'priority':
        key = t.priority;
        break;
      case 'channel':
        key = t.source?.includes('chat') ? 'chat' : 'email';
        break;
      case 'assignee':
        key = t.assignee ?? 'unassigned';
        break;
      case 'source':
        key = t.source ?? 'unknown';
        break;
      case 'tag':
        // Expand into multiple groups for each tag
        for (const tag of (t.tags ?? [])) {
          const existing = groups.get(tag) ?? [];
          existing.push(t);
          groups.set(tag, existing);
        }
        continue;
      default:
        key = 'all';
    }
    const existing = groups.get(key) ?? [];
    existing.push(t);
    groups.set(key, existing);
  }
  return groups;
}

function median(arr: number[]): number {
  if (arr.length === 0) return 0;
  const sorted = [...arr].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0
    ? Math.round(((sorted[mid - 1] + sorted[mid]) / 2) * 100) / 100
    : Math.round(sorted[mid] * 100) / 100;
}

/** Build a map of ticketId -> first-response hours for metrics that need it */
function computeFirstResponseTimes(
  tickets: Ticket[],
  messages: Message[],
): Array<{ ticket: Ticket; hours: number }> {
  const messagesByTicket = new Map<string, Message[]>();
  for (const m of messages) {
    const existing = messagesByTicket.get(m.ticketId) ?? [];
    existing.push(m);
    messagesByTicket.set(m.ticketId, existing);
  }

  const result: Array<{ ticket: Ticket; hours: number }> = [];
  for (const t of tickets) {
    const msgs = (messagesByTicket.get(t.id) ?? [])
      .sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime());
    const firstReply = msgs.find(m => m.type === 'reply' && m.author !== t.requester);
    if (firstReply) {
      result.push({ ticket: t, hours: hoursBetween(t.createdAt, firstReply.createdAt) });
    }
  }
  return result;
}

function groupResponseTimes(
  data: Array<{ ticket: Ticket; hours: number }>,
  primaryGroup: string,
): Map<string, number[]> {
  const grouped = new Map<string, number[]>();
  for (const { ticket, hours } of data) {
    let key: string;
    switch (primaryGroup) {
      case 'date': key = toDateKey(new Date(ticket.createdAt)); break;
      case 'priority': key = ticket.priority; break;
      case 'assignee': key = ticket.assignee ?? 'unassigned'; break;
      default: key = 'all';
    }
    const existing = grouped.get(key) ?? [];
    existing.push(hours);
    grouped.set(key, existing);
  }
  return grouped;
}

// ---- Metric computation functions ----

function computeTicketVolume(
  tickets: Ticket[],
  _messages: Message[],
  groupBy: string[],
): ReportResult {
  const primaryGroup = groupBy[0] ?? 'all';
  const groups = groupTickets(tickets, primaryGroup);

  const rows = Array.from(groups.entries())
    .map(([key, tix]) => ({ [primaryGroup]: key, count: tix.length }))
    .sort((a, b) => {
      if (primaryGroup === 'date') return String(a[primaryGroup]).localeCompare(String(b[primaryGroup]));
      return b.count - a.count;
    });

  return {
    columns: [primaryGroup, 'count'],
    rows,
    summary: { total: tickets.length },
    metric: 'ticket_volume',
  };
}

function computeTicketsResolved(
  tickets: Ticket[],
  _messages: Message[],
  groupBy: string[],
): ReportResult {
  const resolved = tickets.filter(t => t.status === 'solved' || t.status === 'closed');
  const primaryGroup = groupBy[0] ?? 'all';
  const groups = groupTickets(resolved, primaryGroup);

  const rows = Array.from(groups.entries())
    .map(([key, tix]) => ({ [primaryGroup]: key, count: tix.length }))
    .sort((a, b) => b.count - a.count);

  return {
    columns: [primaryGroup, 'count'],
    rows,
    summary: { total: resolved.length, rate: tickets.length > 0 ? resolved.length / tickets.length : 0 },
    metric: 'tickets_resolved',
  };
}

function computeAvgFirstResponseTime(
  tickets: Ticket[],
  messages: Message[],
  groupBy: string[],
): ReportResult {
  const ticketResponseTimes = computeFirstResponseTimes(tickets, messages);
  const primaryGroup = groupBy[0] ?? 'all';
  const groupedTimes = groupResponseTimes(ticketResponseTimes, primaryGroup);

  const rows = Array.from(groupedTimes.entries())
    .map(([key, times]) => ({
      [primaryGroup]: key,
      avg_hours: Math.round((times.reduce((a, b) => a + b, 0) / times.length) * 100) / 100,
      count: times.length,
    }))
    .sort((a, b) => primaryGroup === 'date' ? String(a[primaryGroup]).localeCompare(String(b[primaryGroup])) : a.avg_hours - b.avg_hours);

  const allTimes = ticketResponseTimes.map(t => t.hours);
  const overallAvg = allTimes.length > 0
    ? Math.round((allTimes.reduce((a, b) => a + b, 0) / allTimes.length) * 100) / 100
    : 0;

  return {
    columns: [primaryGroup, 'avg_hours', 'count'],
    rows,
    summary: { avg_hours: overallAvg, sample_size: allTimes.length },
    metric: 'avg_first_response_time',
  };
}

function computeMedianFirstResponseTime(
  tickets: Ticket[],
  messages: Message[],
  groupBy: string[],
): ReportResult {
  const ticketResponseTimes = computeFirstResponseTimes(tickets, messages);
  const primaryGroup = groupBy[0] ?? 'all';
  const groupedTimes = groupResponseTimes(ticketResponseTimes, primaryGroup);

  const rows = Array.from(groupedTimes.entries())
    .map(([key, times]) => ({
      [primaryGroup]: key,
      median_hours: median(times),
      count: times.length,
    }))
    .sort((a, b) => primaryGroup === 'date' ? String(a[primaryGroup]).localeCompare(String(b[primaryGroup])) : a.median_hours - b.median_hours);

  const allTimes = ticketResponseTimes.map(t => t.hours);

  return {
    columns: [primaryGroup, 'median_hours', 'count'],
    rows,
    summary: { median_hours: median(allTimes), sample_size: allTimes.length },
    metric: 'median_first_response_time',
  };
}

function computeAvgResolutionTime(
  tickets: Ticket[],
  _messages: Message[],
  groupBy: string[],
): ReportResult {
  const resolved = tickets.filter(t => t.status === 'solved' || t.status === 'closed');
  const resolutionData = resolved.map(t => ({
    ticket: t,
    hours: hoursBetween(t.createdAt, t.updatedAt),
  }));

  const primaryGroup = groupBy[0] ?? 'all';
  const groupedTimes = new Map<string, number[]>();

  for (const { ticket, hours } of resolutionData) {
    let key: string;
    switch (primaryGroup) {
      case 'date': key = toDateKey(new Date(ticket.createdAt)); break;
      case 'priority': key = ticket.priority; break;
      case 'assignee': key = ticket.assignee ?? 'unassigned'; break;
      default: key = 'all';
    }
    const existing = groupedTimes.get(key) ?? [];
    existing.push(hours);
    groupedTimes.set(key, existing);
  }

  const rows = Array.from(groupedTimes.entries())
    .map(([key, times]) => ({
      [primaryGroup]: key,
      avg_hours: Math.round((times.reduce((a, b) => a + b, 0) / times.length) * 100) / 100,
      count: times.length,
    }));

  const allTimes = resolutionData.map(d => d.hours);
  const overallAvg = allTimes.length > 0
    ? Math.round((allTimes.reduce((a, b) => a + b, 0) / allTimes.length) * 100) / 100
    : 0;

  return {
    columns: [primaryGroup, 'avg_hours', 'count'],
    rows,
    summary: { avg_hours: overallAvg, sample_size: allTimes.length },
    metric: 'avg_resolution_time',
  };
}

function computeAgentAvgResolution(
  tickets: Ticket[],
  _messages: Message[],
  groupBy: string[],
): ReportResult {
  const resolved = tickets.filter(t => t.status === 'solved' || t.status === 'closed');
  const primaryGroup = groupBy.length ? groupBy[0] : 'assignee';
  const groupedTimes = new Map<string, number[]>();

  for (const t of resolved) {
    const key = primaryGroup === 'assignee' ? (t.assignee ?? 'unassigned') : 'all';
    const hours = hoursBetween(t.createdAt, t.updatedAt);
    const existing = groupedTimes.get(key) ?? [];
    existing.push(hours);
    groupedTimes.set(key, existing);
  }

  const rows = Array.from(groupedTimes.entries())
    .map(([key, times]) => ({
      [primaryGroup]: key,
      avg_hours: Math.round((times.reduce((a, b) => a + b, 0) / times.length) * 100) / 100,
      count: times.length,
    }))
    .sort((a, b) => a.avg_hours - b.avg_hours);

  const allTimes = resolved.map(t => hoursBetween(t.createdAt, t.updatedAt));
  const overallAvg = allTimes.length > 0
    ? Math.round((allTimes.reduce((a, b) => a + b, 0) / allTimes.length) * 100) / 100
    : 0;

  return {
    columns: [primaryGroup, 'avg_hours', 'count'],
    rows,
    summary: { avg_hours: overallAvg, sample_size: allTimes.length },
    metric: 'agent_avg_resolution',
  };
}

function computeSlaCompliance(
  tickets: Ticket[],
  messages: Message[],
  groupBy: string[],
): ReportResult {
  const SLA_FIRST_RESPONSE_HOURS = 1;

  const messagesByTicket = new Map<string, Message[]>();
  for (const m of messages) {
    const existing = messagesByTicket.get(m.ticketId) ?? [];
    existing.push(m);
    messagesByTicket.set(m.ticketId, existing);
  }

  const compliance: Array<{ ticket: Ticket; met: boolean }> = [];
  for (const t of tickets) {
    const msgs = (messagesByTicket.get(t.id) ?? [])
      .sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime());
    const firstReply = msgs.find(m => m.type === 'reply' && m.author !== t.requester);
    if (firstReply) {
      const hours = hoursBetween(t.createdAt, firstReply.createdAt);
      compliance.push({ ticket: t, met: hours <= SLA_FIRST_RESPONSE_HOURS });
    }
  }

  const primaryGroup = groupBy[0] ?? 'all';
  const grouped = new Map<string, { met: number; breached: number }>();

  for (const { ticket, met } of compliance) {
    let key: string;
    switch (primaryGroup) {
      case 'date': key = toDateKey(new Date(ticket.createdAt)); break;
      case 'priority': key = ticket.priority; break;
      case 'assignee': key = ticket.assignee ?? 'unassigned'; break;
      default: key = 'all';
    }
    const existing = grouped.get(key) ?? { met: 0, breached: 0 };
    if (met) existing.met++; else existing.breached++;
    grouped.set(key, existing);
  }

  const rows = Array.from(grouped.entries())
    .map(([key, { met, breached }]) => ({
      [primaryGroup]: key,
      met,
      breached,
      rate: met + breached > 0 ? Math.round((met / (met + breached)) * 10000) / 100 : 0,
    }));

  const totalMet = compliance.filter(c => c.met).length;
  const totalBreached = compliance.filter(c => !c.met).length;

  return {
    columns: [primaryGroup, 'met', 'breached', 'rate'],
    rows,
    summary: {
      met: totalMet,
      breached: totalBreached,
      rate: totalMet + totalBreached > 0
        ? Math.round((totalMet / (totalMet + totalBreached)) * 10000) / 100
        : 0,
    },
    metric: 'sla_compliance_rate',
  };
}

function computeCsatScore(
  tickets: Ticket[],
  _messages: Message[],
  groupBy: string[],
  csatRatings: Array<{ ticketId: string; rating: number; createdAt: string }>,
): ReportResult {
  if (csatRatings.length === 0) {
    return {
      columns: ['all', 'avg_score', 'count'],
      rows: [],
      summary: { avg_score: 0, count: 0 },
      metric: 'csat_score',
    };
  }

  const ticketMap = new Map(tickets.map(t => [t.id, t]));
  const primaryGroup = groupBy[0] ?? 'all';
  const grouped = new Map<string, number[]>();

  for (const c of csatRatings) {
    let key: string;
    if (primaryGroup === 'date') {
      key = c.createdAt.slice(0, 10);
    } else if (primaryGroup === 'assignee') {
      const ticket = ticketMap.get(c.ticketId);
      key = ticket?.assignee ?? 'unassigned';
    } else {
      key = 'all';
    }
    const existing = grouped.get(key) ?? [];
    existing.push(c.rating);
    grouped.set(key, existing);
  }

  const rows = Array.from(grouped.entries())
    .map(([key, ratings]) => ({
      [primaryGroup]: key,
      avg_score: Math.round((ratings.reduce((a, b) => a + b, 0) / ratings.length) * 100) / 100,
      count: ratings.length,
    }));

  const allRatings = csatRatings.map(c => c.rating);
  const overallAvg = Math.round((allRatings.reduce((a, b) => a + b, 0) / allRatings.length) * 100) / 100;

  return {
    columns: [primaryGroup, 'avg_score', 'count'],
    rows,
    summary: { avg_score: overallAvg, count: csatRatings.length },
    metric: 'csat_score',
  };
}

function computeCsatResponseRate(
  tickets: Ticket[],
  _messages: Message[],
  groupBy: string[],
  csatRatings: Array<{ ticketId: string; rating: number; createdAt: string }>,
): ReportResult {
  const ticketIdsWithCsat = new Set(csatRatings.map(c => c.ticketId));
  const resolved = tickets.filter(t => t.status === 'solved' || t.status === 'closed');
  const withResponse = resolved.filter(t => ticketIdsWithCsat.has(t.id));
  const rate = resolved.length > 0
    ? Math.round((withResponse.length / resolved.length) * 10000) / 100
    : 0;

  const primaryGroup = groupBy[0] ?? 'all';
  if (primaryGroup === 'all') {
    return {
      columns: ['metric', 'value'],
      rows: [{ metric: 'CSAT Response Rate', value: rate }],
      summary: { rate, responded: withResponse.length, total_resolved: resolved.length },
      metric: 'csat_response_rate',
    };
  }

  const groups = groupTickets(resolved, primaryGroup);
  const rows = Array.from(groups.entries()).map(([key, tix]) => {
    const responded = tix.filter(t => ticketIdsWithCsat.has(t.id)).length;
    return {
      [primaryGroup]: key,
      responded,
      total: tix.length,
      rate: tix.length > 0 ? Math.round((responded / tix.length) * 10000) / 100 : 0,
    };
  });

  return {
    columns: [primaryGroup, 'responded', 'total', 'rate'],
    rows,
    summary: { rate, responded: withResponse.length, total_resolved: resolved.length },
    metric: 'csat_response_rate',
  };
}

function computeGenericCount(
  tickets: Ticket[],
  _messages: Message[],
  groupBy: string[],
  metricKey: string,
): ReportResult {
  const primaryGroup = groupBy[0] ?? 'all';
  const groups = groupTickets(tickets, primaryGroup);

  const rows = Array.from(groups.entries())
    .map(([key, tix]) => ({ [primaryGroup]: key, count: tix.length }))
    .sort((a, b) => b.count - a.count);

  return {
    columns: [primaryGroup, 'count'],
    rows,
    summary: { total: tickets.length },
    metric: metricKey,
  };
}

// ---- Main execution function ----

export async function executeReport(
  def: ReportDefinition,
  dateRange?: DateRange,
  overrides?: Record<string, unknown>,
): Promise<ReportResult> {
  const metricDef = getMetric(def.metric);
  if (!metricDef) {
    return {
      columns: [],
      rows: [],
      summary: { error: 1 },
      metric: def.metric,
    };
  }

  const { getDataProvider } = await import('@/lib/data-provider/index');
  const provider = await getDataProvider();

  const [allTickets, allMessages] = await Promise.all([
    provider.loadTickets(),
    provider.loadMessages(),
  ]);

  const filtered = applyFilters(
    filterTicketsByDateRange(allTickets, dateRange),
    { ...def.filters, ...overrides },
  );

  const groupBy = def.groupBy ?? [];

  let result: ReportResult;

  switch (def.metric) {
    case 'ticket_volume':
      result = computeTicketVolume(filtered, allMessages, groupBy);
      break;
    case 'tickets_resolved':
      result = computeTicketsResolved(filtered, allMessages, groupBy);
      break;
    case 'tickets_open': {
      const open = filtered.filter(t => t.status === 'open' || t.status === 'pending');
      result = computeGenericCount(open, allMessages, groupBy, 'tickets_open');
      break;
    }
    case 'avg_first_response_time':
      result = computeAvgFirstResponseTime(filtered, allMessages, groupBy);
      break;
    case 'avg_resolution_time':
      result = computeAvgResolutionTime(filtered, allMessages, groupBy);
      break;
    case 'median_first_response_time':
      result = computeMedianFirstResponseTime(filtered, allMessages, groupBy);
      break;
    case 'sla_compliance_rate':
    case 'sla_breaches':
      result = computeSlaCompliance(filtered, allMessages, groupBy);
      break;
    case 'csat_score': {
      const csatRatings = await provider.loadCSATRatings();
      result = computeCsatScore(filtered, allMessages, groupBy, csatRatings);
      break;
    }
    case 'csat_response_rate': {
      const csatRatings = await provider.loadCSATRatings();
      result = computeCsatResponseRate(filtered, allMessages, groupBy, csatRatings);
      break;
    }
    case 'nps_score': {
      const npsResponses = await provider.loadSurveyResponses('nps');
      const completed = npsResponses.filter(r => r.rating !== null);
      let nps = 0;
      if (completed.length > 0) {
        const promoters = completed.filter(r => r.rating! >= 9).length;
        const detractors = completed.filter(r => r.rating! < 7).length;
        nps = Math.round(((promoters - detractors) / completed.length) * 100);
      }
      result = {
        columns: ['metric', 'value'],
        rows: [{ metric: 'NPS Score', value: nps }],
        summary: { nps_score: nps, responses: completed.length },
        metric: 'nps_score',
      };
      break;
    }
    case 'ces_score': {
      const cesResponses = await provider.loadSurveyResponses('ces');
      const completed = cesResponses.filter(r => r.rating !== null);
      const avg = completed.length > 0
        ? Math.round((completed.reduce((a, r) => a + r.rating!, 0) / completed.length) * 100) / 100
        : 0;
      result = {
        columns: ['metric', 'value'],
        rows: [{ metric: 'CES Score', value: avg }],
        summary: { ces_score: avg, responses: completed.length },
        metric: 'ces_score',
      };
      break;
    }
    case 'agent_tickets_handled':
      result = computeGenericCount(filtered, allMessages, groupBy.length ? groupBy : ['assignee'], def.metric);
      break;
    case 'agent_avg_resolution':
      result = computeAgentAvgResolution(filtered, allMessages, groupBy);
      break;
    case 'channel_breakdown':
      result = computeGenericCount(filtered, allMessages, ['channel'], 'channel_breakdown');
      break;
    case 'top_tags':
      result = computeGenericCount(filtered, allMessages, ['tag'], 'top_tags');
      break;
    case 'priority_distribution':
      result = computeGenericCount(filtered, allMessages, ['priority'], 'priority_distribution');
      break;
    case 'ai_resolution_rate': {
      const aiResolved = filtered.filter(t => t.tags?.includes('ai_resolved'));
      const rate = filtered.length > 0 ? Math.round((aiResolved.length / filtered.length) * 10000) / 100 : 0;
      result = {
        columns: ['metric', 'value'],
        rows: [{ metric: 'AI Resolution Rate', value: rate }],
        summary: { rate, ai_resolved: aiResolved.length, total: filtered.length },
        metric: 'ai_resolution_rate',
      };
      break;
    }
    case 'backlog_age': {
      const open = filtered.filter(t => t.status === 'open' || t.status === 'pending');
      const now = Date.now();
      const ages = open.map(t => (now - new Date(t.createdAt).getTime()) / (1000 * 60 * 60));
      const avg = ages.length > 0
        ? Math.round((ages.reduce((a, b) => a + b, 0) / ages.length) * 100) / 100
        : 0;
      result = {
        columns: ['metric', 'value'],
        rows: [{ metric: 'Avg Backlog Age (hours)', value: avg }],
        summary: { avg_age_hours: avg, open_tickets: open.length },
        metric: 'backlog_age',
      };
      break;
    }
    case 'replies_per_ticket': {
      const messagesByTicket = new Map<string, number>();
      for (const m of allMessages) {
        if (m.type === 'reply') {
          messagesByTicket.set(m.ticketId, (messagesByTicket.get(m.ticketId) ?? 0) + 1);
        }
      }
      const resolved = filtered.filter(t => t.status === 'solved' || t.status === 'closed');
      const counts = resolved.map(t => messagesByTicket.get(t.id) ?? 0);
      const avg = counts.length > 0
        ? Math.round((counts.reduce((a, b) => a + b, 0) / counts.length) * 100) / 100
        : 0;
      result = {
        columns: ['metric', 'value'],
        rows: [{ metric: 'Avg Replies per Ticket', value: avg }],
        summary: { avg_replies: avg, sample_size: counts.length },
        metric: 'replies_per_ticket',
      };
      break;
    }
    default:
      result = computeGenericCount(filtered, allMessages, groupBy, def.metric);
  }

  if (dateRange) {
    result.dateRange = dateRange;
  }

  return result;
}

/**
 * Drill down into a report cell — returns the underlying ticket IDs.
 */
export async function drillDown(
  def: ReportDefinition,
  groupKey: string,
  groupValue: string,
  dateRange?: DateRange,
): Promise<{ ticketIds: string[]; count: number }> {
  const { getDataProvider } = await import('@/lib/data-provider/index');
  const provider = await getDataProvider();
  const allTickets = await provider.loadTickets();
  const filtered = applyFilters(filterTicketsByDateRange(allTickets, dateRange), def.filters);

  let matching: Ticket[];
  switch (groupKey) {
    case 'date':
      matching = filtered.filter(t => toDateKey(new Date(t.createdAt)) === groupValue);
      break;
    case 'status':
      matching = filtered.filter(t => t.status === groupValue);
      break;
    case 'priority':
      matching = filtered.filter(t => t.priority === groupValue);
      break;
    case 'assignee':
      matching = filtered.filter(t => (t.assignee ?? 'unassigned') === groupValue);
      break;
    case 'tag':
      matching = filtered.filter(t => t.tags?.includes(groupValue));
      break;
    case 'channel':
      matching = filtered.filter(t => {
        const ch = t.source?.includes('chat') ? 'chat' : 'email';
        return ch === groupValue;
      });
      break;
    case 'source':
      matching = filtered.filter(t => t.source === groupValue);
      break;
    default:
      matching = filtered;
  }

  return {
    ticketIds: matching.map(t => t.id),
    count: matching.length,
  };
}
