/**
 * MCP chatbot tools: chatbot_list, chatbot_create, chatbot_toggle, chatbot_delete.
 */

import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { textResult, errorResult } from '../util.js';
import { scopeGuard } from './scopes.js';
import { getChatbots, getChatbot, upsertChatbot, deleteChatbot } from '@/lib/chatbot/store.js';
import type { ChatbotFlow, ChatbotNode } from '@/lib/chatbot/types.js';
import { randomUUID } from 'crypto';

export function registerChatbotTools(server: McpServer): void {
  // ---- chatbot_list ----
  server.tool(
    'chatbot_list',
    'List all chatbot flows',
    {},
    async () => {
      const blocked = scopeGuard('chatbot_list');
      if (blocked) return blocked;

      try {
        const flows = await getChatbots();
        return textResult({
          count: flows.length,
          chatbots: flows.map((f) => ({
            id: f.id,
            name: f.name,
            enabled: f.enabled,
            nodeCount: Object.keys(f.nodes).length,
            createdAt: f.createdAt,
            updatedAt: f.updatedAt,
          })),
        });
      } catch (err) {
        return errorResult(`Failed to list chatbots: ${err}`);
      }
    },
  );

  // ---- chatbot_create ----
  server.tool(
    'chatbot_create',
    'Create a new chatbot flow from a JSON definition',
    {
      name: z.string().describe('Flow name'),
      nodes: z.string().describe('JSON string of nodes map: Record<string, ChatbotNode>'),
      rootNodeId: z.string().describe('ID of the root node'),
      greeting: z.string().optional().describe('Optional greeting message'),
      enabled: z.boolean().optional().describe('Enable immediately (default: false)'),
    },
    async ({ name, nodes: nodesJson, rootNodeId, greeting, enabled }) => {
      const blocked = scopeGuard('chatbot_create');
      if (blocked) return blocked;

      try {
        let nodes: Record<string, ChatbotNode>;
        try {
          nodes = JSON.parse(nodesJson);
        } catch {
          return errorResult('Invalid JSON in nodes parameter');
        }

        if (!nodes[rootNodeId]) {
          return errorResult('rootNodeId must reference a valid node in the nodes map');
        }

        const now = new Date().toISOString();
        const flow: ChatbotFlow = {
          id: randomUUID(),
          name,
          nodes,
          rootNodeId,
          enabled: enabled ?? false,
          greeting,
          createdAt: now,
          updatedAt: now,
        };

        await upsertChatbot(flow);
        return textResult({ message: `Chatbot "${name}" created`, id: flow.id, enabled: flow.enabled });
      } catch (err) {
        return errorResult(`Failed to create chatbot: ${err}`);
      }
    },
  );

  // ---- chatbot_toggle ----
  server.tool(
    'chatbot_toggle',
    'Enable or disable a chatbot flow',
    {
      id: z.string().describe('Chatbot flow ID'),
      enabled: z.boolean().describe('true to enable, false to disable'),
    },
    async ({ id, enabled }) => {
      const blocked = scopeGuard('chatbot_toggle');
      if (blocked) return blocked;

      try {
        const flow = await getChatbot(id);
        if (!flow) return errorResult(`Chatbot "${id}" not found`);

        flow.enabled = enabled;
        flow.updatedAt = new Date().toISOString();
        await upsertChatbot(flow);

        return textResult({
          message: `Chatbot "${flow.name}" ${enabled ? 'enabled' : 'disabled'}`,
          id: flow.id,
          enabled,
        });
      } catch (err) {
        return errorResult(`Failed to toggle chatbot: ${err}`);
      }
    },
  );

  // ---- chatbot_delete ----
  server.tool(
    'chatbot_delete',
    'Delete a chatbot flow',
    {
      id: z.string().describe('Chatbot flow ID'),
    },
    async ({ id }) => {
      const blocked = scopeGuard('chatbot_delete');
      if (blocked) return blocked;

      try {
        const deleted = await deleteChatbot(id);
        if (!deleted) return errorResult(`Chatbot "${id}" not found`);
        return textResult({ message: `Chatbot "${id}" deleted` });
      } catch (err) {
        return errorResult(`Failed to delete chatbot: ${err}`);
      }
    },
  );
}
