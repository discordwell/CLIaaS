import { describe, it, expect } from 'vitest';
import { spawn } from 'child_process';
import { join } from 'path';

const SERVER_PATH = join(process.cwd(), 'cli/mcp/server.ts');

function sendJsonRpc(child: ReturnType<typeof spawn>, message: object): void {
  const json = JSON.stringify(message) + '\n';
  const msg = `Content-Length: ${Buffer.byteLength(json)}\r\n\r\n${json}`;
  child.stdin!.write(msg);
}

/**
 * Collect stdout and resolve when a JSON-RPC response with matching id is found.
 * Handles both Content-Length framed and raw JSON responses.
 */
function collectResponse(
  child: ReturnType<typeof spawn>,
  expectedId: number,
  timeoutMs = 20000,
): Promise<Record<string, unknown>> {
  return new Promise((resolve, reject) => {
    let accumulated = '';
    const timeout = setTimeout(() => {
      child.stdout!.off('data', onData);
      reject(new Error(`Timeout. Accumulated: ${accumulated.slice(0, 500)}`));
    }, timeoutMs);

    const onData = (chunk: Buffer) => {
      accumulated += chunk.toString();
      // Try to find a complete JSON object containing our id
      // Walk through accumulated looking for {...} blocks
      const lines = accumulated.split('\n');
      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed.startsWith('{')) continue;
        try {
          const parsed = JSON.parse(trimmed);
          if (parsed.id === expectedId) {
            clearTimeout(timeout);
            child.stdout!.off('data', onData);
            resolve(parsed);
            return;
          }
        } catch {
          // not complete json
        }
      }
    };

    child.stdout!.on('data', onData);
  });
}

function waitForStderr(child: ReturnType<typeof spawn>, pattern: string, timeoutMs = 15000): Promise<void> {
  return new Promise((resolve, reject) => {
    let buffer = '';
    const timeout = setTimeout(() => {
      child.stderr!.off('data', onData);
      reject(new Error(`Timeout waiting for stderr "${pattern}". Got: ${buffer.slice(0, 200)}`));
    }, timeoutMs);

    const onData = (data: Buffer) => {
      buffer += data.toString();
      if (buffer.includes(pattern)) {
        clearTimeout(timeout);
        child.stderr!.off('data', onData);
        resolve();
      }
    };

    child.stderr!.on('data', onData);
  });
}

describe('MCP Server', () => {
  it(
    'starts, initializes, and lists all registered tools',
    { timeout: 30000 },
    async () => {
      const child = spawn('npx', ['tsx', SERVER_PATH], {
        stdio: ['pipe', 'pipe', 'pipe'],
        env: { ...process.env },
      });

      try {
        // Wait for server to be ready
        await waitForStderr(child, 'CLIaaS MCP server connected');

        // Initialize — set up listener before sending
        const initPromise = collectResponse(child, 1);
        sendJsonRpc(child, {
          jsonrpc: '2.0',
          id: 1,
          method: 'initialize',
          params: {
            protocolVersion: '2024-11-05',
            capabilities: {},
            clientInfo: { name: 'test', version: '0.1.0' },
          },
        });

        const initResponse = await initPromise as {
          result?: { serverInfo?: { name: string } };
        };
        expect(initResponse.result).toBeDefined();
        expect(initResponse.result!.serverInfo?.name).toBe('cliaas');

        // Send initialized notification
        sendJsonRpc(child, {
          jsonrpc: '2.0',
          method: 'notifications/initialized',
        });

        // Request tools/list
        const toolsPromise = collectResponse(child, 2);
        sendJsonRpc(child, {
          jsonrpc: '2.0',
          id: 2,
          method: 'tools/list',
          params: {},
        });

        const toolsResponse = await toolsPromise as {
          result?: { tools?: Array<{ name: string }> };
        };
        expect(toolsResponse.result).toBeDefined();

        const tools = toolsResponse.result!.tools ?? [];
        // Tool count grows as modules are added; verify minimum and key tools
        expect(tools.length).toBeGreaterThanOrEqual(140);

        const toolNames = tools.map((t: { name: string }) => t.name).sort();

        // Verify key tools from each module are present
        const expectedSubset = [
          'agent_availability',
          'ai_resolve',
          'business_hours_list',
          'campaign_create',
          'chatbot_list',
          'config_show',
          'customer_show',
          'dashboard_live',
          'draft_reply',
          'forum_list',
          'group_list',
          'holiday_calendar_list',
          'kb_content_gaps',
          'kb_search',
          'macro_apply',
          'marketplace_search',
          'plugin_list',
          'qa_review',
          'queue_stats',
          'rag_search',
          'report_list',
          'report_run',
          'role_permissions',
          'roles_list',
          'route_ticket',
          'rule_create',
          'search_canned_responses',
          'side_conversation_create',
          'sla_report',
          'survey_stats',
          'sync_status',
          'tag_list',
          'ticket_add_collaborator',
          'ticket_collision_check',
          'ticket_create',
          'ticket_merge',
          'tickets_list',
          'time_log',
          'triage_ticket',
          'user_permissions',
          'view_list',
          'wfm_schedule_list',
          'workflow_list',
        ];
        for (const name of expectedSubset) {
          expect(toolNames).toContain(name);
        }
      } finally {
        child.kill();
      }
    },
  );
});
