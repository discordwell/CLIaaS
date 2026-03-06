/**
 * MCP tools for side conversations.
 */

import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { textResult, errorResult } from '../util.js';
import { withConfirmation, recordMCPAction } from './confirm.js';
import { scopeGuard } from './scopes.js';

export function registerSideConversationTools(server: McpServer): void {
  // ---- side_conversation_list ----
  server.tool(
    'side_conversation_list',
    'List side conversations for a ticket',
    {
      ticketId: z.string().describe('Ticket ID'),
    },
    async ({ ticketId }) => {
      const guard = scopeGuard('side_conversation_list');
      if (guard) return guard;

      try {
        const { listSideConversations } = await import('@/lib/side-conversations.js');
        const conversations = await listSideConversations(ticketId);
        return textResult({
          count: conversations.length,
          conversations: conversations.map((c) => ({
            id: c.id,
            subject: c.subject,
            externalEmail: c.externalEmail,
            status: c.status,
            messageCount: c.messageCount,
            createdAt: c.createdAt,
          })),
        });
      } catch (err) {
        return errorResult(err instanceof Error ? err.message : 'Failed to list side conversations');
      }
    },
  );

  // ---- side_conversation_create ----
  server.tool(
    'side_conversation_create',
    'Create a side conversation on a ticket (requires confirm=true)',
    {
      ticketId: z.string().describe('Ticket ID'),
      subject: z.string().describe('Side conversation subject'),
      body: z.string().describe('Initial message body'),
      externalEmail: z.string().optional().describe('External party email (optional)'),
      sendEmail: z.boolean().optional().describe('Send email to external party'),
      confirm: z.boolean().optional().describe('Must be true to create'),
    },
    async ({ ticketId, subject, body, externalEmail, sendEmail, confirm }) => {
      const guard = scopeGuard('side_conversation_create');
      if (guard) return guard;

      const result = withConfirmation(confirm, {
        description: `Create side conversation on ticket ${ticketId}`,
        preview: { ticketId, subject, bodyLength: body.length, externalEmail, sendEmail },
        execute: async () => {
          try {
            const { createSideConversation } = await import('@/lib/side-conversations.js');
            const res = await createSideConversation({
              ticketId,
              subject,
              body,
              externalEmail,
              authorId: 'mcp-agent',
              workspaceId: 'default',
              sendEmail,
            });

            recordMCPAction({
              tool: 'side_conversation_create', action: 'create',
              params: { ticketId, subject },
              timestamp: new Date().toISOString(), result: 'success',
            });

            return { created: true, ...res };
          } catch (err) {
            return { error: err instanceof Error ? err.message : 'Failed to create' };
          }
        },
      });

      if (result.needsConfirmation) return result.result;
      return textResult(await result.value);
    },
  );

  // ---- side_conversation_reply ----
  server.tool(
    'side_conversation_reply',
    'Reply to a side conversation (requires confirm=true)',
    {
      conversationId: z.string().describe('Side conversation ID'),
      body: z.string().describe('Reply body'),
      sendEmail: z.boolean().optional().describe('Send email to external party'),
      confirm: z.boolean().optional().describe('Must be true to send'),
    },
    async ({ conversationId, body, sendEmail, confirm }) => {
      const guard = scopeGuard('side_conversation_reply');
      if (guard) return guard;

      const result = withConfirmation(confirm, {
        description: `Reply to side conversation ${conversationId}`,
        preview: { conversationId, bodyLength: body.length, sendEmail },
        execute: async () => {
          try {
            const { replySideConversation } = await import('@/lib/side-conversations.js');
            const res = await replySideConversation({
              conversationId,
              body,
              authorId: 'mcp-agent',
              sendEmail,
            });

            recordMCPAction({
              tool: 'side_conversation_reply', action: 'reply',
              params: { conversationId, bodyLength: body.length },
              timestamp: new Date().toISOString(), result: 'success',
            });

            return { sent: true, ...res };
          } catch (err) {
            return { error: err instanceof Error ? err.message : 'Failed to reply' };
          }
        },
      });

      if (result.needsConfirmation) return result.result;
      return textResult(await result.value);
    },
  );
}
