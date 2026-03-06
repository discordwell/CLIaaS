/**
 * MCP chatbot tools: 14 tools for chatbot management.
 */

import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { textResult, errorResult } from '../util.js';
import { scopeGuard } from './scopes.js';
import { getChatbots, getChatbot, upsertChatbot, deleteChatbot } from '@/lib/chatbot/store.js';
import { publishChatbot, rollbackChatbot, getChatbotVersions } from '@/lib/chatbot/versions.js';
import { evaluateBotResponse, initBotSession } from '@/lib/chatbot/runtime.js';
import { getFlowSummary } from '@/lib/chatbot/analytics.js';
import { CHATBOT_TEMPLATES } from '@/lib/chatbot/templates.js';
import type { ChatbotFlow, ChatbotNode, ChatbotSessionState } from '@/lib/chatbot/types.js';
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
            status: f.status ?? 'published',
            version: f.version ?? 1,
            nodeCount: Object.keys(f.nodes).length,
            description: f.description,
            createdAt: f.createdAt,
            updatedAt: f.updatedAt,
          })),
        });
      } catch (err) {
        return errorResult(`Failed to list chatbots: ${err}`);
      }
    },
  );

  // ---- chatbot_get ----
  server.tool(
    'chatbot_get',
    'Get a chatbot flow by ID with full node details',
    {
      id: z.string().describe('Chatbot flow ID'),
    },
    async ({ id }) => {
      const blocked = scopeGuard('chatbot_get');
      if (blocked) return blocked;

      try {
        const flow = await getChatbot(id);
        if (!flow) return errorResult(`Chatbot "${id}" not found`);
        return textResult({
          id: flow.id,
          name: flow.name,
          enabled: flow.enabled,
          status: flow.status,
          version: flow.version,
          rootNodeId: flow.rootNodeId,
          nodeCount: Object.keys(flow.nodes).length,
          nodes: Object.values(flow.nodes).map((n) => ({
            id: n.id,
            type: n.type,
            dataPreview: JSON.stringify(n.data).slice(0, 100),
            children: n.children,
          })),
          description: flow.description,
        });
      } catch (err) {
        return errorResult(`Failed to get chatbot: ${err}`);
      }
    },
  );

  // ---- chatbot_create ----
  server.tool(
    'chatbot_create',
    'Create a new chatbot flow from JSON or template',
    {
      name: z.string().describe('Flow name'),
      template: z.string().optional().describe(`Template key: ${CHATBOT_TEMPLATES.map((t) => t.key).join(', ')}`),
      nodes: z.string().optional().describe('JSON string of nodes map (not needed with template)'),
      rootNodeId: z.string().optional().describe('Root node ID (not needed with template)'),
      greeting: z.string().optional().describe('Optional greeting message'),
      enabled: z.boolean().optional().describe('Enable immediately (default: false)'),
    },
    async ({ name, template, nodes: nodesJson, rootNodeId, greeting, enabled }) => {
      const blocked = scopeGuard('chatbot_create');
      if (blocked) return blocked;

      try {
        const id = randomUUID();

        if (template) {
          const tpl = CHATBOT_TEMPLATES.find((t) => t.key === template);
          if (!tpl) {
            return errorResult(`Unknown template: ${template}. Available: ${CHATBOT_TEMPLATES.map((t) => t.key).join(', ')}`);
          }
          const flow = tpl.createFlow(id);
          flow.name = name;
          flow.enabled = enabled ?? false;
          await upsertChatbot(flow);
          return textResult({ message: `Chatbot "${name}" created from template "${template}"`, id, nodeCount: Object.keys(flow.nodes).length });
        }

        let nodes: Record<string, ChatbotNode>;
        try {
          nodes = JSON.parse(nodesJson ?? '{}');
        } catch {
          return errorResult('Invalid JSON in nodes parameter');
        }

        if (!rootNodeId || !nodes[rootNodeId]) {
          return errorResult('rootNodeId must reference a valid node');
        }

        const now = new Date().toISOString();
        const flow: ChatbotFlow = {
          id,
          name,
          nodes,
          rootNodeId,
          enabled: enabled ?? false,
          greeting,
          version: 1,
          status: 'draft',
          createdAt: now,
          updatedAt: now,
        };

        await upsertChatbot(flow);
        return textResult({ message: `Chatbot "${name}" created`, id, enabled: flow.enabled });
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

  // ---- chatbot_publish ----
  server.tool(
    'chatbot_publish',
    'Publish the current draft as a new version',
    {
      id: z.string().describe('Chatbot flow ID'),
      summary: z.string().optional().describe('Version summary'),
    },
    async ({ id, summary }) => {
      const blocked = scopeGuard('chatbot_publish');
      if (blocked) return blocked;

      try {
        const result = await publishChatbot(id, undefined, summary);
        if (!result) return errorResult(`Chatbot "${id}" not found`);
        return textResult({ message: `Published version ${result.version}`, version: result.version });
      } catch (err) {
        return errorResult(`Failed to publish: ${err}`);
      }
    },
  );

  // ---- chatbot_rollback ----
  server.tool(
    'chatbot_rollback',
    'Rollback to a previous version',
    {
      id: z.string().describe('Chatbot flow ID'),
      version: z.number().describe('Target version number'),
    },
    async ({ id, version }) => {
      const blocked = scopeGuard('chatbot_rollback');
      if (blocked) return blocked;

      try {
        const flow = await rollbackChatbot(id, version);
        if (!flow) return errorResult(`Version ${version} not found`);
        return textResult({ message: `Rolled back to version ${version}`, name: flow.name });
      } catch (err) {
        return errorResult(`Failed to rollback: ${err}`);
      }
    },
  );

  // ---- chatbot_versions ----
  server.tool(
    'chatbot_versions',
    'List version history for a chatbot',
    {
      id: z.string().describe('Chatbot flow ID'),
    },
    async ({ id }) => {
      const blocked = scopeGuard('chatbot_versions');
      if (blocked) return blocked;

      try {
        const versions = await getChatbotVersions(id);
        return textResult({
          count: versions.length,
          versions: versions.map((v) => ({
            version: v.version,
            summary: v.summary,
            createdBy: v.createdBy,
            createdAt: v.createdAt,
          })),
        });
      } catch (err) {
        return errorResult(`Failed to list versions: ${err}`);
      }
    },
  );

  // ---- chatbot_test ----
  server.tool(
    'chatbot_test',
    'Start a test chat session with a chatbot',
    {
      id: z.string().describe('Chatbot flow ID'),
    },
    async ({ id }) => {
      const blocked = scopeGuard('chatbot_test');
      if (blocked) return blocked;

      try {
        const flow = await getChatbot(id);
        if (!flow) return errorResult(`Chatbot "${id}" not found`);

        const state = initBotSession(flow);
        const resp = evaluateBotResponse(flow, state, '');

        return textResult({
          message: 'Test session started',
          botText: resp.text,
          buttons: resp.buttons?.map((b) => b.label),
          state: resp.newState,
          ended: resp.handoff || !resp.newState.currentNodeId,
        });
      } catch (err) {
        return errorResult(`Failed to start test: ${err}`);
      }
    },
  );

  // ---- chatbot_test_respond ----
  server.tool(
    'chatbot_test_respond',
    'Send a message in a test chat session',
    {
      id: z.string().describe('Chatbot flow ID'),
      message: z.string().describe('Customer message'),
      state: z.string().describe('JSON-encoded session state from chatbot_test'),
    },
    async ({ id, message, state: stateJson }) => {
      const blocked = scopeGuard('chatbot_test_respond');
      if (blocked) return blocked;

      try {
        const flow = await getChatbot(id);
        if (!flow) return errorResult(`Chatbot "${id}" not found`);

        let sessionState: ChatbotSessionState;
        try {
          sessionState = JSON.parse(stateJson);
        } catch {
          return errorResult('Invalid JSON in state parameter');
        }

        const resp = evaluateBotResponse(flow, sessionState, message);
        return textResult({
          botText: resp.text,
          buttons: resp.buttons?.map((b) => b.label),
          actions: resp.actions,
          handoff: resp.handoff,
          delay: resp.delay,
          state: resp.newState,
          ended: resp.handoff || !resp.newState.currentNodeId,
        });
      } catch (err) {
        return errorResult(`Failed to respond: ${err}`);
      }
    },
  );

  // ---- chatbot_analytics ----
  server.tool(
    'chatbot_analytics',
    'Get analytics summary for a chatbot',
    {
      id: z.string().describe('Chatbot flow ID'),
      days: z.number().optional().describe('Number of days (default 30)'),
    },
    async ({ id, days }) => {
      const blocked = scopeGuard('chatbot_analytics');
      if (blocked) return blocked;

      try {
        const summary = await getFlowSummary(id, days ?? 30);
        return textResult(summary);
      } catch (err) {
        return errorResult(`Failed to get analytics: ${err}`);
      }
    },
  );

  // ---- chatbot_export ----
  server.tool(
    'chatbot_export',
    'Export a chatbot flow as JSON',
    {
      id: z.string().describe('Chatbot flow ID'),
    },
    async ({ id }) => {
      const blocked = scopeGuard('chatbot_export');
      if (blocked) return blocked;

      try {
        const flow = await getChatbot(id);
        if (!flow) return errorResult(`Chatbot "${id}" not found`);
        return textResult(flow);
      } catch (err) {
        return errorResult(`Failed to export: ${err}`);
      }
    },
  );

  // ---- chatbot_import ----
  server.tool(
    'chatbot_import',
    'Import a chatbot flow from JSON',
    {
      flow: z.string().describe('JSON string of complete ChatbotFlow'),
    },
    async ({ flow: flowJson }) => {
      const blocked = scopeGuard('chatbot_import');
      if (blocked) return blocked;

      try {
        let flow: ChatbotFlow;
        try {
          flow = JSON.parse(flowJson);
        } catch {
          return errorResult('Invalid JSON');
        }

        if (!flow.id) flow.id = randomUUID();
        if (!flow.nodes || !flow.rootNodeId) {
          return errorResult('Flow must have nodes and rootNodeId');
        }

        await upsertChatbot(flow);
        return textResult({ message: `Imported "${flow.name}"`, id: flow.id });
      } catch (err) {
        return errorResult(`Failed to import: ${err}`);
      }
    },
  );

  // ---- chatbot_duplicate ----
  server.tool(
    'chatbot_duplicate',
    'Duplicate an existing chatbot flow',
    {
      id: z.string().describe('Source chatbot flow ID'),
      name: z.string().optional().describe('Name for the copy'),
    },
    async ({ id, name }) => {
      const blocked = scopeGuard('chatbot_duplicate');
      if (blocked) return blocked;

      try {
        const source = await getChatbot(id);
        if (!source) return errorResult(`Chatbot "${id}" not found`);

        const newId = randomUUID();
        const now = new Date().toISOString();
        const copy: ChatbotFlow = {
          ...source,
          id: newId,
          name: name ?? `${source.name} (copy)`,
          enabled: false,
          version: 1,
          status: 'draft',
          createdAt: now,
          updatedAt: now,
        };

        await upsertChatbot(copy);
        return textResult({ message: `Duplicated "${source.name}" as "${copy.name}"`, id: newId });
      } catch (err) {
        return errorResult(`Failed to duplicate: ${err}`);
      }
    },
  );
}
