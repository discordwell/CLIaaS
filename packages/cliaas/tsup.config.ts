import { defineConfig } from 'tsup';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = resolve(__dirname, '../..');

const shared = {
  outDir: 'dist',
  format: 'esm' as const,
  target: 'node18' as const,
  platform: 'node' as const,
  sourcemap: false,
  // Resolve @/* path alias to src/*
  esbuildOptions(options: { alias?: Record<string, string> }) {
    options.alias = {
      '@': resolve(root, 'src'),
    };
  },
  // Keep all npm packages external (installed as dependencies)
  external: [
    /^commander/,
    /^chalk/,
    /^ora/,
    /^dotenv/,
    /^zod/,
    /^@modelcontextprotocol/,
    /^@anthropic-ai/,
    /^openai/,
    /^drizzle-orm/,
    /^pg/,
    /^pgvector/,
    /^ioredis/,
    /^bullmq/,
    /^jose/,
    /^nodemailer/,
    /^fast-xml-parser/,
    /^stripe/,
    /^pino/,
    /^web-push/,
    /^prom-client/,
  ],
  dts: false,
};

export default defineConfig([
  {
    ...shared,
    entry: { index: resolve(root, 'cli/index.ts') },
    splitting: false,
    clean: true,
  },
  {
    ...shared,
    entry: { 'mcp-server': resolve(root, 'cli/mcp/server.ts') },
    splitting: false,
    clean: false,
  },
]);
