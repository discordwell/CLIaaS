import type { Command } from 'commander';
import chalk from 'chalk';
import { output, outputError } from '../output.js';
import { getDataProvider } from '@/lib/data-provider/index.js';
import {
  getCustomerActivities,
  getCustomerNotes,
  mergeCustomers,
} from '@/lib/customers/customer-store.js';

export function registerCustomerCommands(program: Command): void {
  const customers = program
    .command('customers')
    .description('View and manage customer profiles');

  customers
    .command('show')
    .description('Show enriched customer detail')
    .argument('<id>', 'Customer ID or email')
    .option('--dir <dir>', 'Export directory')
    .action(async (id: string, opts: { dir?: string }) => {
      try {
        const provider = await getDataProvider(opts.dir);
        const allCustomers = await provider.loadCustomers();
        const lower = id.toLowerCase();
        const customer = allCustomers.find(
          (c) => c.id === id || c.email?.toLowerCase() === lower,
        );

        if (!customer) {
          outputError(`Customer not found: ${id}`);
          process.exit(1);
        }

        const activities = getCustomerActivities(customer.id);
        const notes = getCustomerNotes(customer.id);

        output(
          {
            customer: {
              ...customer,
              activityCount: activities.length,
              noteCount: notes.length,
            },
            recentActivities: activities.slice(0, 5),
            recentNotes: notes.slice(0, 3),
          },
          () => {
            console.log(chalk.cyan.bold(`\n${customer.name || customer.email}`));
            console.log(chalk.gray('\u2500'.repeat(60)));
            console.log(`ID:         ${customer.id}`);
            console.log(`Email:      ${customer.email || '\u2014'}`);
            console.log(`Name:       ${customer.name || '\u2014'}`);
            console.log(`Source:     ${customer.source}`);
            console.log(`Created:    ${customer.createdAt || '\u2014'}`);
            console.log(`Activities: ${activities.length}`);
            console.log(`Notes:      ${notes.length}`);

            if (activities.length > 0) {
              console.log(chalk.cyan(`\n--- Recent Activities (${Math.min(5, activities.length)}) ---\n`));
              for (const a of activities.slice(0, 5)) {
                console.log(
                  `  ${chalk.gray(a.createdAt.slice(0, 16))}  ${chalk.bold(a.activityType)}  ${a.entityType ? `[${a.entityType}:${a.entityId}]` : ''}`,
                );
              }
            }

            if (notes.length > 0) {
              console.log(chalk.cyan(`\n--- Recent Notes (${Math.min(3, notes.length)}) ---\n`));
              for (const n of notes.slice(0, 3)) {
                const typeTag =
                  n.noteType === 'call_log'
                    ? chalk.yellow('[CALL]')
                    : n.noteType === 'meeting'
                      ? chalk.blue('[MEETING]')
                      : chalk.gray('[NOTE]');
                console.log(`  ${typeTag} ${chalk.gray(n.createdAt.slice(0, 16))}`);
                console.log(`  ${n.body.slice(0, 120)}${n.body.length > 120 ? '...' : ''}`);
                console.log();
              }
            }
          },
        );
      } catch (err) {
        outputError(err instanceof Error ? err.message : 'Failed to load customer');
        process.exit(1);
      }
    });

  customers
    .command('timeline')
    .description('Show activity timeline for a customer')
    .argument('<id>', 'Customer ID')
    .option('--limit <n>', 'Max activities to show', '20')
    .action((id: string, opts: { limit: string }) => {
      const limit = parseInt(opts.limit, 10);
      const activities = getCustomerActivities(id);

      if (activities.length === 0) {
        output(
          { customerId: id, activities: [], total: 0 },
          () => {
            console.log(chalk.yellow(`No activities found for customer ${id}.`));
          },
        );
        return;
      }

      const display = activities.slice(0, limit);

      output(
        {
          customerId: id,
          total: activities.length,
          showing: display.length,
          activities: display,
        },
        () => {
          console.log(
            chalk.cyan(`Showing ${display.length} of ${activities.length} activities for ${id}\n`),
          );

          const header = `${'TIMESTAMP'.padEnd(20)} ${'TYPE'.padEnd(22)} ENTITY`;
          console.log(chalk.bold(header));
          console.log('\u2500'.repeat(70));

          for (const a of display) {
            const ts = a.createdAt.slice(0, 16);
            const entity = a.entityType
              ? `${a.entityType}:${a.entityId}`
              : '\u2014';
            console.log(
              `${chalk.gray(ts.padEnd(20))} ${a.activityType.padEnd(22)} ${entity}`,
            );
          }
        },
      );
    });

  customers
    .command('merge')
    .description('Merge two customers')
    .argument('<primaryId>', 'Primary customer ID (will be kept)')
    .argument('<mergedId>', 'Customer ID to merge (will be removed)')
    .option('--dir <dir>', 'Export directory')
    .action(async (primaryId: string, mergedId: string, opts: { dir?: string }) => {
      if (primaryId === mergedId) {
        outputError('Cannot merge a customer with itself.');
        process.exit(1);
      }

      try {
        const provider = await getDataProvider(opts.dir);
        const allCustomers = await provider.loadCustomers();
        const primary = allCustomers.find((c) => c.id === primaryId);
        const merged = allCustomers.find((c) => c.id === mergedId);

        if (!primary) {
          outputError(`Primary customer not found: ${primaryId}`);
          process.exit(1);
        }

        if (!merged) {
          outputError(`Merged customer not found: ${mergedId}`);
          process.exit(1);
        }

        const entry = mergeCustomers(
          primaryId,
          mergedId,
          { name: merged.name, email: merged.email, source: merged.source },
        );

        output(
          { merge: entry },
          () => {
            console.log(chalk.green('\nCustomers merged successfully.\n'));
            console.log(`Primary:  ${primary.name} (${primaryId})`);
            console.log(`Merged:   ${merged.name} (${mergedId})`);
            console.log(`Merge ID: ${entry.id}`);
            console.log(`Time:     ${entry.createdAt}`);
          },
        );
      } catch (err) {
        outputError(err instanceof Error ? err.message : 'Failed to merge customers');
        process.exit(1);
      }
    });
}
