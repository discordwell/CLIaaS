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
    'starts, initializes, and lists all 30 tools',
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
        expect(tools.length).toBe(30);

        const toolNames = tools.map((t: { name: string }) => t.name).sort();
        expect(toolNames).toEqual([
          'ai_resolve',
          'config_set_provider',
          'config_show',
          'detect_duplicates',
          'draft_reply',
          'kb_search',
          'kb_suggest',
          'queue_stats',
          'rag_ask',
          'rag_search',
          'rag_status',
          'rule_create',
          'rule_toggle',
          'sentiment_analyze',
          'sla_report',
          'summarize_queue',
          'sync_conflicts',
          'sync_pull',
          'sync_push',
          'sync_status',
          'sync_trigger',
          'ticket_create',
          'ticket_note',
          'ticket_reply',
          'ticket_update',
          'tickets_list',
          'tickets_search',
          'tickets_show',
          'triage_batch',
          'triage_ticket',
        ]);
      } finally {
        child.kill();
      }
    },
  );
});
