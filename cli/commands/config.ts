import type { Command } from 'commander';
import chalk from 'chalk';
import { loadConfig, saveConfig, getConfigPath, type CLIConfig } from '../config.js';

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
}

function mask(key: string): string {
  if (key.length <= 8) return '****';
  return key.slice(0, 4) + '...' + key.slice(-4);
}
