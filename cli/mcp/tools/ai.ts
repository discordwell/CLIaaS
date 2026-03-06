/**
 * MCP AI tools: ai_config, ai_stats, ai_approve, ai_reject.
 */

import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { textResult, errorResult } from '../util.js';
import { withConfirmation, recordMCPAction } from './confirm.js';
import { scopeGuard } from './scopes.js';

export function registerAITools(server: McpServer): void {
  // ---- ai_config ----
  server.tool(
    'ai_config',
    'Get or set AI agent configuration for the workspace',
    {
      action: z.enum(['get', 'set']).optional().describe('Action: get (default) or set'),
      enabled: z.boolean().optional().describe('Enable/disable AI agent'),
      mode: z.enum(['suggest', 'approve', 'auto']).optional().describe('AI mode'),
      confidenceThreshold: z.number().optional().describe('Confidence threshold (0-1)'),
      provider: z.string().optional().describe('AI provider: claude, openai'),
      model: z.string().optional().describe('Model name override'),
      maxTokens: z.number().optional().describe('Max tokens for AI response'),
      piiDetection: z.boolean().optional().describe('Enable PII detection'),
      maxAutoResolvesPerHour: z.number().optional().describe('Rate limit for auto mode'),
    },
    async ({ action, ...updates }) => {
      const guard = scopeGuard('ai_config');
      if (guard) return guard;

      try {
        const { getAgentConfig, saveAgentConfig } = await import('@/lib/ai/store.js');

        if (action === 'set') {
          const config = await saveAgentConfig({
            workspaceId: 'default',
            ...updates,
          });
          recordMCPAction({
            tool: 'ai_config', action: 'set',
            params: updates,
            timestamp: new Date().toISOString(), result: 'success',
          });
          return textResult({ updated: true, config });
        }

        const config = await getAgentConfig('default');
        return textResult({ config });
      } catch (err) {
        return errorResult(err instanceof Error ? err.message : 'Failed to get/set AI config');
      }
    },
  );

  // ---- ai_stats ----
  server.tool(
    'ai_stats',
    'Get AI resolution statistics',
    {
      from: z.string().optional().describe('Start date (ISO format)'),
      to: z.string().optional().describe('End date (ISO format)'),
    },
    async ({ from, to }) => {
      const guard = scopeGuard('ai_stats');
      if (guard) return guard;

      try {
        const { getResolutionStats } = await import('@/lib/ai/store.js');
        const dateRange = from && to ? { from, to } : undefined;
        const stats = await getResolutionStats('default', dateRange);
        return textResult({ stats });
      } catch (err) {
        return errorResult(err instanceof Error ? err.message : 'Failed to get stats');
      }
    },
  );

  // ---- ai_approve ----
  server.tool(
    'ai_approve',
    'Approve a pending AI resolution and send the reply (requires confirm=true)',
    {
      resolutionId: z.string().describe('Resolution ID to approve'),
      confirm: z.boolean().optional().describe('Must be true to approve'),
    },
    async ({ resolutionId, confirm }) => {
      const guard = scopeGuard('ai_approve');
      if (guard) return guard;

      const result = withConfirmation(confirm, {
        description: `Approve AI resolution ${resolutionId}`,
        preview: { resolutionId },
        execute: async () => {
          const { approveEntry } = await import('@/lib/ai/approval-queue.js');
          const entry = await approveEntry(resolutionId, 'mcp-agent');

          if (!entry) return { error: 'Resolution not found or not pending' };

          recordMCPAction({
            tool: 'ai_approve', action: 'approve',
            params: { resolutionId },
            timestamp: new Date().toISOString(), result: 'success',
          });

          return { approved: true, entry };
        },
      });

      if (result.needsConfirmation) return result.result;
      return textResult(await result.value);
    },
  );

  // ---- ai_reject ----
  server.tool(
    'ai_reject',
    'Reject a pending AI resolution (requires confirm=true)',
    {
      resolutionId: z.string().describe('Resolution ID to reject'),
      confirm: z.boolean().optional().describe('Must be true to reject'),
    },
    async ({ resolutionId, confirm }) => {
      const guard = scopeGuard('ai_reject');
      if (guard) return guard;

      const result = withConfirmation(confirm, {
        description: `Reject AI resolution ${resolutionId}`,
        preview: { resolutionId },
        execute: async () => {
          const { rejectEntry } = await import('@/lib/ai/approval-queue.js');
          const entry = await rejectEntry(resolutionId, 'mcp-agent');

          if (!entry) return { error: 'Resolution not found or not pending' };

          recordMCPAction({
            tool: 'ai_reject', action: 'reject',
            params: { resolutionId },
            timestamp: new Date().toISOString(), result: 'success',
          });

          return { rejected: true, entry };
        },
      });

      if (result.needsConfirmation) return result.result;
      return textResult(await result.value);
    },
  );
}
