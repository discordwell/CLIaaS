/**
 * Confirmation pattern for MCP write operations.
 * All write tools require an explicit `confirm: true` parameter.
 * When confirm is false/missing, returns a preview of what would change.
 */

import { textResult } from '../util.js';

export interface ConfirmableAction<T> {
  description: string;
  preview: Record<string, unknown>;
  execute: () => T | Promise<T>;
}

export function withConfirmation<T>(
  confirm: boolean | undefined,
  action: ConfirmableAction<T>,
): { needsConfirmation: true; result: ReturnType<typeof textResult> } | { needsConfirmation: false; value: T | Promise<T> } {
  if (!confirm) {
    return {
      needsConfirmation: true,
      result: textResult({
        confirmation_required: true,
        action: action.description,
        preview: action.preview,
        message: 'Set confirm=true to execute this action.',
      }),
    };
  }

  return { needsConfirmation: false, value: action.execute() };
}

// In-memory audit log for MCP actions
export interface MCPAuditEntry {
  tool: string;
  action: string;
  params: Record<string, unknown>;
  timestamp: string;
  result: 'success' | 'error';
  error?: string;
}

declare global {
  // eslint-disable-next-line no-var
  var __cliaasAuditMCP: MCPAuditEntry[] | undefined;
}

export function recordMCPAction(entry: MCPAuditEntry): void {
  const log = global.__cliaasAuditMCP ?? [];
  log.unshift(entry);
  if (log.length > 200) log.length = 200;
  global.__cliaasAuditMCP = log;
}

export function getMCPAuditLog(): MCPAuditEntry[] {
  return global.__cliaasAuditMCP ?? [];
}
