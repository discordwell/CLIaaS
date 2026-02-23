import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { textResult, errorResult, maskConfig } from '../util.js';
import { loadConfig, saveConfig, getConfigPath } from '../../config.js';

export function registerConfigTools(server: McpServer): void {
  server.tool(
    'config_show',
    'Show current CLIaaS configuration (API keys are masked)',
    {},
    async () => {
      const config = loadConfig();
      const masked = maskConfig(config as unknown as Record<string, unknown>);

      return textResult({
        configPath: getConfigPath(),
        config: masked,
        envOverrides: {
          ANTHROPIC_API_KEY: !!process.env.ANTHROPIC_API_KEY,
          CLAUDE_API_KEY: !!process.env.CLAUDE_API_KEY,
          OPENAI_API_KEY: !!process.env.OPENAI_API_KEY,
          DATABASE_URL: !!process.env.DATABASE_URL,
          RAG_DATABASE_URL: !!process.env.RAG_DATABASE_URL,
          CLIAAS_DATA_DIR: process.env.CLIAAS_DATA_DIR ?? null,
        },
      });
    },
  );

  server.tool(
    'config_set_provider',
    'Switch the active LLM provider (claude, openai, or openclaw)',
    {
      provider: z.enum(['claude', 'openai', 'openclaw']).describe('Provider to activate'),
    },
    async ({ provider }) => {
      const config = loadConfig();
      config.provider = provider;
      saveConfig(config);
      return textResult({ message: `Provider set to ${provider}`, provider });
    },
  );
}
