import type { Command } from 'commander';
import chalk from 'chalk';
import { writeFileSync, readFileSync, existsSync, mkdirSync } from 'fs';
import { join } from 'path';
import { homedir } from 'os';
import { buildMcpConfig } from './mcp.js';

const CLAUDE_MD_MARKER = '# CLIaaS Helpdesk Tools';

const CLAUDE_MD_SECTION = `
# CLIaaS Helpdesk Tools

You have CLIaaS MCP tools for helpdesk ticket management.
Run \`cliaas setup\` to configure database and connectors.

## Key Tools
- \`queue_stats\` — queue overview
- \`triage_batch\` — AI-prioritize open tickets
- \`draft_reply\` — generate response for a ticket
- \`tickets_search\` — find tickets by keyword
- \`sentiment_analyze\` — customer mood analysis

## Workflows
- Morning triage: queue_stats -> triage_batch -> draft_reply for urgent
- Customer investigation: tickets_search -> tickets_show -> sentiment_analyze
- Shift handoff: summarize_queue -> sla_report -> sentiment_analyze

## Setup (if not done)
Run \`cliaas setup\` to configure Postgres, LLM keys, and helpdesk connectors.
`;

export function registerInitCommand(program: Command): void {
  program
    .command('init')
    .description('Set up CLIaaS in the current directory (MCP config + agent instructions + demo data)')
    .option('--no-demo', 'Skip demo data generation')
    .action(async (opts: { demo: boolean }) => {
      const cwd = process.cwd();
      const dataDir = join(homedir(), '.cliaas', 'data');

      // 1. Write .mcp.json
      const mcpJsonPath = join(cwd, '.mcp.json');
      if (existsSync(mcpJsonPath)) {
        console.log(chalk.yellow('.mcp.json already exists — skipping.'));
      } else {
        const config = buildMcpConfig(dataDir);
        writeFileSync(mcpJsonPath, JSON.stringify(config, null, 2) + '\n');
        console.log(chalk.green('Wrote .mcp.json'));
      }

      // 2. Append to ~/.claude/CLAUDE.md (idempotent)
      const claudeDir = join(homedir(), '.claude');
      const claudeMdPath = join(claudeDir, 'CLAUDE.md');

      if (!existsSync(claudeDir)) {
        mkdirSync(claudeDir, { recursive: true });
      }

      if (existsSync(claudeMdPath)) {
        const existing = readFileSync(claudeMdPath, 'utf-8');
        if (existing.includes(CLAUDE_MD_MARKER)) {
          console.log(chalk.yellow('~/.claude/CLAUDE.md already has CLIaaS section — skipping.'));
        } else {
          writeFileSync(claudeMdPath, existing + '\n' + CLAUDE_MD_SECTION);
          console.log(chalk.green('Appended CLIaaS section to ~/.claude/CLAUDE.md'));
        }
      } else {
        writeFileSync(claudeMdPath, CLAUDE_MD_SECTION.trimStart());
        console.log(chalk.green('Created ~/.claude/CLAUDE.md with CLIaaS section'));
      }

      // 3. Generate demo data to ~/.cliaas/data/ (reuse demo command logic)
      if (opts.demo) {
        if (existsSync(join(dataDir, 'tickets.jsonl'))) {
          console.log(chalk.yellow(`Demo data already exists at ${dataDir} — skipping.`));
        } else {
          console.log(chalk.cyan('Generating demo data...'));
          mkdirSync(dataDir, { recursive: true });
          // Dynamically import and invoke the demo generation
          const { generateDemoData } = await import('./demo.js');
          await generateDemoData(dataDir, 50);
          console.log(chalk.green(`Demo data written to ${dataDir}`));
        }
      }

      // 4. Next steps
      console.log('');
      console.log(chalk.cyan.bold('CLIaaS initialized!'));
      console.log('');
      console.log('  Next steps:');
      console.log(`  ${chalk.bold('1.')} Open this directory in Claude Code — MCP tools auto-connect`);
      console.log(`  ${chalk.bold('2.')} Try: ${chalk.cyan('"show me the support queue"')}`);
      console.log(`  ${chalk.bold('3.')} For real data: ${chalk.cyan('cliaas setup')}`);
      console.log('');
    });
}
