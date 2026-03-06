/**
 * MCP canned response, macro & signature tools.
 * 10 tools: search/get/create/update/delete canned, resolve_template,
 * apply_macro, list_macros, create_macro, get_signature.
 */

import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { textResult, errorResult, safeLoadTickets, findTicket } from '../util.js';
import { withConfirmation, recordMCPAction } from './confirm.js';
import { scopeGuard } from './scopes.js';
import {
  getCannedResponses,
  getCannedResponse,
  createCannedResponse,
  updateCannedResponse,
  deleteCannedResponse,
  incrementCannedUsage,
} from '@/lib/canned/canned-store.js';
import {
  getMacros,
  getMacro,
  createMacro,
  incrementMacroUsage,
  type MacroAction,
} from '@/lib/canned/macro-store.js';
import { getDefaultSignature } from '@/lib/canned/signature-store.js';
import { resolveMergeVariables, type MergeContext } from '@/lib/canned/merge.js';
import { executeMacroActions } from '@/lib/canned/macro-executor.js';

export function registerCannedTools(server: McpServer): void {
  // ---- search_canned_responses ----
  server.tool(
    'search_canned_responses',
    'Search canned responses by title, category, or body content',
    {
      query: z.string().optional().describe('Search text in title/body'),
      category: z.string().optional().describe('Filter by category'),
      scope: z.enum(['personal', 'shared']).optional().describe('Filter by scope'),
      limit: z.number().optional().describe('Max results (default 10)'),
    },
    async ({ query, category, scope, limit }) => {
      try {
        let responses = await getCannedResponses({ search: query, category, scope });
        if (limit) responses = responses.slice(0, limit);
        return textResult({
          count: responses.length,
          cannedResponses: responses.map(r => ({
            id: r.id, title: r.title, category: r.category, scope: r.scope,
            shortcut: r.shortcut, usageCount: r.usageCount,
            bodyPreview: r.body.slice(0, 100),
          })),
        });
      } catch (err) {
        return errorResult(err instanceof Error ? err.message : 'Failed to search');
      }
    },
  );

  // ---- get_canned_response ----
  server.tool(
    'get_canned_response',
    'Get a canned response by ID with full body',
    {
      id: z.string().describe('Canned response ID'),
      ticketId: z.string().optional().describe('Ticket ID to resolve merge variables'),
      dir: z.string().optional().describe('Export directory override'),
    },
    async ({ id, ticketId, dir }) => {
      try {
        const cr = getCannedResponse(id);
        if (!cr) return errorResult(`Canned response "${id}" not found.`);

        let resolvedBody = cr.body;
        if (ticketId) {
          const tickets = await safeLoadTickets(dir);
          const ticket = findTicket(tickets, ticketId);
          const context: MergeContext = {
            ticket: ticket ? { id: ticket.id, subject: ticket.subject, status: ticket.status, priority: ticket.priority } : { id: ticketId },
            customer: ticket ? { name: ticket.requester, email: ticket.requester } : undefined,
          };
          resolvedBody = resolveMergeVariables(cr.body, context);
          incrementCannedUsage(id);
        }

        return textResult({ ...cr, resolvedBody });
      } catch (err) {
        return errorResult(err instanceof Error ? err.message : 'Failed');
      }
    },
  );

  // ---- create_canned_response ----
  server.tool(
    'create_canned_response',
    'Create a new canned response (requires confirm=true)',
    {
      title: z.string().describe('Title'),
      body: z.string().describe('Body text (supports {{merge.vars}})'),
      category: z.string().optional().describe('Category'),
      scope: z.enum(['personal', 'shared']).optional().describe('Scope'),
      shortcut: z.string().optional().describe('Shortcut like /thanks'),
      confirm: z.boolean().optional().describe('Must be true to create'),
    },
    async ({ title, body, category, scope, shortcut, confirm }) => {
      const guard = scopeGuard('create_canned_response');
      if (guard) return guard;

      const result = withConfirmation(confirm, {
        description: `Create canned response: "${title}"`,
        preview: { title, category, scope, shortcut },
        execute: () => {
          const cr = createCannedResponse({ title, body, category, scope, shortcut });
          recordMCPAction({ tool: 'create_canned_response', action: 'create', params: { title }, timestamp: new Date().toISOString(), result: 'success' });
          return { created: true, id: cr.id, title: cr.title };
        },
      });

      if (result.needsConfirmation) return result.result;
      return textResult(result.value);
    },
  );

  // ---- update_canned_response ----
  server.tool(
    'update_canned_response',
    'Update an existing canned response (requires confirm=true)',
    {
      id: z.string().describe('Canned response ID'),
      title: z.string().optional(),
      body: z.string().optional(),
      category: z.string().optional(),
      scope: z.enum(['personal', 'shared']).optional(),
      shortcut: z.string().optional(),
      confirm: z.boolean().optional().describe('Must be true to update'),
    },
    async ({ id, title, body, category, scope, shortcut, confirm }) => {
      const guard = scopeGuard('update_canned_response');
      if (guard) return guard;

      const existing = getCannedResponse(id);
      if (!existing) return errorResult(`Not found: ${id}`);

      const result = withConfirmation(confirm, {
        description: `Update canned response: "${existing.title}"`,
        preview: { id, title, body: body?.slice(0, 50), category, scope },
        execute: () => {
          const updated = updateCannedResponse(id, { title, body, category, scope, shortcut });
          recordMCPAction({ tool: 'update_canned_response', action: 'update', params: { id }, timestamp: new Date().toISOString(), result: 'success' });
          return { updated: true, id, title: updated?.title };
        },
      });

      if (result.needsConfirmation) return result.result;
      return textResult(result.value);
    },
  );

  // ---- delete_canned_response ----
  server.tool(
    'delete_canned_response',
    'Delete a canned response (requires confirm=true)',
    {
      id: z.string().describe('Canned response ID'),
      confirm: z.boolean().optional().describe('Must be true to delete'),
    },
    async ({ id, confirm }) => {
      const guard = scopeGuard('delete_canned_response');
      if (guard) return guard;

      const existing = getCannedResponse(id);
      if (!existing) return errorResult(`Not found: ${id}`);

      const result = withConfirmation(confirm, {
        description: `Delete canned response: "${existing.title}"`,
        preview: { id, title: existing.title },
        execute: () => {
          deleteCannedResponse(id);
          recordMCPAction({ tool: 'delete_canned_response', action: 'delete', params: { id }, timestamp: new Date().toISOString(), result: 'success' });
          return { deleted: true, id };
        },
      });

      if (result.needsConfirmation) return result.result;
      return textResult(result.value);
    },
  );

  // ---- resolve_template ----
  server.tool(
    'resolve_template',
    'Resolve merge variables in arbitrary text against a ticket context',
    {
      text: z.string().describe('Template text with {{merge.vars}}'),
      ticketId: z.string().describe('Ticket ID for context'),
      dir: z.string().optional().describe('Export directory override'),
    },
    async ({ text, ticketId, dir }) => {
      try {
        const tickets = await safeLoadTickets(dir);
        const ticket = findTicket(tickets, ticketId);
        const context: MergeContext = {
          ticket: ticket ? { id: ticket.id, subject: ticket.subject, status: ticket.status, priority: ticket.priority } : { id: ticketId },
          customer: ticket ? { name: ticket.requester, email: ticket.requester } : undefined,
        };
        const resolved = resolveMergeVariables(text, context);
        return textResult({ resolved });
      } catch (err) {
        return errorResult(err instanceof Error ? err.message : 'Failed to resolve');
      }
    },
  );

  // ---- list_macros ----
  server.tool(
    'list_macros',
    'List available macros with action summaries',
    {
      scope: z.enum(['personal', 'shared']).optional().describe('Filter by scope'),
      enabled: z.boolean().optional().describe('Filter by enabled status'),
    },
    async ({ scope, enabled }) => {
      try {
        const macros = await getMacros({ scope, enabled });
        return textResult({
          count: macros.length,
          macros: macros.map(m => ({
            id: m.id, name: m.name, description: m.description,
            enabled: m.enabled, usageCount: m.usageCount,
            actions: m.actions.map(a => `${a.type}: ${a.value ?? a.field ?? ''}`).join(', '),
          })),
        });
      } catch (err) {
        return errorResult(err instanceof Error ? err.message : 'Failed');
      }
    },
  );

  // ---- create_macro ----
  server.tool(
    'create_macro',
    'Create a new macro (requires confirm=true)',
    {
      name: z.string().describe('Macro name'),
      description: z.string().optional().describe('Description'),
      actions: z.array(z.object({
        type: z.string().describe('Action type'),
        value: z.string().optional().describe('Action value'),
        field: z.string().optional().describe('Field name (for set_custom_field)'),
      })).describe('Array of actions'),
      scope: z.enum(['personal', 'shared']).optional(),
      confirm: z.boolean().optional().describe('Must be true to create'),
    },
    async ({ name, description, actions, scope, confirm }) => {
      const guard = scopeGuard('create_macro');
      if (guard) return guard;

      const result = withConfirmation(confirm, {
        description: `Create macro: "${name}" with ${actions.length} action(s)`,
        preview: { name, actions: actions.length },
        execute: () => {
          const m = createMacro({ name, description, actions: actions as MacroAction[], scope });
          recordMCPAction({ tool: 'create_macro', action: 'create', params: { name }, timestamp: new Date().toISOString(), result: 'success' });
          return { created: true, id: m.id, name: m.name };
        },
      });

      if (result.needsConfirmation) return result.result;
      return textResult(result.value);
    },
  );

  // ---- apply_macro (native) ----
  server.tool(
    'apply_native_macro',
    'Apply a native macro to a ticket (requires confirm=true)',
    {
      macroId: z.string().describe('Macro ID'),
      ticketId: z.string().describe('Ticket ID'),
      confirm: z.boolean().optional().describe('Must be true to apply'),
      dir: z.string().optional().describe('Export directory override'),
    },
    async ({ macroId, ticketId, confirm, dir }) => {
      const guard = scopeGuard('apply_native_macro');
      if (guard) return guard;

      const macro = getMacro(macroId);
      if (!macro) return errorResult(`Macro "${macroId}" not found.`);

      const tickets = await safeLoadTickets(dir);
      const ticket = findTicket(tickets, ticketId);
      if (!ticket) return errorResult(`Ticket "${ticketId}" not found.`);

      const result = withConfirmation(confirm, {
        description: `Apply macro "${macro.name}" to ticket ${ticket.id}`,
        preview: { macroId, macroName: macro.name, ticketId: ticket.id, actions: macro.actions.length },
        execute: () => {
          const context: MergeContext = {
            ticket: { id: ticket.id, subject: ticket.subject, status: ticket.status, priority: ticket.priority },
            customer: { name: ticket.requester, email: ticket.requester },
          };
          const ticketCtx = {
            id: ticket.id,
            status: ticket.status,
            priority: ticket.priority,
            assignee: ticket.assignee ?? null,
            tags: [...ticket.tags],
          };

          const execResult = executeMacroActions(macro.actions, ticketCtx, context);
          incrementMacroUsage(macroId);

          // Apply changes to in-memory ticket
          if (execResult.changes.status) ticket.status = execResult.changes.status as typeof ticket.status;
          if (execResult.changes.priority) ticket.priority = execResult.changes.priority as typeof ticket.priority;
          if (execResult.changes.assignee !== undefined) ticket.assignee = (execResult.changes.assignee as string) || undefined;

          recordMCPAction({ tool: 'apply_native_macro', action: 'apply', params: { macroId, ticketId: ticket.id }, timestamp: new Date().toISOString(), result: 'success' });

          return {
            applied: true,
            macroName: macro.name,
            ticketId: ticket.id,
            actionsExecuted: execResult.actionsExecuted,
            changes: execResult.changes,
            replies: execResult.replies,
            notes: execResult.notes,
            errors: execResult.errors,
          };
        },
      });

      if (result.needsConfirmation) return result.result;
      return textResult(result.value);
    },
  );

  // ---- get_signature ----
  server.tool(
    'get_signature',
    'Get the active/default signature for an agent',
    {
      userId: z.string().optional().describe('User ID (defaults to workspace default)'),
    },
    async ({ userId }) => {
      try {
        const sig = getDefaultSignature(userId);
        if (!sig) return textResult({ found: false, message: 'No default signature configured' });
        return textResult({
          found: true,
          signature: {
            id: sig.id, name: sig.name, bodyText: sig.bodyText, bodyHtml: sig.bodyHtml,
          },
        });
      } catch (err) {
        return errorResult(err instanceof Error ? err.message : 'Failed');
      }
    },
  );
}
