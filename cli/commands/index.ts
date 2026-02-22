import type { Command } from 'commander';
import { registerZendeskCommands } from './zendesk.js';
import { registerKayakoCommands } from './kayako.js';
import { registerTicketCommands } from './tickets.js';
import { registerTriageCommand } from './triage.js';
import { registerDraftCommand } from './draft.js';
import { registerKBCommand } from './kb.js';
import { registerSummarizeCommand } from './summarize.js';
import { registerConfigCommand } from './config.js';
import { registerDemoCommand } from './demo.js';
import { registerStatsCommand } from './stats.js';
import { registerExportCommand } from './export.js';
import { registerPipelineCommand } from './pipeline.js';
import { registerWatchCommand } from './watch.js';
import { registerBatchCommand } from './batch.js';

export function registerCommands(program: Command): void {
  registerZendeskCommands(program);
  registerKayakoCommands(program);
  registerTicketCommands(program);
  registerTriageCommand(program);
  registerDraftCommand(program);
  registerKBCommand(program);
  registerSummarizeCommand(program);
  registerConfigCommand(program);
  registerDemoCommand(program);
  registerStatsCommand(program);
  registerExportCommand(program);
  registerPipelineCommand(program);
  registerWatchCommand(program);
  registerBatchCommand(program);
}
