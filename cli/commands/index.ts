import type { Command } from 'commander';
import { registerZendeskCommands } from './zendesk.js';
import { registerKayakoCommands } from './kayako.js';
import { registerTicketCommands } from './tickets.js';
import { registerTriageCommand } from './triage.js';
import { registerDraftCommand } from './draft.js';
import { registerKBCommand } from './kb.js';
import { registerSummarizeCommand } from './summarize.js';
import { registerConfigCommand } from './config.js';

export function registerCommands(program: Command): void {
  registerZendeskCommands(program);
  registerKayakoCommands(program);
  registerTicketCommands(program);
  registerTriageCommand(program);
  registerDraftCommand(program);
  registerKBCommand(program);
  registerSummarizeCommand(program);
  registerConfigCommand(program);
}
