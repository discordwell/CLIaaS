/**
 * CLI commands for AI resolution management.
 */

import type { Command } from 'commander';

export function registerAICommands(program: Command): void {
  const ai = program.command('ai').description('AI resolution management');

  // ---- ai config ----
  ai.command('config')
    .description('Show AI agent configuration')
    .action(async () => {
      const { getAgentConfig } = await import('@/lib/ai/store.js');
      const config = await getAgentConfig('default');
      console.log(JSON.stringify(config, null, 2));
    });

  // ---- ai config set ----
  ai.command('config-set')
    .description('Update AI agent configuration')
    .option('--enabled <bool>', 'Enable/disable AI agent')
    .option('--mode <mode>', 'Mode: suggest, approve, auto')
    .option('--threshold <n>', 'Confidence threshold (0-1)')
    .option('--provider <name>', 'AI provider: claude, openai')
    .option('--model <name>', 'Model name')
    .option('--max-tokens <n>', 'Max tokens')
    .option('--pii-detection <bool>', 'Enable PII detection')
    .option('--max-per-hour <n>', 'Max auto-resolves per hour')
    .action(async (opts) => {
      const { saveAgentConfig } = await import('@/lib/ai/store.js');

      const updates: Record<string, unknown> = { workspaceId: 'default' };
      if (opts.enabled !== undefined) updates.enabled = opts.enabled === 'true';
      if (opts.mode) updates.mode = opts.mode;
      if (opts.threshold) updates.confidenceThreshold = parseFloat(opts.threshold);
      if (opts.provider) updates.provider = opts.provider;
      if (opts.model) updates.model = opts.model;
      if (opts.maxTokens) updates.maxTokens = parseInt(opts.maxTokens, 10);
      if (opts.piiDetection !== undefined) updates.piiDetection = opts.piiDetection === 'true';
      if (opts.maxPerHour) updates.maxAutoResolvesPerHour = parseInt(opts.maxPerHour, 10);

      const config = await saveAgentConfig(updates as Parameters<typeof saveAgentConfig>[0]);
      console.log('Updated config:');
      console.log(JSON.stringify(config, null, 2));
    });

  // ---- ai resolve ----
  ai.command('resolve')
    .description('Trigger AI resolution for a ticket')
    .argument('<ticketId>', 'Ticket ID')
    .action(async (ticketId: string) => {
      try {
        const { getDataProvider } = await import('@/lib/data-provider/index.js');
        const { getAgentConfig } = await import('@/lib/ai/store.js');
        const { resolveTicket } = await import('@/lib/ai/resolution-pipeline.js');

        const provider = await getDataProvider();
        const tickets = await provider.loadTickets();
        const ticket = tickets.find(t => t.id === ticketId || t.externalId === ticketId);
        if (!ticket) {
          console.error(`Ticket "${ticketId}" not found`);
          process.exitCode = 1;
          return;
        }

        const messages = await provider.loadMessages(ticket.id);
        let kbArticles: import('@/lib/data-provider/types.js').KBArticle[] = [];
        try { kbArticles = await provider.loadKBArticles(); } catch { /* no KB */ }

        const config = await getAgentConfig('default');
        const outcome = await resolveTicket(ticket, messages, kbArticles, {
          configOverride: { ...config, enabled: true },
          workspaceId: 'default',
        });

        console.log(JSON.stringify({
          action: outcome.action,
          resolutionId: outcome.resolutionId,
          confidence: outcome.result.confidence,
          reasoning: outcome.result.reasoning,
          suggestedReply: outcome.result.suggestedReply.slice(0, 500),
        }, null, 2));
      } catch (err) {
        console.error('Resolution failed:', err instanceof Error ? err.message : err);
        process.exitCode = 1;
      }
    });

  // ---- ai resolutions ----
  ai.command('resolutions')
    .description('List AI resolutions')
    .option('--status <status>', 'Filter by status (pending, auto_resolved, approved, rejected, escalated, error)')
    .option('--limit <n>', 'Max results', '20')
    .action(async (opts) => {
      const { listResolutions } = await import('@/lib/ai/store.js');
      const { records, total } = await listResolutions({
        status: opts.status,
        limit: parseInt(opts.limit, 10),
      });

      console.log(`Showing ${records.length} of ${total} resolutions:`);
      for (const r of records) {
        console.log(`  [${r.status}] ${r.id} ticket=${r.ticketId} conf=${r.confidence} ${r.createdAt}`);
      }
    });

  // ---- ai stats ----
  ai.command('stats')
    .description('Show AI resolution statistics')
    .action(async () => {
      const { getResolutionStats } = await import('@/lib/ai/store.js');
      const stats = await getResolutionStats();
      console.log(JSON.stringify(stats, null, 2));
    });

  // ---- ai approve ----
  ai.command('approve')
    .description('Approve a pending AI resolution')
    .argument('<id>', 'Resolution ID')
    .action(async (id: string) => {
      const { approveEntry } = await import('@/lib/ai/approval-queue.js');
      const result = await approveEntry(id, 'cli-user');
      if (!result) {
        console.error('Resolution not found or not in pending status');
        process.exitCode = 1;
        return;
      }
      console.log('Approved:', JSON.stringify(result, null, 2));
    });

  // ---- ai reject ----
  ai.command('reject')
    .description('Reject a pending AI resolution')
    .argument('<id>', 'Resolution ID')
    .action(async (id: string) => {
      const { rejectEntry } = await import('@/lib/ai/approval-queue.js');
      const result = await rejectEntry(id, 'cli-user');
      if (!result) {
        console.error('Resolution not found or not in pending status');
        process.exitCode = 1;
        return;
      }
      console.log('Rejected:', JSON.stringify(result, null, 2));
    });
}
