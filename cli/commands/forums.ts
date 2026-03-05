import type { Command } from 'commander';
import chalk from 'chalk';
import { output, isJsonMode } from '../output.js';
import { getCategories, getThreads } from '@/lib/forums/forum-store.js';

export function registerForumCommands(program: Command): void {
  const forums = program
    .command('forums')
    .description('Community forum management');

  // ---- forums list ----
  forums
    .command('list')
    .description('List forum categories with thread counts')
    .action(() => {
      const categories = getCategories();

      if (categories.length === 0) {
        if (isJsonMode()) {
          output({ categories: [], total: 0 }, () => {});
        } else {
          console.log(chalk.yellow('No forum categories found.'));
        }
        return;
      }

      const data = categories.map((cat) => {
        const threads = getThreads(cat.id);
        return {
          id: cat.id,
          name: cat.name,
          slug: cat.slug,
          description: cat.description,
          threadCount: threads.length,
        };
      });

      output(
        { categories: data, total: data.length },
        () => {
          console.log(chalk.bold.cyan('\n  Community Forums\n'));

          for (const cat of data) {
            console.log(
              `  ${chalk.bold(cat.name.padEnd(30))} /${chalk.gray(cat.slug.padEnd(25))} ${chalk.cyan(String(cat.threadCount))} threads`
            );
            if (cat.description) {
              console.log(`    ${chalk.gray(cat.description)}`);
            }
          }

          console.log(chalk.gray(`\n  Total: ${data.length} categories\n`));
        },
      );
    });

  // ---- forums categories ----
  forums
    .command('categories')
    .description('List just forum categories')
    .action(() => {
      const categories = getCategories();

      if (categories.length === 0) {
        if (isJsonMode()) {
          output({ categories: [] }, () => {});
        } else {
          console.log(chalk.yellow('No forum categories found.'));
        }
        return;
      }

      output(
        { categories },
        () => {
          console.log(chalk.bold.cyan('\n  Forum Categories\n'));

          for (const cat of categories) {
            console.log(
              `  ${chalk.bold(cat.name)} ${chalk.gray(`(/${cat.slug})`)}  pos: ${cat.position}`
            );
            if (cat.description) {
              console.log(`    ${chalk.gray(cat.description)}`);
            }
          }

          console.log();
        },
      );
    });
}
