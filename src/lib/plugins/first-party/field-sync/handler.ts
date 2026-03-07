/**
 * Field Sync plugin handler.
 * Copies field values between ticket fields based on configurable mapping rules.
 * In production, this would call the ticket API to apply field updates.
 */

import type { PluginHookContext, PluginHandlerResult } from '../../types';

interface FieldMapping {
  source: string;
  target: string;
}

export async function handle(context: PluginHookContext): Promise<PluginHandlerResult> {
  const { event, data, config } = context;
  const cfg = config ?? {};

  if (event !== 'ticket.created' && event !== 'ticket.updated') {
    return { ok: true, data: { skipped: true, reason: `Unsupported event: ${event}` } };
  }

  const mappings = (cfg.mappings as FieldMapping[]) || [];
  if (mappings.length === 0) {
    return { ok: true, data: { skipped: true, reason: 'No field mappings configured' } };
  }

  const ticketId = (data.ticketId as string) || 'unknown';
  const fields = (data.fields as Record<string, unknown>) || data;
  const appliedMappings: Array<{ source: string; target: string; value: unknown }> = [];
  const skippedMappings: Array<{ source: string; target: string; reason: string }> = [];

  for (const mapping of mappings) {
    const sourceValue = fields[mapping.source];
    if (sourceValue === undefined || sourceValue === null) {
      skippedMappings.push({
        source: mapping.source,
        target: mapping.target,
        reason: 'Source field is empty or missing',
      });
      continue;
    }

    appliedMappings.push({
      source: mapping.source,
      target: mapping.target,
      value: sourceValue,
    });
  }

  // In production: PATCH ticket fields with the mapped values
  return {
    ok: true,
    data: {
      action: 'sync_fields',
      ticketId,
      applied: appliedMappings,
      skipped: skippedMappings,
      totalMappings: mappings.length,
    },
  };
}
