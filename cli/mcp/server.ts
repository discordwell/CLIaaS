#!/usr/bin/env node
import 'dotenv/config';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { log } from './util.js';
import { registerTicketTools } from './tools/tickets.js';
import { registerAnalysisTools } from './tools/analysis.js';
import { registerKBTools } from './tools/kb.js';
import { registerRagTools } from './tools/rag.js';
import { registerQueueTools } from './tools/queue.js';
import { registerConfigTools } from './tools/config.js';
import { registerActionTools } from './tools/actions.js';
import { registerSyncTools } from './tools/sync.js';
import { registerSurveyTools } from './tools/surveys.js';
import { registerResources } from './resources/index.js';
import { registerPrompts } from './prompts/index.js';

const server = new McpServer({
  name: 'cliaas',
  version: '0.1.0',
});

// Register all tool modules
registerTicketTools(server);
registerAnalysisTools(server);
registerKBTools(server);
registerRagTools(server);
registerQueueTools(server);
registerConfigTools(server);
registerActionTools(server);
registerSyncTools(server);
registerSurveyTools(server);

// Register resources and prompts
registerResources(server);
registerPrompts(server);

// Connect via stdio
async function main() {
  const transport = new StdioServerTransport();
  log('Starting CLIaaS MCP server...');
  await server.connect(transport);
  log('CLIaaS MCP server connected');
}

main().catch((err) => {
  process.stderr.write(`[cliaas-mcp] Fatal: ${err}\n`);
  process.exitCode = 1;
});
