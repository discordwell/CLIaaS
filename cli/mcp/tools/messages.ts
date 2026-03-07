/**
 * MCP message tools: message_list, message_show, message_create, message_toggle, message_delete.
 */

import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { textResult, errorResult } from '../util.js';
import { withConfirmation, recordMCPAction } from './confirm.js';
import { scopeGuard } from './scopes.js';
import {
  getMessages,
  getMessage,
  createMessage,
  deleteMessage,
  toggleMessage,
  getMessageAnalytics,
} from '@/lib/messages/message-store.js';

export function registerMessageTools(server: McpServer): void {
  server.tool(
    'message_list',
    'List in-app messages',
    {},
    async () => {
      try {
        const messages = await getMessages();
        return textResult({
          total: messages.length,
          messages: messages.map(m => ({
            id: m.id,
            name: m.name,
            messageType: m.messageType,
            title: m.title,
            isActive: m.isActive,
            targetUrlPattern: m.targetUrlPattern,
          })),
        });
      } catch (err) {
        return errorResult(err instanceof Error ? err.message : 'Failed to list messages');
      }
    },
  );

  server.tool(
    'message_show',
    'Show message details and analytics',
    { messageId: z.string().describe('Message ID') },
    async ({ messageId }) => {
      const msg = await getMessage(messageId);
      if (!msg) return errorResult(`Message "${messageId}" not found`);
      const analytics = await getMessageAnalytics(messageId);
      return textResult({ message: msg, analytics });
    },
  );

  server.tool(
    'message_create',
    'Create a new in-app message (requires confirm=true)',
    {
      name: z.string().describe('Message name'),
      messageType: z.enum(['banner', 'modal', 'tooltip', 'slide_in']).describe('Display type'),
      title: z.string().describe('Message title'),
      body: z.string().optional().describe('Message body'),
      ctaText: z.string().optional().describe('CTA button text'),
      ctaUrl: z.string().optional().describe('CTA button URL'),
      targetUrlPattern: z.string().optional().describe('URL pattern where message appears'),
      maxImpressions: z.number().optional().describe('Max impressions per customer (0=unlimited)'),
      confirm: z.boolean().optional().describe('Must be true to create'),
    },
    async ({ name, messageType, title, body, ctaText, ctaUrl, targetUrlPattern, maxImpressions, confirm }) => {
      const guard = scopeGuard('message_create');
      if (guard) return guard;

      const result = withConfirmation(confirm, {
        description: `Create ${messageType} message: "${name}"`,
        preview: { name, messageType, title },
        execute: () => {
          const msg = createMessage({ name, messageType, title, body, ctaText, ctaUrl, targetUrlPattern, maxImpressions });
          recordMCPAction({
            tool: 'message_create', action: 'create',
            params: { name, messageType }, timestamp: new Date().toISOString(), result: 'success',
          });
          return { created: true, message: { id: msg.id, name: msg.name, messageType: msg.messageType } };
        },
      });

      if (result.needsConfirmation) return result.result;
      return textResult(await result.value);
    },
  );

  server.tool(
    'message_toggle',
    'Toggle a message active/inactive (requires confirm=true)',
    {
      messageId: z.string().describe('Message ID'),
      confirm: z.boolean().optional().describe('Must be true to toggle'),
    },
    async ({ messageId, confirm }) => {
      const guard = scopeGuard('message_toggle');
      if (guard) return guard;

      const msg = await getMessage(messageId);
      if (!msg) return errorResult(`Message "${messageId}" not found`);

      const result = withConfirmation(confirm, {
        description: `Toggle message "${msg.name}" (currently ${msg.isActive ? 'active' : 'inactive'})`,
        preview: { messageId, currentlyActive: msg.isActive },
        execute: async () => {
          const toggled = await toggleMessage(messageId);
          return { toggled: true, isActive: toggled!.isActive };
        },
      });

      if (result.needsConfirmation) return result.result;
      return textResult(await result.value);
    },
  );

  server.tool(
    'message_delete',
    'Delete an in-app message (requires confirm=true)',
    {
      messageId: z.string().describe('Message ID'),
      confirm: z.boolean().optional().describe('Must be true to delete'),
    },
    async ({ messageId, confirm }) => {
      const guard = scopeGuard('message_delete');
      if (guard) return guard;

      const msg = await getMessage(messageId);
      if (!msg) return errorResult(`Message "${messageId}" not found`);

      const result = withConfirmation(confirm, {
        description: `Delete message "${msg.name}"`,
        preview: { messageId, messageName: msg.name },
        execute: () => {
          deleteMessage(messageId);
          return { deleted: true };
        },
      });

      if (result.needsConfirmation) return result.result;
      return textResult(await result.value);
    },
  );
}
