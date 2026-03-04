#!/usr/bin/env node
import 'dotenv/config';
import { Command } from 'commander';
import { registerCommands } from './commands/index.js';
import { setJsonMode } from './output.js';

const program = new Command();

program
  .name('cliaas')
  .description('CLI-as-a-Service: Replace legacy helpdesk SaaS with LLM-powered CLI workflows')
  .version('0.1.0')
  .option('--json', 'Output results as JSON (suppresses colors and spinners)');

// Install a pre-action hook on the root command so --json is activated
// before any subcommand runs.
program.hook('preAction', (thisCommand) => {
  const opts = thisCommand.opts();
  if (opts.json) {
    setJsonMode(true);
  }
});

registerCommands(program);

program.parse();
