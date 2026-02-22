import { loadTickets, loadMessages, type Ticket, type Message } from '@/lib/data';

// ---- Types ----

export interface AnalyticsData {
  // Volume metrics
  ticketsCreated: { date: string; count: number }[];
  ticketsByChannel: Record<string, number>;
  ticketsBySource: Record<string, number>;

  // Performance metrics
  avgResponseTimeHours: number;
  avgResolutionTimeHours: number;
  firstResponseSLA: { met: number; breached: number };
  resolutionSLA: { met: number; breached: number };

  // Agent metrics
  agentPerformance: Array<{
    name: string;
    ticketsHandled: number;
    avgResolutionHours: number;
    csatAvg: number;
  }>;

  // Satisfaction
  csatOverall: number;
  csatTrend: { date: string; score: number }[];

  // Tags & categories
  topTags: Array<{ tag: string; count: number }>;
  priorityDistribution: Record<string, number>;

  // Period comparison
  periodComparison: {
    current: { tickets: number; avgResponseHours: number; resolved: number };
    previous: { tickets: number; avgResponseHours: number; resolved: number };
  };

  // Summary
  totalTickets: number;
  dateRange: { from: string; to: string };
}

export interface DateRange {
  from: Date;
  to: Date;
}

// ---- CSAT helpers ----

interface CSATRating {
  ticketId: string;
  rating: number;
  createdAt: string;
}

async function loadCSATRatings(): Promise<CSATRating[]> {
  if (process.env.DATABASE_URL) {
    try {
      const { db } = await import('@/db');
      const schema = await import('@/db/schema');
      const rows = await db
        .select({
          ticketId: schema.csatRatings.ticketId,
          rating: schema.csatRatings.rating,
          createdAt: schema.csatRatings.createdAt,
        })
        .from(schema.csatRatings);
      return rows.map((r) => ({
        ticketId: r.ticketId,
        rating: r.rating,
        createdAt: r.createdAt.toISOString(),
      }));
    } catch {
      // DB unavailable
    }
  }
  return [];
}

// ---- Utility helpers ----

function toDateKey(d: Date): string {
  return d.toISOString().slice(0, 10);
}

function hoursBetween(a: string, b: string): number {
  return Math.abs(new Date(b).getTime() - new Date(a).getTime()) / (1000 * 60 * 60);
}

function filterByDateRange(tickets: Ticket[], range?: DateRange): Ticket[] {
  if (!range) return tickets;
  const fromMs = range.from.getTime();
  const toMs = range.to.getTime();
  return tickets.filter((t) => {
    const ms = new Date(t.createdAt).getTime();
    return ms >= fromMs && ms <= toMs;
  });
}

// ---- Core computation ----

