/**
 * MCP workflow tools: workflow_list, workflow_create, workflow_get,
 * workflow_toggle, workflow_delete, workflow_export.
 */

import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { textResult, errorResult } from '../util.js';
import { scopeGuard } from './scopes.js';
import {
  getWorkflows,
  getWorkflow,
  upsertWorkflow,
  deleteWorkflow,
} from '@/lib/workflow/store.js';
import { decomposeWorkflowToRules, validateWorkflow } from '@/lib/workflow/decomposer.js';
import { syncSingleWorkflow } from '@/lib/workflow/sync.js';
import type { Workflow, WorkflowNode, WorkflowTransition } from '@/lib/workflow/types.js';
import { randomUUID } from 'crypto';

export function registerWorkflowTools(server: McpServer): void {
  // ---- workflow_list ----
  server.tool(
    'workflow_list',
    'List all workflows',
    {},
    async () => {
      try {
        const workflows = await getWorkflows();
        return textResult({
          count: workflows.length,
          workflows: workflows.map((w) => ({
            id: w.id,
            name: w.name,
            description: w.description,
            enabled: w.enabled,
            nodeCount: Object.keys(w.nodes).length,
            transitionCount: w.transitions.length,
            version: w.version,
            createdAt: w.createdAt,
            updatedAt: w.updatedAt,
          })),
        });
      } catch (err) {
        return errorResult(`Failed to list workflows: ${err}`);
      }
    },
  );

  // ---- workflow_create ----
  server.tool(
    'workflow_create',
    'Create a new workflow from a JSON definition',
    {
      name: z.string().describe('Workflow name'),
      nodes: z.string().describe('JSON string of nodes map: Record<string, WorkflowNode>'),
      transitions: z.string().describe('JSON string of transitions array: WorkflowTransition[]'),
      entryNodeId: z.string().describe('ID of the entry (trigger) node'),
      description: z.string().optional().describe('Optional description'),
      enabled: z.boolean().optional().describe('Enable immediately (default: false)'),
    },
    async ({ name, nodes: nodesJson, transitions: transitionsJson, entryNodeId, description, enabled }) => {
      const blocked = scopeGuard('workflow_create');
      if (blocked) return blocked;

      try {
        let nodes: Record<string, WorkflowNode>;
        let transitions: WorkflowTransition[];
        try {
          nodes = JSON.parse(nodesJson);
        } catch {
          return errorResult('Invalid JSON in nodes parameter');
        }
        try {
          transitions = JSON.parse(transitionsJson);
        } catch {
          return errorResult('Invalid JSON in transitions parameter');
        }

        if (!nodes[entryNodeId]) {
          return errorResult('entryNodeId must reference a valid node in the nodes map');
        }

        const now = new Date().toISOString();
        const workflow: Workflow = {
          id: randomUUID(),
          name,
          description,
          nodes,
          transitions,
          entryNodeId,
          enabled: enabled ?? false,
          version: 1,
          createdAt: now,
          updatedAt: now,
        };

        const validation = validateWorkflow(workflow);
        if (!validation.valid) {
          return errorResult(`Invalid workflow: ${validation.errors.join('; ')}`);
        }

        await upsertWorkflow(workflow);
        return textResult({
          message: `Workflow "${name}" created`,
          id: workflow.id,
          enabled: workflow.enabled,
          nodeCount: Object.keys(nodes).length,
          transitionCount: transitions.length,
        });
      } catch (err) {
        return errorResult(`Failed to create workflow: ${err}`);
      }
    },
  );

  // ---- workflow_get ----
  server.tool(
    'workflow_get',
    'Get workflow details including nodes and transitions',
    {
      id: z.string().describe('Workflow ID'),
    },
    async ({ id }) => {
      try {
        const workflow = await getWorkflow(id);
        if (!workflow) return errorResult(`Workflow "${id}" not found`);

        return textResult({
          ...workflow,
          summary: {
            nodeCount: Object.keys(workflow.nodes).length,
            transitionCount: workflow.transitions.length,
            nodeTypes: Object.values(workflow.nodes).reduce(
              (acc, n) => {
                acc[n.type] = (acc[n.type] || 0) + 1;
                return acc;
              },
              {} as Record<string, number>,
            ),
          },
        });
      } catch (err) {
        return errorResult(`Failed to get workflow: ${err}`);
      }
    },
  );

  // ---- workflow_toggle ----
  server.tool(
    'workflow_toggle',
    'Enable or disable a workflow',
    {
      id: z.string().describe('Workflow ID'),
      enabled: z.boolean().describe('true to enable, false to disable'),
    },
    async ({ id, enabled }) => {
      const blocked = scopeGuard('workflow_toggle');
      if (blocked) return blocked;

      try {
        const workflow = await getWorkflow(id);
        if (!workflow) return errorResult(`Workflow "${id}" not found`);

        workflow.enabled = enabled;
        workflow.updatedAt = new Date().toISOString();
        await upsertWorkflow(workflow);

        // Sync rules into the automation engine
        await syncSingleWorkflow(id, enabled);

        return textResult({
          message: `Workflow "${workflow.name}" ${enabled ? 'enabled' : 'disabled'}`,
          id: workflow.id,
          enabled,
        });
      } catch (err) {
        return errorResult(`Failed to toggle workflow: ${err}`);
      }
    },
  );

  // ---- workflow_delete ----
  server.tool(
    'workflow_delete',
    'Delete a workflow',
    {
      id: z.string().describe('Workflow ID'),
    },
    async ({ id }) => {
      const blocked = scopeGuard('workflow_delete');
      if (blocked) return blocked;

      try {
        const deleted = await deleteWorkflow(id);
        if (!deleted) return errorResult(`Workflow "${id}" not found`);

        // Remove workflow rules from the automation engine
        await syncSingleWorkflow(id, false);

        return textResult({ message: `Workflow "${id}" deleted` });
      } catch (err) {
        return errorResult(`Failed to delete workflow: ${err}`);
      }
    },
  );

  // ---- workflow_export ----
  server.tool(
    'workflow_export',
    'Export a workflow as rules-as-code JSON (includes decomposed rules)',
    {
      id: z.string().describe('Workflow ID'),
    },
    async ({ id }) => {
      try {
        const workflow = await getWorkflow(id);
        if (!workflow) return errorResult(`Workflow "${id}" not found`);

        const rules = decomposeWorkflowToRules(workflow);

        return textResult({
          format: 'cliaas-workflow-v1',
          workflow,
          exportedAt: new Date().toISOString(),
          ruleCount: rules.length,
          rules,
        });
      } catch (err) {
        return errorResult(`Failed to export workflow: ${err}`);
      }
    },
  );
}
