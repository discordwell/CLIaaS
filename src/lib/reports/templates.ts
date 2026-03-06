/**
 * Pre-built report templates that are seeded for new workspaces.
 */

import type { ReportDefinition } from './engine';

export interface ReportTemplate extends ReportDefinition {
  name: string;
  description: string;
  visualization: string;
}

export const REPORT_TEMPLATES: ReportTemplate[] = [
  {
    name: 'Ticket Volume',
    description: 'Daily ticket creation volume over time',
    metric: 'ticket_volume',
    groupBy: ['date'],
    filters: {},
    visualization: 'bar',
  },
  {
    name: 'Agent Performance',
    description: 'Tickets handled and resolution time per agent',
    metric: 'agent_tickets_handled',
    groupBy: ['assignee'],
    filters: {},
    visualization: 'bar',
  },
  {
    name: 'SLA Compliance',
    description: 'First response SLA compliance rate over time',
    metric: 'sla_compliance_rate',
    groupBy: ['date'],
    filters: {},
    visualization: 'line',
  },
  {
    name: 'CSAT Trends',
    description: 'Customer satisfaction score trends',
    metric: 'csat_score',
    groupBy: ['date'],
    filters: {},
    visualization: 'line',
  },
  {
    name: 'Channel Breakdown',
    description: 'Ticket distribution across support channels',
    metric: 'channel_breakdown',
    groupBy: ['channel'],
    filters: {},
    visualization: 'pie',
  },
  {
    name: 'AI Resolution Rate',
    description: 'Percentage of tickets resolved by AI automation',
    metric: 'ai_resolution_rate',
    groupBy: [],
    filters: {},
    visualization: 'number',
  },
];

/**
 * Seed template reports for a workspace (upsert by name + workspace).
 * Returns the seeded report IDs for use with DB inserts.
 */
export function getTemplateSeedData(workspaceId: string): Array<{
  workspaceId: string;
  name: string;
  description: string;
  metric: string;
  groupBy: string[];
  filters: Record<string, unknown>;
  visualization: string;
  isTemplate: boolean;
}> {
  return REPORT_TEMPLATES.map(t => ({
    workspaceId,
    name: t.name,
    description: t.description,
    metric: t.metric,
    groupBy: t.groupBy ?? [],
    filters: t.filters ?? {},
    visualization: t.visualization,
    isTemplate: true,
  }));
}
