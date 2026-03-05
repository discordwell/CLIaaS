/**
 * MCP forum tools: forum_list, forum_create, forum_moderate.
 * forum_create and forum_moderate use the confirmation pattern.
 */

import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { textResult, errorResult } from '../util.js';
import { withConfirmation, recordMCPAction } from './confirm.js';
import { scopeGuard } from './scopes.js';
import {
  getCategories,
  getThreads,
  getThread,
  createThread,
  moderateThread,
  convertToTicket,
} from '@/lib/forums/forum-store.js';

export function registerForumTools(server: McpServer): void {
  // ---- forum_list ----
  server.tool(
    'forum_list',
    'List forum categories or threads. Returns categories by default, or threads when categoryId is provided.',
    {
      categoryId: z.string().optional().describe('Filter threads by category ID. Omit to list categories.'),
    },
    async ({ categoryId }) => {
      try {
        if (categoryId) {
          const threads = getThreads(categoryId);
          return textResult({
            categoryId,
            threadCount: threads.length,
            threads: threads.map((t) => ({
              id: t.id,
              title: t.title,
              status: t.status,
              isPinned: t.isPinned,
              replyCount: t.replyCount,
              viewCount: t.viewCount,
              lastActivityAt: t.lastActivityAt,
            })),
          });
        }

        const categories = getCategories();
        return textResult({
          categoryCount: categories.length,
          categories: categories.map((c) => {
            const threads = getThreads(c.id);
            return {
              id: c.id,
              name: c.name,
              slug: c.slug,
              description: c.description,
              threadCount: threads.length,
            };
          }),
        });
      } catch (err) {
        return errorResult(err instanceof Error ? err.message : 'Failed to list forums');
      }
    },
  );

  // ---- forum_create ----
  server.tool(
    'forum_create',
    'Create a new forum thread (requires confirm=true)',
    {
      categoryId: z.string().describe('Category ID to create the thread in'),
      title: z.string().describe('Thread title'),
      body: z.string().describe('Thread body content'),
      customerId: z.string().optional().describe('Customer ID of the author'),
      confirm: z.boolean().optional().describe('Must be true to execute'),
    },
    async ({ categoryId, title, body, customerId, confirm }) => {
      const guard = scopeGuard('forum_create');
      if (guard) return guard;

      try {
        const result = withConfirmation(confirm, {
          description: `Create forum thread "${title}" in category ${categoryId}`,
          preview: { categoryId, title, bodyPreview: body.slice(0, 100), customerId },
          execute: () => {
            const thread = createThread({
              categoryId,
              title,
              body,
              customerId,
              status: 'open',
              isPinned: false,
            });

            const now = new Date().toISOString();
            recordMCPAction({
              tool: 'forum_create', action: 'create_thread',
              params: { categoryId, title },
              timestamp: now, result: 'success',
            });

            return {
              created: true,
              thread: {
                id: thread.id,
                title: thread.title,
                categoryId: thread.categoryId,
                status: thread.status,
                createdAt: thread.createdAt,
              },
            };
          },
        });

        if (result.needsConfirmation) return result.result;
        return textResult(result.value);
      } catch (err) {
        return errorResult(err instanceof Error ? err.message : 'Failed to create thread');
      }
    },
  );

  // ---- forum_moderate ----
  server.tool(
    'forum_moderate',
    'Moderate a forum thread: close, pin, unpin, or convert to ticket (requires confirm=true)',
    {
      threadId: z.string().describe('Thread ID to moderate'),
      action: z.enum(['close', 'pin', 'unpin', 'convert']).describe('Moderation action'),
      ticketId: z.string().optional().describe('Ticket ID (required for convert action)'),
      confirm: z.boolean().optional().describe('Must be true to execute'),
    },
    async ({ threadId, action, ticketId, confirm }) => {
      const guard = scopeGuard('forum_moderate');
      if (guard) return guard;

      try {
        const thread = getThread(threadId);
        if (!thread) return errorResult(`Thread "${threadId}" not found.`);

        if (action === 'convert' && !ticketId) {
          return errorResult('ticketId is required for the convert action.');
        }

        const result = withConfirmation(confirm, {
          description: `${action} forum thread "${thread.title}"`,
          preview: { threadId, action, title: thread.title, ticketId },
          execute: () => {
            const now = new Date().toISOString();

            if (action === 'convert') {
              const updated = convertToTicket(threadId, ticketId!);
              recordMCPAction({
                tool: 'forum_moderate', action: 'convert',
                params: { threadId, ticketId },
                timestamp: now, result: 'success',
              });
              return { moderated: true, action: 'convert', threadId, ticketId, thread: updated };
            }

            const updated = moderateThread(threadId, action);
            recordMCPAction({
              tool: 'forum_moderate', action,
              params: { threadId },
              timestamp: now, result: 'success',
            });
            return { moderated: true, action, threadId, thread: updated };
          },
        });

        if (result.needsConfirmation) return result.result;
        return textResult(result.value);
      } catch (err) {
        return errorResult(err instanceof Error ? err.message : 'Failed to moderate thread');
      }
    },
  );
}
