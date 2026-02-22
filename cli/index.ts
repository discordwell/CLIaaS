#!/usr/bin/env node
import 'dotenv/config';
import { Command } from 'commander';
import { registerCommands } from './commands/index.js';

const program = new Command();

program
  .name('cliaas')
  .description('CLI-as-a-Service: Replace legacy helpdesk SaaS with LLM-powered CLI workflows')
  .version('0.1.0');

registerCommands(program);

program.parse();
