import type { Command } from 'commander';
import chalk from 'chalk';
import { existsSync } from 'fs';
import { homedir } from 'os';
import { isJsonMode, output, outputError } from '../output.js';

interface SetupStep {
  step: string;
  status: 'ok' | 'skip' | 'fail';
  detail: string;
}

async function checkCommand(cmd: string): Promise<boolean> {
  try {
    const { execSync } = await import('child_process');
    execSync(`${cmd} --version`, { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
}

async function testPostgres(url: string): Promise<boolean> {
  let client;
  try {
    const pg = await import('pg');
    client = new pg.default.Client({ connectionString: url });
    await client.connect();
    await client.query('SELECT 1');
    return true;
  } catch {
    return false;
  } finally {
    try { await client?.end(); } catch { /* ignore cleanup errors */ }
  }
}

export function registerSetupCommand(program: Command): void {
  program
    .command('setup')
    .description('Check environment and configure CLIaaS for BYOC deployment')
    .option('--connector <name>', 'Configure a specific connector (zendesk, freshdesk, etc.)')
    .action(async (opts: { connector?: string }) => {
      const steps: SetupStep[] = [];
      const json = isJsonMode();

      function report(step: SetupStep) {
        steps.push(step);
        if (!json) {
          const icon = step.status === 'ok' ? chalk.green('✓')
            : step.status === 'skip' ? chalk.yellow('○')
            : chalk.red('✗');
          console.log(`  ${icon} ${step.step}: ${step.detail}`);
        }
      }

      if (!json) {
        console.log(chalk.cyan.bold('\nCLIaaS Setup\n'));
      }

      // 1. Check prerequisites
      const hasNode = await checkCommand('node');
      report({
        step: 'Node.js',
        status: hasNode ? 'ok' : 'fail',
        detail: hasNode ? `${process.version}` : 'Node.js 18+ required',
      });

      const hasPnpm = await checkCommand('pnpm');
      report({
        step: 'pnpm',
        status: hasPnpm ? 'ok' : 'skip',
        detail: hasPnpm ? 'available' : 'optional — install with: corepack enable',
      });

      const hasPsql = await checkCommand('psql');
      report({
        step: 'psql',
        status: hasPsql ? 'ok' : 'skip',
        detail: hasPsql ? 'available' : 'optional — install PostgreSQL client for migrations',
      });

      // 2. Check DATABASE_URL
      const dbUrl = process.env.DATABASE_URL;
      if (dbUrl) {
        const dbOk = await testPostgres(dbUrl);
        report({
          step: 'PostgreSQL',
          status: dbOk ? 'ok' : 'fail',
          detail: dbOk ? 'connected' : `connection failed — check DATABASE_URL`,
        });

        // 3. Check if migrations are needed
        if (dbOk) {
          const hasDrizzle = await checkCommand('npx drizzle-kit');
          report({
            step: 'Migrations',
            status: hasDrizzle ? 'ok' : 'skip',
            detail: hasDrizzle
              ? 'drizzle-kit available — run: cliaas db migrate (or drizzle-kit push)'
              : 'drizzle-kit not found — install in project: pnpm add -D drizzle-kit',
          });
        }
      } else {
        report({
          step: 'PostgreSQL',
          status: 'skip',
          detail: 'DATABASE_URL not set — using file-based mode (JSONL). Set DATABASE_URL for full features.',
        });
      }

      // 4. Check RAG database
      const ragUrl = process.env.RAG_DATABASE_URL;
      if (ragUrl || dbUrl) {
        report({
          step: 'RAG database',
          status: 'ok',
          detail: ragUrl ? 'RAG_DATABASE_URL set' : 'using DATABASE_URL for RAG',
        });
      } else {
        report({
          step: 'RAG database',
          status: 'skip',
          detail: 'no vector database — RAG/semantic search features unavailable',
        });
      }

      // 5. Check LLM API keys
      const envClaude = process.env.ANTHROPIC_API_KEY ?? process.env.CLAUDE_API_KEY;
      const envOpenAI = process.env.OPENAI_API_KEY;

      if (envClaude) {
        report({ step: 'LLM provider', status: 'ok', detail: 'Anthropic (Claude)' });
      } else if (envOpenAI) {
        report({ step: 'LLM provider', status: 'ok', detail: 'OpenAI' });
      } else {
        report({
          step: 'LLM provider',
          status: 'skip',
          detail: 'no API key — set ANTHROPIC_API_KEY or OPENAI_API_KEY for AI features',
        });
      }

      // 6. Check for data
      const dataDir = process.env.CLIAAS_DATA_DIR || './exports';
      const hasData = existsSync(`${dataDir}/tickets.jsonl`) ||
        existsSync(`${dataDir}/demo/tickets.jsonl`) ||
        existsSync(`${dataDir}/zendesk/tickets.jsonl`);
      const homeData = existsSync(`${homedir()}/.cliaas/data/tickets.jsonl`);

      if (hasData || homeData) {
        report({ step: 'Ticket data', status: 'ok', detail: hasData ? dataDir : '~/.cliaas/data/' });
      } else if (dbUrl) {
        report({ step: 'Ticket data', status: 'ok', detail: 'using database' });
      } else {
        report({
          step: 'Ticket data',
          status: 'skip',
          detail: 'no ticket data found — run: cliaas demo or cliaas init',
        });
      }

      // 7. Check MCP config
      const hasMcpJson = existsSync('.mcp.json');
      report({
        step: 'MCP config',
        status: hasMcpJson ? 'ok' : 'skip',
        detail: hasMcpJson ? '.mcp.json found' : 'run: cliaas init (or cliaas mcp install)',
      });

      // 8. Connector check
      if (opts.connector) {
        const connectorEnvMap: Record<string, string[]> = {
          zendesk: ['ZENDESK_SUBDOMAIN', 'ZENDESK_EMAIL', 'ZENDESK_TOKEN'],
          freshdesk: ['FRESHDESK_DOMAIN', 'FRESHDESK_API_KEY'],
          intercom: ['INTERCOM_ACCESS_TOKEN'],
          helpscout: ['HELPSCOUT_APP_ID', 'HELPSCOUT_APP_SECRET'],
          hubspot: ['HUBSPOT_ACCESS_TOKEN'],
          helpcrunch: ['HELPCRUNCH_API_KEY'],
          groove: ['GROOVE_API_TOKEN'],
          'zoho-desk': ['ZOHO_DESK_ORG_ID', 'ZOHO_DESK_ACCESS_TOKEN'],
        };

        const required = connectorEnvMap[opts.connector];
        if (!required) {
          report({
            step: `Connector: ${opts.connector}`,
            status: 'fail',
            detail: `unknown connector — available: ${Object.keys(connectorEnvMap).join(', ')}`,
          });
        } else {
          const missing = required.filter(v => !process.env[v]);
          if (missing.length === 0) {
            report({
              step: `Connector: ${opts.connector}`,
              status: 'ok',
              detail: 'all env vars set — run: cliaas sync run --connector ' + opts.connector,
            });
          } else {
            report({
              step: `Connector: ${opts.connector}`,
              status: 'fail',
              detail: `missing env vars: ${missing.join(', ')}`,
            });
          }
        }
      }

      // Output
      if (json) {
        output(steps, () => {});
      } else {
        const failures = steps.filter(s => s.status === 'fail');
        console.log('');
        if (failures.length === 0) {
          console.log(chalk.green('Setup looks good!'));
        } else {
          console.log(chalk.yellow(`${failures.length} issue(s) need attention.`));
        }
        console.log('');
      }
    });
}
