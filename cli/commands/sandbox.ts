import type { Command } from 'commander';
import chalk from 'chalk';

const BASE_URL = () => process.env.CLIAAS_API_URL || 'http://localhost:3000';

export function registerSandboxCommands(program: Command): void {
  const sandbox = program
    .command('sandbox')
    .description('Sandbox environment management');

  sandbox
    .command('create <name>')
    .description('Create a new sandbox with cloned production data')
    .option('--json', 'Output as JSON')
    .action(async (name: string, opts: { json?: boolean }) => {
      try {
        const res = await fetch(`${BASE_URL()}/api/sandbox`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ name }),
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);

        if (opts.json) {
          console.log(JSON.stringify(data, null, 2));
          return;
        }

        const sb = data.sandbox;
        console.log(chalk.green(`\nSandbox created: ${sb.name}`));
        console.log(`  ID:      ${chalk.bold(sb.id)}`);
        console.log(`  Status:  ${chalk.cyan(sb.status)}`);
        console.log(`  Expires: ${sb.expiresAt ?? 'N/A'}`);
        if (sb.cloneManifest) {
          console.log(`  Cloned:  ${sb.cloneManifest.clonedFiles.length} file(s)`);
        }
        console.log('');
      } catch (err) {
        console.error(chalk.red(`Failed: ${err instanceof Error ? err.message : 'Unknown'}`));
        process.exitCode = 1;
      }
    });

  sandbox
    .command('list')
    .description('List all sandboxes')
    .option('--json', 'Output as JSON')
    .action(async (opts: { json?: boolean }) => {
      try {
        const res = await fetch(`${BASE_URL()}/api/sandbox`);
        const data = await res.json();

        if (opts.json) {
          console.log(JSON.stringify(data, null, 2));
          return;
        }

        const sandboxes = data.sandboxes ?? [];
        console.log(chalk.bold.cyan(`\n${sandboxes.length} sandbox(es)\n`));

        for (const sb of sandboxes) {
          const statusIcon = sb.status === 'active' ? chalk.green('●') : chalk.gray('●');
          console.log(
            `  ${statusIcon} ${chalk.bold(sb.name)} (${sb.id}) — ${sb.status}${
              sb.promotedAt ? chalk.yellow(' [promoted]') : ''
            }`,
          );
        }
        console.log('');
      } catch (err) {
        console.error(chalk.red(`Failed: ${err instanceof Error ? err.message : 'Unknown'}`));
        process.exitCode = 1;
      }
    });

  sandbox
    .command('diff <id>')
    .description('Show diff between sandbox and production')
    .option('--json', 'Output as JSON')
    .action(async (id: string, opts: { json?: boolean }) => {
      try {
        const res = await fetch(`${BASE_URL()}/api/sandbox/${id}/diff`);
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);

        if (opts.json) {
          console.log(JSON.stringify(data, null, 2));
          return;
        }

        const diff = data.diff;
        console.log(chalk.bold.cyan(`\nSandbox Diff: ${diff.sandboxId}\n`));
        console.log(
          `  ${chalk.green(`+${diff.summary.added} added`)}  ${chalk.yellow(
            `~${diff.summary.modified} modified`,
          )}  ${chalk.red(`-${diff.summary.deleted} deleted`)}  (${diff.summary.total} total)\n`,
        );

        for (const entry of diff.entries) {
          const icon =
            entry.action === 'added'
              ? chalk.green('+')
              : entry.action === 'modified'
              ? chalk.yellow('~')
              : chalk.red('-');
          const changedFields = entry.changes
            ? ` [${Object.keys(entry.changes).join(', ')}]`
            : '';
          console.log(`  ${icon} ${entry.file} :: ${entry.id}${chalk.gray(changedFields)}`);
        }
        console.log('');
      } catch (err) {
        console.error(chalk.red(`Failed: ${err instanceof Error ? err.message : 'Unknown'}`));
        process.exitCode = 1;
      }
    });

  sandbox
    .command('promote <id>')
    .description('Promote sandbox changes to production')
    .option('--json', 'Output as JSON')
    .action(async (id: string, opts: { json?: boolean }) => {
      try {
        const res = await fetch(`${BASE_URL()}/api/sandbox/${id}/promote`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({}),
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);

        if (opts.json) {
          console.log(JSON.stringify(data, null, 2));
          return;
        }

        console.log(chalk.green(`\nPromoted sandbox ${id}`));
        console.log(`  Applied: ${data.applied ?? 0} change(s)`);
        if (data.errors?.length) {
          console.log(chalk.yellow(`  Errors: ${data.errors.join(', ')}`));
        }
        console.log('');
      } catch (err) {
        console.error(chalk.red(`Failed: ${err instanceof Error ? err.message : 'Unknown'}`));
        process.exitCode = 1;
      }
    });

  sandbox
    .command('delete <id>')
    .description('Delete a sandbox and its data')
    .option('--json', 'Output as JSON')
    .action(async (id: string, opts: { json?: boolean }) => {
      try {
        const res = await fetch(`${BASE_URL()}/api/sandbox/${id}`, {
          method: 'DELETE',
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);

        if (opts.json) {
          console.log(JSON.stringify(data, null, 2));
          return;
        }

        console.log(chalk.green(`Sandbox ${id} deleted.`));
      } catch (err) {
        console.error(chalk.red(`Failed: ${err instanceof Error ? err.message : 'Unknown'}`));
        process.exitCode = 1;
      }
    });
}
