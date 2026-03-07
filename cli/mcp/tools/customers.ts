/**
 * MCP customer tools: customer_show, customer_timeline, customer_note, customer_merge.
 * customer_note and customer_merge use the confirmation pattern.
 */

import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { textResult, errorResult } from '../util.js';
import { withConfirmation, recordMCPAction } from './confirm.js';
import { scopeGuard } from './scopes.js';
import { getDataProvider } from '@/lib/data-provider/index.js';
import {
  getCustomerActivities,
  getCustomerNotes,
  addCustomerNote,
  mergeCustomers,
} from '@/lib/customers/customer-store.js';

export function registerCustomerTools(server: McpServer): void {
  // ---- customer_show ----
  server.tool(
    'customer_show',
    'Show enriched customer detail by ID or email',
    {
      identifier: z.string().describe('Customer ID or email address'),
      dir: z.string().optional().describe('Export directory override'),
    },
    async ({ identifier, dir }) => {
      try {
        const provider = await getDataProvider(dir);
        const customers = await provider.loadCustomers();
        const lower = identifier.toLowerCase();
        const customer = customers.find(
          (c) => c.id === identifier || c.email?.toLowerCase() === lower,
        );

        if (!customer) {
          return errorResult(`Customer not found: "${identifier}"`);
        }

        const activities = await getCustomerActivities(customer.id);
        const notes = await getCustomerNotes(customer.id);

        return textResult({
          ...customer,
          activityCount: activities.length,
          noteCount: notes.length,
          recentActivities: activities.slice(0, 5),
          recentNotes: notes.slice(0, 3),
        });
      } catch (err) {
        return errorResult(
          err instanceof Error ? err.message : 'Failed to load customer',
        );
      }
    },
  );

  // ---- customer_timeline ----
  server.tool(
    'customer_timeline',
    'List recent activities for a customer',
    {
      customerId: z.string().describe('Customer ID'),
      limit: z.number().optional().describe('Max activities to return (default 20)'),
    },
    async ({ customerId, limit }) => {
      try {
        const activities = await getCustomerActivities(customerId);
        const maxItems = limit ?? 20;

        if (activities.length === 0) {
          return textResult({
            customerId,
            activities: [],
            message: 'No activities found for this customer.',
          });
        }

        return textResult({
          customerId,
          total: activities.length,
          showing: Math.min(activities.length, maxItems),
          activities: activities.slice(0, maxItems),
        });
      } catch (err) {
        return errorResult(
          err instanceof Error ? err.message : 'Failed to load timeline',
        );
      }
    },
  );

  // ---- customer_note ----
  server.tool(
    'customer_note',
    'Add a note to a customer (requires confirm=true)',
    {
      customerId: z.string().describe('Customer ID'),
      noteType: z
        .enum(['note', 'call_log', 'meeting'])
        .optional()
        .describe('Type of note (default: note)'),
      body: z.string().describe('Note body text'),
      authorId: z.string().optional().describe('Author user ID'),
      confirm: z.boolean().optional().describe('Must be true to create the note'),
    },
    async ({ customerId, noteType, body, authorId, confirm }) => {
      const guard = scopeGuard('customer_note');
      if (guard) return guard;

      const result = withConfirmation(confirm, {
        description: `Add ${noteType ?? 'note'} to customer ${customerId}`,
        preview: {
          customerId,
          noteType: noteType ?? 'note',
          bodyPreview: body.length > 200 ? body.slice(0, 200) + '...' : body,
        },
        execute: () => {
          const note = addCustomerNote({
            customerId,
            noteType: noteType ?? 'note',
            body,
            authorId,
          });

          const now = new Date().toISOString();
          recordMCPAction({
            tool: 'customer_note',
            action: 'create',
            params: { customerId, noteType: noteType ?? 'note' },
            timestamp: now,
            result: 'success',
          });

          return { created: true, note, timestamp: now };
        },
      });

      if (result.needsConfirmation) return result.result;
      const value = await result.value;
      return textResult(value);
    },
  );

  // ---- customer_merge ----
  server.tool(
    'customer_merge',
    'Merge two customers into one (requires confirm=true)',
    {
      primaryId: z.string().describe('Primary customer ID (will be kept)'),
      mergedId: z.string().describe('Customer ID to merge into primary (will be removed)'),
      confirm: z.boolean().optional().describe('Must be true to execute merge'),
      dir: z.string().optional().describe('Export directory override'),
    },
    async ({ primaryId, mergedId, confirm, dir }) => {
      const guard = scopeGuard('customer_merge');
      if (guard) return guard;

      if (primaryId === mergedId) {
        return errorResult('Cannot merge a customer with itself.');
      }

      try {
        const provider = await getDataProvider(dir);
        const customers = await provider.loadCustomers();
        const primary = customers.find((c) => c.id === primaryId);
        const merged = customers.find((c) => c.id === mergedId);

        if (!primary) return errorResult(`Primary customer not found: "${primaryId}"`);
        if (!merged) return errorResult(`Merged customer not found: "${mergedId}"`);

        const result = withConfirmation(confirm, {
          description: `Merge customer "${merged.name}" (${mergedId}) into "${primary.name}" (${primaryId})`,
          preview: {
            primary: { id: primary.id, name: primary.name, email: primary.email },
            merged: { id: merged.id, name: merged.name, email: merged.email },
          },
          execute: () => {
            const entry = mergeCustomers(
              primaryId,
              mergedId,
              { name: merged.name, email: merged.email, source: merged.source },
            );

            const now = new Date().toISOString();
            recordMCPAction({
              tool: 'customer_merge',
              action: 'merge',
              params: { primaryId, mergedId },
              timestamp: now,
              result: 'success',
            });

            return { merged: true, entry, timestamp: now };
          },
        });

        if (result.needsConfirmation) return result.result;
        const value = await result.value;
        return textResult(value);
      } catch (err) {
        return errorResult(
          err instanceof Error ? err.message : 'Failed to merge customers',
        );
      }
    },
  );
}