export async function computeAnalytics(dateRange?: DateRange): Promise<AnalyticsData> {
  const allTickets = await loadTickets();
  const allMessages = await loadMessages();
  const csatRatings = await loadCSATRatings();

  const tickets = filterByDateRange(allTickets, dateRange);

  // Default range from ticket data
  const sortedByDate = [...tickets].sort(
    (a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime()
  );
  const rangeFrom = dateRange?.from.toISOString().slice(0, 10) ??
    (sortedByDate[0]?.createdAt?.slice(0, 10) || new Date().toISOString().slice(0, 10));
  const rangeTo = dateRange?.to.toISOString().slice(0, 10) ??
    (sortedByDate[sortedByDate.length - 1]?.createdAt?.slice(0, 10) || new Date().toISOString().slice(0, 10));

  // ---- Volume: tickets per day ----
  const dailyCounts: Record<string, number> = {};
  for (const t of tickets) {
    const key = toDateKey(new Date(t.createdAt));
    dailyCounts[key] = (dailyCounts[key] ?? 0) + 1;
  }
  const ticketsCreated = Object.entries(dailyCounts)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([date, count]) => ({ date, count }));

  // ---- By source ----
  const ticketsBySource: Record<string, number> = {};
  for (const t of tickets) {
    ticketsBySource[t.source] = (ticketsBySource[t.source] ?? 0) + 1;
  }

  // ---- By channel (inferred from source) ----
  const ticketsByChannel: Record<string, number> = {};
  for (const t of tickets) {
    // Derive channel from source or default to email
    const channel = t.source.includes('chat') ? 'chat' : 'email';
    ticketsByChannel[channel] = (ticketsByChannel[channel] ?? 0) + 1;
  }

  // ---- Priority distribution ----
  const priorityDistribution: Record<string, number> = {};
  for (const t of tickets) {
    priorityDistribution[t.priority] = (priorityDistribution[t.priority] ?? 0) + 1;
  }

  // ---- Top tags ----
  const tagCounts: Record<string, number> = {};
  for (const t of tickets) {
    for (const tag of t.tags) {
      tagCounts[tag] = (tagCounts[tag] ?? 0) + 1;
    }
  }
  const topTags = Object.entries(tagCounts)
    .sort(([, a], [, b]) => b - a)
    .slice(0, 15)
    .map(([tag, count]) => ({ tag, count }));

  // ---- Response & resolution times ----
  // Group messages by ticket
  const messagesByTicket = new Map<string, Message[]>();
  for (const m of allMessages) {
    const existing = messagesByTicket.get(m.ticketId) ?? [];
    existing.push(m);
    messagesByTicket.set(m.ticketId, existing);
  }

  const responseTimes: number[] = [];
  const resolutionTimes: number[] = [];
  const agentMap = new Map<string, {
    ticketsHandled: number;
    totalResolutionHours: number;
    resolvedCount: number;
  }>();

  for (const t of tickets) {
    // Agent tracking
    const agent = t.assignee ?? 'unassigned';
    if (!agentMap.has(agent)) {
      agentMap.set(agent, { ticketsHandled: 0, totalResolutionHours: 0, resolvedCount: 0 });
    }
    const agentData = agentMap.get(agent)!;
    agentData.ticketsHandled += 1;

    // First response time: time from ticket creation to first non-customer reply
    const msgs = (messagesByTicket.get(t.id) ?? [])
      .sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime());
    const firstAgentReply = msgs.find(
      (m) => m.type === 'reply' && m.author !== t.requester
    );
    if (firstAgentReply) {
      const hours = hoursBetween(t.createdAt, firstAgentReply.createdAt);
      responseTimes.push(hours);
    }

    // Resolution time: ticket creation to solved/closed
    if (t.status === 'solved' || t.status === 'closed') {
      const hours = hoursBetween(t.createdAt, t.updatedAt);
      resolutionTimes.push(hours);
      agentData.totalResolutionHours += hours;
      agentData.resolvedCount += 1;
    }
  }

  const avgResponseTimeHours = responseTimes.length > 0
    ? Math.round((responseTimes.reduce((a, b) => a + b, 0) / responseTimes.length) * 100) / 100
    : 0;
  const avgResolutionTimeHours = resolutionTimes.length > 0
    ? Math.round((resolutionTimes.reduce((a, b) => a + b, 0) / resolutionTimes.length) * 100) / 100
    : 0;

  // ---- SLA compliance (using default thresholds: 1h first response, 24h resolution) ----
  const SLA_FIRST_RESPONSE_HOURS = 1;
  const SLA_RESOLUTION_HOURS = 24;

  const firstResponseSLA = { met: 0, breached: 0 };
  for (const rt of responseTimes) {
    if (rt <= SLA_FIRST_RESPONSE_HOURS) firstResponseSLA.met++;
    else firstResponseSLA.breached++;
  }

  const resolutionSLA = { met: 0, breached: 0 };
  for (const rt of resolutionTimes) {
    if (rt <= SLA_RESOLUTION_HOURS) resolutionSLA.met++;
    else resolutionSLA.breached++;
  }

  // ---- CSAT ----
  const csatByTicket = new Map<string, number>();
  const csatByDate = new Map<string, { sum: number; count: number }>();
  for (const c of csatRatings) {
    csatByTicket.set(c.ticketId, c.rating);
    const key = c.createdAt.slice(0, 10);
    const existing = csatByDate.get(key) ?? { sum: 0, count: 0 };
    existing.sum += c.rating;
    existing.count += 1;
    csatByDate.set(key, existing);
  }

  const csatOverall = csatRatings.length > 0
    ? Math.round((csatRatings.reduce((a, c) => a + c.rating, 0) / csatRatings.length) * 100) / 100
    : 0;

  const csatTrend = Array.from(csatByDate.entries())
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([date, { sum, count }]) => ({
      date,
      score: Math.round((sum / count) * 100) / 100,
    }));

  // ---- Agent performance ----
  const agentPerformance = Array.from(agentMap.entries())
    .filter(([name]) => name !== 'unassigned')
    .map(([name, data]) => ({
      name,
      ticketsHandled: data.ticketsHandled,
      avgResolutionHours: data.resolvedCount > 0
        ? Math.round((data.totalResolutionHours / data.resolvedCount) * 100) / 100
        : 0,
      csatAvg: (() => {
        // Find CSAT ratings for this agent's tickets
        const agentTicketIds = tickets
          .filter((t) => (t.assignee ?? 'unassigned') === name)
          .map((t) => t.id);
        const agentRatings = agentTicketIds
          .map((id) => csatByTicket.get(id))
          .filter((r): r is number => r !== undefined);
        return agentRatings.length > 0
          ? Math.round((agentRatings.reduce((a, b) => a + b, 0) / agentRatings.length) * 100) / 100
          : 0;
      })(),
    }))
    .sort((a, b) => b.ticketsHandled - a.ticketsHandled);

  // ---- Period comparison (this week vs last week) ----
  const now = new Date();
  const oneWeekAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
  const twoWeeksAgo = new Date(now.getTime() - 14 * 24 * 60 * 60 * 1000);

  const currentWeek = allTickets.filter((t) => {
    const ms = new Date(t.createdAt).getTime();
    return ms >= oneWeekAgo.getTime() && ms <= now.getTime();
  });
  const previousWeek = allTickets.filter((t) => {
    const ms = new Date(t.createdAt).getTime();
    return ms >= twoWeeksAgo.getTime() && ms < oneWeekAgo.getTime();
  });

  function weekResponseAvg(weekTickets: Ticket[]): number {
    const times: number[] = [];
    for (const t of weekTickets) {
      const msgs = (messagesByTicket.get(t.id) ?? [])
        .sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime());
      const firstReply = msgs.find((m) => m.type === 'reply' && m.author !== t.requester);
      if (firstReply) times.push(hoursBetween(t.createdAt, firstReply.createdAt));
    }
    return times.length > 0
      ? Math.round((times.reduce((a, b) => a + b, 0) / times.length) * 100) / 100
      : 0;
  }

  const periodComparison = {
    current: {
      tickets: currentWeek.length,
      avgResponseHours: weekResponseAvg(currentWeek),
      resolved: currentWeek.filter((t) => t.status === 'solved' || t.status === 'closed').length,
    },
    previous: {
      tickets: previousWeek.length,
      avgResponseHours: weekResponseAvg(previousWeek),
      resolved: previousWeek.filter((t) => t.status === 'solved' || t.status === 'closed').length,
    },
  };

  return {
    ticketsCreated,
    ticketsByChannel,
    ticketsBySource,
    avgResponseTimeHours,
    avgResolutionTimeHours,
    firstResponseSLA,
    resolutionSLA,
    agentPerformance,
    csatOverall,
    csatTrend,
    topTags,
    priorityDistribution,
    periodComparison,
    totalTickets: tickets.length,
    dateRange: { from: rangeFrom, to: rangeTo },
  };
}

