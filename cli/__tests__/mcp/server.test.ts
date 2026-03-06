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
    'starts, initializes, and lists all 109 tools',
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
        expect(tools.length).toBe(112);

        const toolNames = tools.map((t: { name: string }) => t.name).sort();
        expect(toolNames).toEqual([
          'agent_availability',
          'agent_skills',
          'ai_resolve',
          'apply_native_macro',
          'campaign_create',
          'campaign_list',
          'campaign_send',
          'chatbot_create',
          'chatbot_delete',
          'chatbot_list',
          'chatbot_toggle',
          'config_set_provider',
          'config_show',
          'connector_capabilities',
          'create_canned_response',
          'create_macro',
          'customer_merge',
          'customer_note',
          'customer_show',
          'customer_timeline',
          'delete_canned_response',
          'detect_duplicates',
          'draft_reply',
          'forum_create',
          'forum_list',
          'forum_moderate',
          'get_canned_response',
          'get_signature',
          'kb_search',
          'kb_suggest',
          'list_macros',
          'macro_apply',
          'macro_list',
          'marketplace_search',
          'marketplace_show',
          'plugin_config',
          'plugin_install',
          'plugin_list',
          'plugin_logs',
          'plugin_toggle',
          'plugin_uninstall',
          'qa_dashboard',
          'qa_review',
          'queue_depth',
          'queue_stats',
          'rag_ask',
          'rag_search',
          'rag_status',
          'resolve_template',
          'route_ticket',
          'routing_status',
          'rule_create',
          'rule_delete',
          'rule_executions',
          'rule_get',
          'rule_list',
          'rule_test',
          'rule_toggle',
          'rule_update',
          'search_canned_responses',
          'sentiment_analyze',
          'side_conversation_create',
          'side_conversation_list',
          'side_conversation_reply',
          'sla_report',
          'summarize_queue',
          'survey_config',
          'survey_send',
          'survey_stats',
          'sync_conflicts',
          'sync_pull',
          'sync_push',
          'sync_status',
          'sync_trigger',
          'ticket_collision_check',
          'ticket_create',
          'ticket_merge',
          'ticket_note',
          'ticket_presence',
          'ticket_reply',
          'ticket_split',
          'ticket_update',
          'tickets_list',
          'tickets_search',
          'tickets_show',
          'time_log',
          'time_report',
          'triage_batch',
          'triage_ticket',
          'update_canned_response',
          'upstream_push',
          'upstream_retry',
          'upstream_status',
          'wfm_adherence',
          'wfm_agent_status',
          'wfm_agent_status_set',
          'wfm_forecast',
          'wfm_schedule_create',
          'wfm_schedule_list',
          'wfm_staffing',
          'wfm_template_create',
          'wfm_template_list',
          'wfm_time_off_decide',
          'wfm_time_off_list',
          'wfm_time_off_request',
          'wfm_utilization',
          'workflow_create',
          'workflow_delete',
          'workflow_export',
          'workflow_get',
          'workflow_list',
          'workflow_toggle',
        ]);
      } finally {
        child.kill();
      }
    },
  );
});
