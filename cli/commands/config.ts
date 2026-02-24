import type { Command } from 'commander';
import chalk from 'chalk';
import { readFileSync, writeFileSync, existsSync } from 'fs';
import { join } from 'path';
import { loadConfig, saveConfig, getConfigPath, type CLIConfig } from '../config.js';

const VALID_MODES = ['local', 'db', 'remote', 'hybrid'] as const;
type DataMode = (typeof VALID_MODES)[number];

export function registerConfigCommand(program: Command): void {
  const config = program
    .command('config')
    .description('Manage CLIaaS configuration');

  config
    .command('show')
    .description('Show current configuration')
    .action(() => {
      const cfg = loadConfig();
      console.log(chalk.cyan('Config path:'), getConfigPath());
      console.log(chalk.cyan('Active provider:'), cfg.provider);
      if (cfg.mode) console.log(chalk.cyan('Data mode:'), cfg.mode);
      if (cfg.hostedApiUrl) console.log(chalk.cyan('Hosted API URL:'), cfg.hostedApiUrl);
      if (cfg.hostedApiKey) console.log(chalk.cyan('Hosted API key:'), mask(cfg.hostedApiKey));
      if (cfg.claude?.apiKey) console.log(chalk.cyan('Claude API key:'), mask(cfg.claude.apiKey));
      if (cfg.openai?.apiKey) console.log(chalk.cyan('OpenAI API key:'), mask(cfg.openai.apiKey));
      if (cfg.openclaw?.baseUrl) {
        console.log(chalk.cyan('OpenClaw base URL:'), cfg.openclaw.baseUrl);
        console.log(chalk.cyan('OpenClaw model:'), cfg.openclaw.model);
      }
    });

  config
    .command('set-provider')
    .description('Set the active LLM provider')
    .argument('<provider>', 'Provider name: claude, openai, or openclaw')
    .action((provider: string) => {
      if (!['claude', 'openai', 'openclaw'].includes(provider)) {
        console.error(chalk.red(`Invalid provider: ${provider}. Use claude, openai, or openclaw.`));
        process.exit(1);
      }
      const cfg = loadConfig();
      cfg.provider = provider as CLIConfig['provider'];
      saveConfig(cfg);
      console.log(chalk.green(`Provider set to ${provider}`));
    });

  config
    .command('set-key')
    .description('Set an API key for a provider')
    .argument('<provider>', 'Provider name: claude, openai, or openclaw')
    .argument('<key>', 'API key value')
    .action((provider: string, key: string) => {
      const cfg = loadConfig();
      if (provider === 'claude') {
        cfg.claude = { apiKey: key };
      } else if (provider === 'openai') {
        cfg.openai = { apiKey: key };
      } else if (provider === 'openclaw') {
        cfg.openclaw = { ...cfg.openclaw, baseUrl: cfg.openclaw?.baseUrl ?? 'http://localhost:18789/v1', model: cfg.openclaw?.model ?? 'gpt-4o', apiKey: key };
      } else {
        console.error(chalk.red(`Unknown provider: ${provider}`));
        process.exit(1);
      }
      saveConfig(cfg);
      console.log(chalk.green(`API key set for ${provider}`));
    });

  config
    .command('set-openclaw')
    .description('Configure OpenClaw-compatible endpoint')
    .requiredOption('--base-url <url>', 'Base URL for OpenAI-compatible API')
    .option('--api-key <key>', 'API key (optional)')
    .option('--model <model>', 'Model name', 'gpt-4o')
    .action((opts: { baseUrl: string; apiKey?: string; model: string }) => {
      const cfg = loadConfig();
      cfg.openclaw = { baseUrl: opts.baseUrl, apiKey: opts.apiKey, model: opts.model };
      saveConfig(cfg);
      console.log(chalk.green(`OpenClaw endpoint configured: ${opts.baseUrl}`));
    });

  config
    .command('set-mode')
    .description('Set the data provider mode')
    .argument('<mode>', 'Mode: local, db, remote, or hybrid')
    .option('--url <url>', 'Hosted API URL (required for remote mode)')
    .option('--api-key <key>', 'Hosted API key (for remote mode)')
    .action((mode: string, opts: { url?: string; apiKey?: string }) => {
      if (!VALID_MODES.includes(mode as DataMode)) {
        console.error(chalk.red(`Invalid mode: ${mode}. Use ${VALID_MODES.join(', ')}.`));
        process.exit(1);
      }

      if (mode === 'remote' && !opts.url) {
        // Check if already configured
        const existing = loadConfig();
        if (!existing.hostedApiUrl && !process.env.CLIAAS_HOSTED_URL) {
          console.error(chalk.red('Remote mode requires --url <url>.'));
          process.exit(1);
        }
      }

      const cfg = loadConfig();
      cfg.mode = mode as CLIConfig['mode'];
      if (opts.url) cfg.hostedApiUrl = opts.url;
      if (opts.apiKey) cfg.hostedApiKey = opts.apiKey;
      saveConfig(cfg);

      // Also update .mcp.json if it exists in the project root
      updateMcpJsonMode(mode);

      console.log(chalk.green(`Data mode set to ${mode}`));
      if (opts.url) console.log(chalk.green(`Hosted URL: ${opts.url}`));
      if (opts.apiKey) console.log(chalk.green(`API key saved`));
    });
}

/**
 * Update .mcp.json env vars to reflect the new mode.
 * Sets CLIAAS_MODE and, for remote mode, CLIAAS_HOSTED_URL / CLIAAS_HOSTED_API_KEY.
 */
function updateMcpJsonMode(mode: string): void {
  const mcpPath = join(process.cwd(), '.mcp.json');
  if (!existsSync(mcpPath)) return;

  try {
    const raw = readFileSync(mcpPath, 'utf-8');
    const mcp = JSON.parse(raw);
    const server = mcp?.mcpServers?.cliaas;
    if (!server) return;

    if (!server.env) server.env = {};
    server.env.CLIAAS_MODE = mode;

    if (mode === 'remote') {
      const cfg = loadConfig();
      if (cfg.hostedApiUrl) server.env.CLIAAS_HOSTED_URL = cfg.hostedApiUrl;
      if (cfg.hostedApiKey) server.env.CLIAAS_HOSTED_API_KEY = cfg.hostedApiKey;
    }

    writeFileSync(mcpPath, JSON.stringify(mcp, null, 2) + '\n');
  } catch {
    // Non-critical — don't crash if .mcp.json is malformed
  }
}

function mask(key: string): string {
  if (key.length <= 8) return '****';
  return key.slice(0, 4) + '...' + key.slice(-4);
}
