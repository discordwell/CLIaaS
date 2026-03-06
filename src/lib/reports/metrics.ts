/**
 * Metric registry — defines all available report metrics with their
 * source tables, aggregation types, and valid groupBy dimensions.
 */

export type AggregationType = 'count' | 'avg' | 'sum' | 'min' | 'max' | 'pct';

export interface MetricDefinition {
  key: string;
  label: string;
  description: string;
  sourceTables: string[];
  aggregation: AggregationType;
  valueField?: string;
  validGroupBy: string[];
}

export const METRIC_REGISTRY: MetricDefinition[] = [
  // Volume metrics
  {
    key: 'ticket_volume',
    label: 'Ticket Volume',
    description: 'Number of tickets created',
    sourceTables: ['tickets'],
    aggregation: 'count',
    validGroupBy: ['date', 'status', 'priority', 'channel', 'assignee', 'tag', 'source'],
  },
  {
    key: 'tickets_resolved',
    label: 'Tickets Resolved',
    description: 'Tickets moved to solved or closed',
    sourceTables: ['tickets'],
    aggregation: 'count',
    validGroupBy: ['date', 'priority', 'assignee', 'tag'],
  },
  {
    key: 'tickets_open',
    label: 'Open Tickets',
    description: 'Currently open tickets',
    sourceTables: ['tickets'],
    aggregation: 'count',
    validGroupBy: ['priority', 'assignee', 'tag', 'channel'],
  },
  // Response metrics
  {
    key: 'avg_first_response_time',
    label: 'Avg First Response Time',
    description: 'Average time to first agent reply (hours)',
    sourceTables: ['tickets', 'messages'],
    aggregation: 'avg',
    valueField: 'first_response_hours',
    validGroupBy: ['date', 'priority', 'assignee', 'channel'],
  },
  {
    key: 'avg_resolution_time',
    label: 'Avg Resolution Time',
    description: 'Average time from creation to resolution (hours)',
    sourceTables: ['tickets'],
    aggregation: 'avg',
    valueField: 'resolution_hours',
    validGroupBy: ['date', 'priority', 'assignee'],
  },
  {
    key: 'median_first_response_time',
    label: 'Median First Response Time',
    description: 'Median time to first agent reply (hours)',
    sourceTables: ['tickets', 'messages'],
    aggregation: 'avg',
    valueField: 'first_response_hours',
    validGroupBy: ['date', 'priority', 'assignee'],
  },
  // SLA metrics
  {
    key: 'sla_compliance_rate',
    label: 'SLA Compliance Rate',
    description: 'Percentage of tickets meeting SLA targets',
    sourceTables: ['tickets', 'messages'],
    aggregation: 'pct',
    validGroupBy: ['date', 'priority', 'assignee'],
  },
  {
    key: 'sla_breaches',
    label: 'SLA Breaches',
    description: 'Number of SLA breaches',
    sourceTables: ['tickets', 'messages'],
    aggregation: 'count',
    validGroupBy: ['date', 'priority', 'assignee'],
  },
  // CSAT metrics
  {
    key: 'csat_score',
    label: 'CSAT Score',
    description: 'Average customer satisfaction score',
    sourceTables: ['csat_ratings'],
    aggregation: 'avg',
    valueField: 'rating',
    validGroupBy: ['date', 'assignee'],
  },
  {
    key: 'csat_response_rate',
    label: 'CSAT Response Rate',
    description: 'Percentage of tickets with CSAT responses',
    sourceTables: ['tickets', 'csat_ratings'],
    aggregation: 'pct',
    validGroupBy: ['date'],
  },
  // NPS
  {
    key: 'nps_score',
    label: 'NPS Score',
    description: 'Net Promoter Score (-100 to 100)',
    sourceTables: ['survey_responses'],
    aggregation: 'avg',
    valueField: 'rating',
    validGroupBy: ['date'],
  },
  // CES
  {
    key: 'ces_score',
    label: 'CES Score',
    description: 'Customer Effort Score',
    sourceTables: ['survey_responses'],
    aggregation: 'avg',
    valueField: 'rating',
    validGroupBy: ['date'],
  },
  // Agent metrics
  {
    key: 'agent_tickets_handled',
    label: 'Agent Tickets Handled',
    description: 'Tickets handled per agent',
    sourceTables: ['tickets'],
    aggregation: 'count',
    validGroupBy: ['assignee', 'date', 'status'],
  },
  {
    key: 'agent_avg_resolution',
    label: 'Agent Avg Resolution Time',
    description: 'Average resolution time per agent (hours)',
    sourceTables: ['tickets'],
    aggregation: 'avg',
    valueField: 'resolution_hours',
    validGroupBy: ['assignee', 'date'],
  },
  // Channel metrics
  {
    key: 'channel_breakdown',
    label: 'Channel Breakdown',
    description: 'Ticket distribution by channel',
    sourceTables: ['tickets'],
    aggregation: 'count',
    validGroupBy: ['channel', 'date', 'status'],
  },
  // Tag metrics
  {
    key: 'top_tags',
    label: 'Top Tags',
    description: 'Most common ticket tags',
    sourceTables: ['tickets'],
    aggregation: 'count',
    validGroupBy: ['tag', 'date'],
  },
  // Priority
  {
    key: 'priority_distribution',
    label: 'Priority Distribution',
    description: 'Tickets by priority level',
    sourceTables: ['tickets'],
    aggregation: 'count',
    validGroupBy: ['priority', 'date', 'status'],
  },
  // AI metrics
  {
    key: 'ai_resolution_rate',
    label: 'AI Resolution Rate',
    description: 'Percentage of tickets resolved by AI',
    sourceTables: ['tickets'],
    aggregation: 'pct',
    validGroupBy: ['date'],
  },
  // Backlog
  {
    key: 'backlog_age',
    label: 'Backlog Age',
    description: 'Average age of open tickets (hours)',
    sourceTables: ['tickets'],
    aggregation: 'avg',
    valueField: 'age_hours',
    validGroupBy: ['priority', 'assignee'],
  },
  // Replies per ticket
  {
    key: 'replies_per_ticket',
    label: 'Replies per Ticket',
    description: 'Average number of replies per resolved ticket',
    sourceTables: ['tickets', 'messages'],
    aggregation: 'avg',
    valueField: 'reply_count',
    validGroupBy: ['date', 'assignee', 'priority'],
  },
];

export function getMetric(key: string): MetricDefinition | undefined {
  return METRIC_REGISTRY.find(m => m.key === key);
}

export function validateGroupBy(metricKey: string, groupBy: string[]): string[] {
  const metric = getMetric(metricKey);
  if (!metric) return [];
  return groupBy.filter(g => metric.validGroupBy.includes(g));
}

export function listMetrics(): { key: string; label: string; description: string }[] {
  return METRIC_REGISTRY.map(m => ({
    key: m.key,
    label: m.label,
    description: m.description,
  }));
}