// ---- CSV export helper ----

export function analyticsToCSV(data: AnalyticsData): string {
  const lines: string[] = [];

  // Summary
  lines.push('Section,Metric,Value');
  lines.push(`Summary,Total Tickets,${data.totalTickets}`);
  lines.push(`Summary,Date Range,${data.dateRange.from} to ${data.dateRange.to}`);
  lines.push(`Summary,Avg Response Time (hours),${data.avgResponseTimeHours}`);
  lines.push(`Summary,Avg Resolution Time (hours),${data.avgResolutionTimeHours}`);
  lines.push(`Summary,CSAT Overall,${data.csatOverall}`);
  lines.push(`Summary,First Response SLA Met,${data.firstResponseSLA.met}`);
  lines.push(`Summary,First Response SLA Breached,${data.firstResponseSLA.breached}`);
  lines.push(`Summary,Resolution SLA Met,${data.resolutionSLA.met}`);
  lines.push(`Summary,Resolution SLA Breached,${data.resolutionSLA.breached}`);
  lines.push('');

  // Volume per day
  lines.push('Date,Tickets Created');
  for (const entry of data.ticketsCreated) {
    lines.push(`${entry.date},${entry.count}`);
  }
  lines.push('');

  // By source
  lines.push('Source,Count');
  for (const [source, count] of Object.entries(data.ticketsBySource)) {
    lines.push(`${source},${count}`);
  }
  lines.push('');

  // Priority
  lines.push('Priority,Count');
  for (const [priority, count] of Object.entries(data.priorityDistribution)) {
    lines.push(`${priority},${count}`);
  }
  lines.push('');

  // Agent performance
  lines.push('Agent,Tickets Handled,Avg Resolution Hours,CSAT Avg');
  for (const agent of data.agentPerformance) {
    lines.push(`"${agent.name}",${agent.ticketsHandled},${agent.avgResolutionHours},${agent.csatAvg}`);
  }
  lines.push('');

  // Top tags
  lines.push('Tag,Count');
  for (const entry of data.topTags) {
    lines.push(`"${entry.tag}",${entry.count}`);
  }

  return lines.join('\n');
}
