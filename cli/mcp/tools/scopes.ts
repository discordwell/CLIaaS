/**
 * MCP tool scope controls — configurable limits on which write tools
 * are enabled and operational constraints.
 */

export interface MCPScopeConfig {
  enabledTools: Set<string>;
  maxBatchSize: number;
}

const ALL_WRITE_TOOLS = [
  'ticket_update',
  'ticket_reply',
  'ticket_note',
  'ticket_create',
  'rule_create',
  'rule_toggle',
  'ai_resolve',
];

export function loadScopes(): MCPScopeConfig {
  // Read from environment or use defaults
  const enabledList = process.env.MCP_ENABLED_TOOLS;
  const enabledTools = enabledList
    ? new Set(enabledList.split(',').map(t => t.trim()))
    : new Set(ALL_WRITE_TOOLS);

  const maxBatchSize = parseInt(process.env.MCP_MAX_BATCH_SIZE ?? '50', 10) || 50;

  return { enabledTools, maxBatchSize };
}

export function isToolEnabled(toolName: string): boolean {
  return loadScopes().enabledTools.has(toolName);
}
