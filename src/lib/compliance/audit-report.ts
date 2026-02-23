/**
 * Audit evidence export: collects login events, data access records,
 * changes, and automation executions into a structured JSON report.
 */

import { getAuditLog } from '@/lib/automation/executor';
import { getAgentStats } from '@/lib/ai/agent';
import { getROIMetrics } from '@/lib/ai/roi-tracker';

export interface AuditReportSection {
  type: string;
  count: number;
  entries: Record<string, unknown>[];
}

export interface AuditReport {
  generatedAt: string;
  generatedBy: string;
  sections: AuditReportSection[];
  summary: {
    totalEvents: number;
    automationExecutions: number;
    aiResolutions: number;
  };
}

export async function generateAuditReport(generatedBy = 'system'): Promise<AuditReport> {
  const automationLog = getAuditLog();
  const aiStats = getAgentStats();
  const roiMetrics = getROIMetrics();

  const sections: AuditReportSection[] = [];

  // Automation executions
  sections.push({
    type: 'automation_executions',
    count: automationLog.length,
    entries: automationLog.map(entry => ({
      id: entry.id,
      ruleId: entry.ruleId,
      ruleName: entry.ruleName,
      ticketId: entry.ticketId,
      event: entry.event,
      actions: entry.actions,
      timestamp: entry.timestamp,
      dryRun: entry.dryRun,
    })),
  });

  // AI resolutions
  sections.push({
    type: 'ai_resolutions',
    count: aiStats.totalRuns,
    entries: aiStats.recentResults.map(r => ({
      ticketId: r.ticketId,
      resolved: r.resolved,
      confidence: r.confidence,
      escalated: r.escalated,
      escalationReason: r.escalationReason,
      kbArticlesUsed: r.kbArticlesUsed,
    })),
  });

  // ROI summary
  sections.push({
    type: 'ai_roi_summary',
    count: 1,
    entries: [{
      totalResolutions: roiMetrics.totalResolutions,
      aiResolved: roiMetrics.aiResolved,
      escalated: roiMetrics.escalated,
      resolutionRate: roiMetrics.resolutionRate,
      avgConfidence: roiMetrics.avgConfidence,
      estimatedTimeSavedMinutes: roiMetrics.estimatedTimeSavedMinutes,
    }],
  });

  // DB audit events (if available)
  if (process.env.DATABASE_URL) {
    try {
      const { db } = await import('@/db');
      const schema = await import('@/db/schema');
      const { desc } = await import('drizzle-orm');

      const dbEvents = await db
        .select()
        .from(schema.auditEntries)
        .orderBy(desc(schema.auditEntries.timestamp))
        .limit(500);

      sections.push({
        type: 'audit_log_entries',
        count: dbEvents.length,
        entries: dbEvents.map(e => ({
          id: e.id,
          timestamp: e.timestamp,
          userId: e.userId,
          userName: e.userName,
          action: e.action,
          resource: e.resource,
          resourceId: e.resourceId,
        })),
      });
    } catch {
      // DB unavailable, skip
    }
  }

  const totalEvents = sections.reduce((sum, s) => sum + s.count, 0);

  return {
    generatedAt: new Date().toISOString(),
    generatedBy,
    sections,
    summary: {
      totalEvents,
      automationExecutions: automationLog.length,
      aiResolutions: aiStats.totalRuns,
    },
  };
}
