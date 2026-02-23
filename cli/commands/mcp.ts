import type { Command } from 'commander';
import chalk from 'chalk';
import { writeFileSync, existsSync } from 'fs';
import { join, resolve } from 'path';
import { spawn } from 'child_process';

function buildMcpConfig() {
  return {
    mcpServers: {
      cliaas: {
        type: 'stdio',
        command: 'npx',
        args: ['tsx', 'cli/mcp/server.ts'],
        env: {
          CLIAAS_DATA_DIR: '${CLIAAS_DATA_DIR}',
          DATABASE_URL: '${DATABASE_URL}',
          RAG_DATABASE_URL: '${RAG_DATABASE_URL}',
        },
      },
    },
  };
}

export function registerMcpCommands(program: Command): void {
  const mcp = program
    .command('mcp')
    .description('MCP (Model Context Protocol) server management');

  mcp
    .command('install')
    .description('Write .mcp.json to the project root for Claude Code auto-discovery')
    .option('--dir <dir>', 'Project root directory', '.')
    .action((opts: { dir: string }) => {
      const projectRoot = resolve(opts.dir);
      const mcpJsonPath = join(projectRoot, '.mcp.json');

      writeFileSync(mcpJsonPath, JSON.stringify(buildMcpConfig(), null, 2) + '\n');
      console.log(chalk.green(`Wrote ${mcpJsonPath}`));
      console.log(chalk.gray('Claude Code will auto-discover the CLIaaS MCP server when working in this project.'));
    });

  mcp
    .command('test')
    .description('Verify the MCP server starts correctly and lists all tools')
    .action(async () => {
      console.log(chalk.cyan('Testing CLIaaS MCP server...\n'));

      const serverPath = join(process.cwd(), 'cli/mcp/server.ts');
      if (!existsSync(serverPath)) {
        console.error(chalk.red(`Server not found at ${serverPath}`));
        process.exit(1);
      }

      const child = spawn('npx', ['tsx', serverPath], {
        stdio: ['pipe', 'pipe', 'pipe'],
        env: { ...process.env },
      });

      let stdout = '';
      let stderr = '';

      child.stdout.on('data', (data: Buffer) => { stdout += data.toString(); });
      child.stderr.on('data', (data: Buffer) => { stderr += data.toString(); });

      // Send JSON-RPC initialize
      const initRequest = JSON.stringify({
        jsonrpc: '2.0',
        id: 1,
        method: 'initialize',
        params: {
          protocolVersion: '2024-11-05',
          capabilities: {},
          clientInfo: { name: 'cliaas-test', version: '0.1.0' },
        },
      }) + '\n';

      // Content-Length header for JSON-RPC over stdio
      const initMsg = `Content-Length: ${Buffer.byteLength(initRequest)}\r\n\r\n${initRequest}`;
      child.stdin.write(initMsg);

      // Wait for initialize response
      await new Promise<void>((resolvePromise) => {
        const timeout = setTimeout(() => {
          console.error(chalk.red('Timeout waiting for server response'));
          child.kill();
          process.exit(1);
        }, 10000);

        const checkResponse = () => {
          if (stdout.includes('"result"')) {
            clearTimeout(timeout);

            // Send initialized notification
            const initializedNotif = JSON.stringify({
              jsonrpc: '2.0',
              method: 'notifications/initialized',
            }) + '\n';
            const initializedMsg = `Content-Length: ${Buffer.byteLength(initializedNotif)}\r\n\r\n${initializedNotif}`;
            child.stdin.write(initializedMsg);

            // Send tools/list
            const listRequest = JSON.stringify({
              jsonrpc: '2.0',
              id: 2,
              method: 'tools/list',
              params: {},
            }) + '\n';
            const listMsg = `Content-Length: ${Buffer.byteLength(listRequest)}\r\n\r\n${listRequest}`;

            stdout = '';
            child.stdin.write(listMsg);

            const checkTools = () => {
              if (stdout.includes('"tools"')) {
                clearTimeout(toolsTimeout);
                resolvePromise();
              } else {
                setTimeout(checkTools, 100);
              }
            };

            const toolsTimeout = setTimeout(() => {
              console.error(chalk.red('Timeout waiting for tools/list response'));
              child.kill();
              process.exit(1);
            }, 10000);

            setTimeout(checkTools, 100);
          } else {
            setTimeout(checkResponse, 100);
          }
        };

        setTimeout(checkResponse, 100);
      });

      // Parse tools list from response
      try {
        let response: Record<string, unknown> | null = null;
        for (const line of stdout.split('\n')) {
          const trimmed = line.trim();
          if (!trimmed.startsWith('{')) continue;
          try {
            const parsed = JSON.parse(trimmed);
            if (parsed.result?.tools) { response = parsed; break; }
          } catch { /* not complete JSON */ }
        }
        if (response) {
          const result = response.result as { tools?: Array<{ name: string; description?: string }> } | undefined;
          const tools = result?.tools ?? [];

          console.log(chalk.green(`Server responded with ${tools.length} tools:\n`));
          for (const tool of tools) {
            console.log(`  ${chalk.bold(tool.name)} — ${chalk.gray(tool.description?.slice(0, 60) ?? '')}`);
          }

          console.log('');
          if (tools.length >= 18) {
            console.log(chalk.green(`All ${tools.length} tools registered.`));
          } else {
            console.log(chalk.yellow(`Expected 18 tools, got ${tools.length}.`));
          }
        }
      } catch (err) {
        console.error(chalk.red(`Failed to parse response: ${err}`));
        if (stderr) console.error(chalk.gray(`Server stderr: ${stderr}`));
      }

      child.kill();
    });

  mcp
    .command('setup')
    .description('Interactive guided setup for MCP + database configuration')
    .action(async () => {
      console.log(chalk.cyan.bold('\nCLIaaS MCP Setup\n'));
      console.log(chalk.gray('This will configure the MCP server and optionally set up a database.\n'));

      // Check if .mcp.json already exists
      const mcpJsonPath = join(process.cwd(), '.mcp.json');
      if (existsSync(mcpJsonPath)) {
        console.log(chalk.yellow('.mcp.json already exists. Skipping install step.'));
      } else {
        console.log(chalk.green('Writing .mcp.json...'));
        writeFileSync(mcpJsonPath, JSON.stringify(buildMcpConfig(), null, 2) + '\n');
        console.log(chalk.green('Wrote .mcp.json'));
      }

      // Check for data
      const hasData = existsSync('./exports/zendesk/tickets.jsonl') ||
        existsSync('./exports/kayako/tickets.jsonl') ||
        existsSync('./exports/tickets.jsonl');

      if (hasData) {
        console.log(chalk.green('Ticket data found.'));
      } else {
        console.log(chalk.yellow('No ticket data found. Generate demo data with: cliaas demo'));
      }

      // Check for database
      if (process.env.DATABASE_URL || process.env.RAG_DATABASE_URL) {
        console.log(chalk.green('Database URL configured.'));
      } else {
        console.log(chalk.yellow('No database URL set. RAG features require a pgvector database.'));
        console.log(chalk.gray('  Self-hosted:  docker compose up -d && set DATABASE_URL in .env'));
        console.log(chalk.gray('  Then run:     cliaas rag init'));
      }

      // Check provider config
      const envClaude = process.env.ANTHROPIC_API_KEY ?? process.env.CLAUDE_API_KEY;
      const envOpenAI = process.env.OPENAI_API_KEY;

      if (envClaude) {
        console.log(chalk.green('Claude API key found in environment.'));
      } else if (envOpenAI) {
        console.log(chalk.green('OpenAI API key found in environment.'));
      } else {
        console.log(chalk.yellow('No LLM API key found. Set ANTHROPIC_API_KEY or OPENAI_API_KEY.'));
      }

      console.log(chalk.cyan('\nSetup complete. Test with: cliaas mcp test'));
    });
}
