import type { Command } from 'commander';
import chalk from 'chalk';
import { getTours, getTour, createTour, deleteTour, toggleTour, getTourSteps, addTourStep } from '../../src/lib/tours/tour-store';

export function registerTourCommands(program: Command): void {
  const tours = program
    .command('tours')
    .description('Product tour management');

  tours
    .command('list')
    .description('List product tours')
    .option('--json', 'Output as JSON')
    .action(async (opts: { json?: boolean }) => {
      const list = await getTours();
      if (opts.json) { console.log(JSON.stringify({ tours: list }, null, 2)); return; }
      console.log(chalk.bold.cyan(`\n${list.length} tour(s)\n`));
      for (const t of list) {
        const status = t.isActive ? chalk.green('[ACTIVE]') : chalk.gray('[INACTIVE]');
        console.log(`  ${status} ${t.name}`);
        console.log(`    ${chalk.dim(`ID: ${t.id} | URL: ${t.targetUrlPattern} | Priority: ${t.priority}`)}`);
      }
      console.log('');
    });

  tours
    .command('show <id>')
    .description('Show tour details and steps')
    .option('--json', 'Output as JSON')
    .action(async (id: string, opts: { json?: boolean }) => {
      const tour = await getTour(id);
      if (!tour) { console.error(chalk.red('Tour not found')); process.exitCode = 1; return; }
      const steps = await getTourSteps(id);
      if (opts.json) { console.log(JSON.stringify({ tour, steps }, null, 2)); return; }
      console.log(chalk.bold.cyan(`\n${tour.name}`));
      console.log(`  Status: ${tour.isActive ? 'Active' : 'Inactive'}`);
      console.log(`  URL Pattern: ${tour.targetUrlPattern}`);
      console.log(`\n  ${steps.length} step(s):`);
      for (const s of steps) {
        console.log(`    ${s.position + 1}. ${s.title} — ${chalk.dim(s.targetSelector)}`);
      }
      console.log('');
    });

  tours
    .command('create')
    .description('Create a new product tour')
    .requiredOption('--name <name>', 'Tour name')
    .option('--url <pattern>', 'URL pattern', '*')
    .option('--description <desc>', 'Description')
    .option('--json', 'Output as JSON')
    .action(async (opts: { name: string; url: string; description?: string; json?: boolean }) => {
      const tour = createTour({ name: opts.name, targetUrlPattern: opts.url, description: opts.description });
      if (opts.json) { console.log(JSON.stringify({ tour }, null, 2)); return; }
      console.log(chalk.bold.green(`\nTour created: ${tour.name}`));
      console.log(`  ID: ${tour.id}`);
      console.log('');
    });

  tours
    .command('add-step <tourId>')
    .description('Add a step to a tour')
    .requiredOption('--selector <selector>', 'CSS selector for target element')
    .requiredOption('--title <title>', 'Step title')
    .option('--body <body>', 'Step body text')
    .option('--placement <placement>', 'Placement (top, bottom, left, right, center)', 'bottom')
    .option('--label <label>', 'Action button label', 'Next')
    .option('--json', 'Output as JSON')
    .action(async (tourId: string, opts: { selector: string; title: string; body?: string; placement: string; label: string; json?: boolean }) => {
      const step = await addTourStep({
        tourId,
        targetSelector: opts.selector,
        title: opts.title,
        body: opts.body,
        placement: opts.placement as 'top' | 'bottom' | 'left' | 'right' | 'center',
        actionLabel: opts.label,
      });
      if (opts.json) { console.log(JSON.stringify({ step }, null, 2)); return; }
      console.log(chalk.bold.green(`\nStep added: ${step.title}`));
      console.log(`  ID: ${step.id} | Position: ${step.position}`);
      console.log('');
    });

  tours
    .command('toggle <id>')
    .description('Toggle tour active/inactive')
    .action(async (id: string) => {
      const tour = await toggleTour(id);
      if (tour) console.log(chalk.green(`Tour ${tour.isActive ? 'activated' : 'deactivated'}: ${tour.name}`));
      else { console.error(chalk.red('Tour not found')); process.exitCode = 1; }
    });

  tours
    .command('delete <id>')
    .description('Delete a tour')
    .action(async (id: string) => {
      const deleted = deleteTour(id);
      if (deleted) console.log(chalk.green(`Tour deleted`));
      else { console.error(chalk.red('Tour not found')); process.exitCode = 1; }
    });
}
