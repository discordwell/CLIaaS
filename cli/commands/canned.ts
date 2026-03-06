import type { Command } from 'commander';
import chalk from 'chalk';
import {
  getCannedResponses,
  getCannedResponse,
  createCannedResponse,
  updateCannedResponse,
  deleteCannedResponse,
  incrementCannedUsage,
} from '../../src/lib/canned/canned-store';
import {
  getMacros,
  getMacro,
  createMacro,
  deleteMacro,
  incrementMacroUsage,
  type MacroAction,
} from '../../src/lib/canned/macro-store';
import {
  getSignatures,
  createSignature,
  updateSignature,
  deleteSignature,
} from '../../src/lib/canned/signature-store';
import { resolveMergeVariables, type MergeContext } from '../../src/lib/canned/merge';
import { executeMacroActions } from '../../src/lib/canned/macro-executor';

export function registerCannedCommands(program: Command): void {
  // ---- Canned Responses ----
  const canned = program.command('canned').description('Canned responses / reply templates');

  canned
    .command('list')
    .description('List canned responses')
    .option('--category <cat>', 'Filter by category')
    .option('--scope <scope>', 'Filter by scope (personal|shared)')
    .option('--search <query>', 'Search title/body')
    .option('--json', 'Output as JSON')
    .action(async (opts: { category?: string; scope?: string; search?: string; json?: boolean }) => {
      try {
        const responses = getCannedResponses({
          category: opts.category,
          scope: opts.scope as 'personal' | 'shared' | undefined,
          search: opts.search,
        });

        if (opts.json) {
          console.log(JSON.stringify({ cannedResponses: responses }, null, 2));
          return;
        }

        console.log(chalk.bold.cyan(`\n${responses.length} canned response(s)\n`));
        for (const r of responses) {
          const scopeTag = r.scope === 'shared' ? chalk.blue('[SHARED]') : chalk.gray('[PERSONAL]');
          console.log(`  ${scopeTag} ${chalk.bold(r.title)}`);
          console.log(`    ${chalk.dim(`ID: ${r.id} | Category: ${r.category ?? '—'} | Uses: ${r.usageCount}`)}`);
          if (r.shortcut) console.log(`    ${chalk.dim(`Shortcut: ${r.shortcut}`)}`);
        }
        console.log('');
      } catch (err) {
        console.error(chalk.red(`Failed: ${err instanceof Error ? err.message : 'Unknown error'}`));
        process.exitCode = 1;
      }
    });

  canned
    .command('show <id>')
    .description('Show a canned response')
    .action(async (id: string) => {
      const r = getCannedResponse(id);
      if (!r) {
        console.error(chalk.red(`Canned response not found: ${id}`));
        process.exitCode = 1;
        return;
      }
      console.log(chalk.bold(`\n${r.title}`));
      console.log(chalk.dim(`ID: ${r.id} | Scope: ${r.scope} | Category: ${r.category ?? '—'}`));
      if (r.shortcut) console.log(chalk.dim(`Shortcut: ${r.shortcut}`));
      console.log(chalk.dim(`Uses: ${r.usageCount} | Updated: ${r.updatedAt}`));
      console.log(`\n${r.body}\n`);
    });

  canned
    .command('create')
    .description('Create a canned response')
    .requiredOption('--title <title>', 'Response title')
    .requiredOption('--body <body>', 'Response body (supports {{merge.vars}})')
    .option('--category <cat>', 'Category')
    .option('--scope <scope>', 'Scope: personal or shared', 'personal')
    .option('--shortcut <sc>', 'Shortcut like /thanks')
    .option('--json', 'Output as JSON')
    .action(async (opts: { title: string; body: string; category?: string; scope?: string; shortcut?: string; json?: boolean }) => {
      try {
        const cr = createCannedResponse({
          title: opts.title,
          body: opts.body,
          category: opts.category,
          scope: (opts.scope as 'personal' | 'shared') ?? 'personal',
          shortcut: opts.shortcut,
        });
        if (opts.json) {
          console.log(JSON.stringify({ cannedResponse: cr }, null, 2));
          return;
        }
        console.log(chalk.bold.green(`\nCreated: ${cr.title}`));
        console.log(`  ID: ${cr.id}\n`);
      } catch (err) {
        console.error(chalk.red(`Failed: ${err instanceof Error ? err.message : 'Unknown error'}`));
        process.exitCode = 1;
      }
    });

  canned
    .command('update <id>')
    .description('Update a canned response')
    .option('--title <title>')
    .option('--body <body>')
    .option('--category <cat>')
    .option('--scope <scope>')
    .action(async (id: string, opts: { title?: string; body?: string; category?: string; scope?: string }) => {
      const updated = updateCannedResponse(id, {
        title: opts.title,
        body: opts.body,
        category: opts.category,
        scope: opts.scope as 'personal' | 'shared' | undefined,
      });
      if (!updated) {
        console.error(chalk.red(`Not found: ${id}`));
        process.exitCode = 1;
        return;
      }
      console.log(chalk.green(`Updated: ${updated.title}`));
    });

  canned
    .command('delete <id>')
    .description('Delete a canned response')
    .action(async (id: string) => {
      const ok = deleteCannedResponse(id);
      if (!ok) {
        console.error(chalk.red(`Not found: ${id}`));
        process.exitCode = 1;
        return;
      }
      console.log(chalk.green('Deleted.'));
    });

  canned
    .command('resolve <id>')
    .description('Resolve merge variables against a ticket')
    .requiredOption('--ticket <ticketId>', 'Ticket ID for context')
    .action(async (id: string, opts: { ticket: string }) => {
      const cr = getCannedResponse(id);
      if (!cr) {
        console.error(chalk.red(`Not found: ${id}`));
        process.exitCode = 1;
        return;
      }
      // Build minimal context from ticket ID
      const context: MergeContext = {
        ticket: { id: opts.ticket },
        agent: { name: 'CLI User' },
      };
      const resolved = resolveMergeVariables(cr.body, context);
      incrementCannedUsage(id);
      console.log(resolved);
    });

  // ---- Macros ----
  const macro = program.command('macro').description('Macro management');

  macro
    .command('list')
    .description('List macros')
    .option('--scope <scope>', 'Filter by scope')
    .option('--json', 'Output as JSON')
    .action(async (opts: { scope?: string; json?: boolean }) => {
      try {
        const macros = getMacros({ scope: opts.scope as 'personal' | 'shared' | undefined });
        if (opts.json) {
          console.log(JSON.stringify({ macros }, null, 2));
          return;
        }
        console.log(chalk.bold.cyan(`\n${macros.length} macro(s)\n`));
        for (const m of macros) {
          const status = m.enabled ? chalk.green('[ON]') : chalk.red('[OFF]');
          console.log(`  ${status} ${chalk.bold(m.name)}`);
          console.log(`    ${chalk.dim(`ID: ${m.id} | Actions: ${m.actions.length} | Uses: ${m.usageCount}`)}`);
          if (m.description) console.log(`    ${chalk.dim(m.description)}`);
        }
        console.log('');
      } catch (err) {
        console.error(chalk.red(`Failed: ${err instanceof Error ? err.message : 'Unknown error'}`));
        process.exitCode = 1;
      }
    });

  macro
    .command('show <id>')
    .description('Show macro details')
    .action(async (id: string) => {
      const m = getMacro(id);
      if (!m) {
        console.error(chalk.red(`Macro not found: ${id}`));
        process.exitCode = 1;
        return;
      }
      console.log(chalk.bold(`\n${m.name}`));
      console.log(chalk.dim(`ID: ${m.id} | Scope: ${m.scope} | Enabled: ${m.enabled}`));
      if (m.description) console.log(chalk.dim(m.description));
      console.log(chalk.dim(`Uses: ${m.usageCount} | Updated: ${m.updatedAt}`));
      console.log(chalk.bold('\nActions:'));
      for (const a of m.actions) {
        console.log(`  ${chalk.yellow(a.type)}: ${a.value ?? a.field ?? '—'}`);
      }
      console.log('');
    });

  macro
    .command('create')
    .description('Create a macro')
    .requiredOption('--name <name>', 'Macro name')
    .requiredOption('--actions <json>', 'Actions JSON array')
    .option('--description <desc>', 'Description')
    .option('--scope <scope>', 'Scope: personal or shared', 'shared')
    .option('--json', 'Output as JSON')
    .action(async (opts: { name: string; actions: string; description?: string; scope?: string; json?: boolean }) => {
      try {
        const actions = JSON.parse(opts.actions) as MacroAction[];
        const m = createMacro({
          name: opts.name,
          description: opts.description,
          actions,
          scope: (opts.scope as 'personal' | 'shared') ?? 'shared',
        });
        if (opts.json) {
          console.log(JSON.stringify({ macro: m }, null, 2));
          return;
        }
        console.log(chalk.bold.green(`\nCreated: ${m.name}`));
        console.log(`  ID: ${m.id}\n`);
      } catch (err) {
        console.error(chalk.red(`Failed: ${err instanceof Error ? err.message : 'Unknown error'}`));
        process.exitCode = 1;
      }
    });

  macro
    .command('apply <macroId>')
    .description('Apply a macro to a ticket')
    .requiredOption('--ticket <ticketId>', 'Ticket ID')
    .action(async (macroId: string, opts: { ticket: string }) => {
      const m = getMacro(macroId);
      if (!m) {
        console.error(chalk.red(`Macro not found: ${macroId}`));
        process.exitCode = 1;
        return;
      }
      const ticketCtx = {
        id: opts.ticket,
        status: 'open',
        priority: 'normal',
        assignee: null,
        tags: [] as string[],
      };
      const context: MergeContext = {
        ticket: { id: opts.ticket },
        agent: { name: 'CLI User' },
      };
      const result = executeMacroActions(m.actions, ticketCtx, context);
      incrementMacroUsage(macroId);

      console.log(chalk.bold.green(`\nApplied "${m.name}" — ${result.actionsExecuted} action(s)`));
      if (Object.keys(result.changes).length > 0) {
        console.log(chalk.dim(`Changes: ${JSON.stringify(result.changes)}`));
      }
      if (result.replies.length > 0) console.log(chalk.dim(`Replies: ${result.replies.length}`));
      if (result.notes.length > 0) console.log(chalk.dim(`Notes: ${result.notes.length}`));
      if (result.errors.length > 0) console.log(chalk.red(`Errors: ${result.errors.join(', ')}`));
      console.log('');
    });

  macro
    .command('delete <id>')
    .description('Delete a macro')
    .action(async (id: string) => {
      const ok = deleteMacro(id);
      if (!ok) {
        console.error(chalk.red(`Not found: ${id}`));
        process.exitCode = 1;
        return;
      }
      console.log(chalk.green('Deleted.'));
    });

  // ---- Signatures ----
  const sig = program.command('signature').description('Agent email signatures');

  sig
    .command('list')
    .description('List signatures')
    .option('--user <userId>', 'Filter by user')
    .option('--json', 'Output as JSON')
    .action(async (opts: { user?: string; json?: boolean }) => {
      const sigs = getSignatures({ userId: opts.user });
      if (opts.json) {
        console.log(JSON.stringify({ signatures: sigs }, null, 2));
        return;
      }
      console.log(chalk.bold.cyan(`\n${sigs.length} signature(s)\n`));
      for (const s of sigs) {
        const def = s.isDefault ? chalk.green('[DEFAULT]') : '';
        console.log(`  ${def} ${chalk.bold(s.name)} ${chalk.dim(`(${s.id})`)}`);
      }
      console.log('');
    });

  sig
    .command('create')
    .description('Create a signature')
    .requiredOption('--name <name>', 'Signature name')
    .requiredOption('--body <body>', 'Plain text body')
    .option('--html <html>', 'HTML body')
    .option('--default', 'Set as default')
    .option('--json', 'Output as JSON')
    .action(async (opts: { name: string; body: string; html?: string; default?: boolean; json?: boolean }) => {
      const s = createSignature({
        name: opts.name,
        bodyText: opts.body,
        bodyHtml: opts.html ?? opts.body,
        isDefault: opts.default,
      });
      if (opts.json) {
        console.log(JSON.stringify({ signature: s }, null, 2));
        return;
      }
      console.log(chalk.bold.green(`\nCreated: ${s.name}`));
      console.log(`  ID: ${s.id}\n`);
    });

  sig
    .command('update <id>')
    .description('Update a signature')
    .option('--name <name>')
    .option('--body <body>', 'Plain text body')
    .option('--html <html>', 'HTML body')
    .action(async (id: string, opts: { name?: string; body?: string; html?: string }) => {
      const updated = updateSignature(id, {
        name: opts.name,
        bodyText: opts.body,
        bodyHtml: opts.html,
      });
      if (!updated) {
        console.error(chalk.red(`Not found: ${id}`));
        process.exitCode = 1;
        return;
      }
      console.log(chalk.green(`Updated: ${updated.name}`));
    });

  sig
    .command('delete <id>')
    .description('Delete a signature')
    .action(async (id: string) => {
      const ok = deleteSignature(id);
      if (!ok) {
        console.error(chalk.red(`Not found: ${id}`));
        process.exitCode = 1;
        return;
      }
      console.log(chalk.green('Deleted.'));
    });
}
