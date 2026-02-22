import chalk from 'chalk';
import { loadConfig } from '../config.js';
import type { LLMProvider } from './base.js';
import { ClaudeProvider } from './claude.js';
import { OpenAIProvider } from './openai.js';
import { OpenClawProvider } from './openclaw.js';

export type { LLMProvider } from './base.js';

export function getProvider(): LLMProvider {
  const config = loadConfig();

  // Allow env vars to override config file
  const envClaude = process.env.ANTHROPIC_API_KEY ?? process.env.CLAUDE_API_KEY;
  const envOpenAI = process.env.OPENAI_API_KEY;

  switch (config.provider) {
    case 'claude': {
      const apiKey = config.claude?.apiKey ?? envClaude;
      if (!apiKey) {
        console.error(chalk.red('No Claude API key configured.'));
        console.error(chalk.yellow('Run: cliaas config set-key claude <your-key>'));
        console.error(chalk.yellow('Or set ANTHROPIC_API_KEY environment variable'));
        process.exit(1);
      }
      return new ClaudeProvider(apiKey, config.claude?.model);
    }
    case 'openai': {
      const apiKey = config.openai?.apiKey ?? envOpenAI;
      if (!apiKey) {
        console.error(chalk.red('No OpenAI API key configured.'));
        console.error(chalk.yellow('Run: cliaas config set-key openai <your-key>'));
        console.error(chalk.yellow('Or set OPENAI_API_KEY environment variable'));
        process.exit(1);
      }
      return new OpenAIProvider(apiKey, config.openai?.model);
    }
    case 'openclaw': {
      const cfg = config.openclaw;
      if (!cfg?.baseUrl) {
        console.error(chalk.red('No OpenClaw endpoint configured.'));
        console.error(chalk.yellow('Run: cliaas config set-openclaw --base-url <url> --model <model>'));
        process.exit(1);
      }
      return new OpenClawProvider(cfg.baseUrl, cfg.model, cfg.apiKey);
    }
    default:
      console.error(chalk.red(`Unknown provider: ${config.provider}`));
      process.exit(1);
  }
}
