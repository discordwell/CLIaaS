import type { Command } from 'commander';
import chalk from 'chalk';
import ora from 'ora';
import { loadTickets } from '../data.js';
import type { Ticket } from '../schema/types.js';

export function registerDuplicatesCommand(program: Command): void {
  program
    .command('duplicates')
    .description('Detect potential duplicate tickets using subject similarity')
    .option('--dir <dir>', 'Export directory')
    .option('--threshold <n>', 'Similarity threshold 0-100', '70')
    .option('--status <status>', 'Filter by status')
    .option('--limit <n>', 'Max duplicate groups to show', '20')
    .action((opts: { dir?: string; threshold: string; status?: string; limit: string }) => {
      const spinner = ora('Scanning for duplicate tickets...').start();
      let tickets = loadTickets(opts.dir);

      if (opts.status) {
        tickets = tickets.filter(t => t.status === opts.status);
      }

      const threshold = parseInt(opts.threshold, 10) / 100;
      const groups: Array<{ tickets: Ticket[]; similarity: number }> = [];
      const seen = new Set<string>();

      for (let i = 0; i < tickets.length; i++) {
        if (seen.has(tickets[i].id)) continue;

        const group: Ticket[] = [tickets[i]];

        for (let j = i + 1; j < tickets.length; j++) {
          if (seen.has(tickets[j].id)) continue;

          const sim = similarity(tickets[i].subject, tickets[j].subject);
          if (sim >= threshold) {
            group.push(tickets[j]);
            seen.add(tickets[j].id);
          }
        }

        if (group.length > 1) {
          // Average similarity within group
          let totalSim = 0;
          let pairs = 0;
          for (let a = 0; a < group.length; a++) {
            for (let b = a + 1; b < group.length; b++) {
              totalSim += similarity(group[a].subject, group[b].subject);
              pairs++;
            }
          }
          groups.push({ tickets: group, similarity: totalSim / pairs });
          seen.add(tickets[i].id);
        }
      }

      groups.sort((a, b) => b.similarity - a.similarity);
      const limited = groups.slice(0, parseInt(opts.limit, 10));

      spinner.succeed(`Found ${groups.length} potential duplicate group${groups.length !== 1 ? 's' : ''}\n`);

      if (limited.length === 0) {
        console.log(chalk.gray('No duplicates detected at the current threshold.'));
        console.log(chalk.gray(`Try lowering the threshold: --threshold ${Math.max(10, parseInt(opts.threshold, 10) - 20)}`));
        return;
      }

      for (let g = 0; g < limited.length; g++) {
        const group = limited[g];
        const simPct = Math.round(group.similarity * 100);
        console.log(chalk.bold(`Group ${g + 1} — ${chalk.yellow(`${simPct}% similar`)} (${group.tickets.length} tickets)`));

        for (const t of group.tickets) {
          const priColor = t.priority === 'urgent' ? chalk.red :
            t.priority === 'high' ? chalk.yellow : chalk.white;
          console.log(
            `  #${t.externalId} [${priColor(t.priority.toUpperCase().padEnd(6))}] ${t.subject.slice(0, 50)} ${chalk.gray(`(${t.status}, ${t.assignee ?? 'unassigned'})`)}`
          );
        }

        console.log(chalk.gray(`  Merge suggestion: cliaas batch tag --add duplicate --status ${group.tickets[0].status}`));
        console.log('');
      }

      console.log(chalk.gray(`Threshold: ${opts.threshold}% | Total groups: ${groups.length}`));
    });
}

/**
 * Simple bigram-based Jaccard similarity for subject line comparison.
 * Fast enough for interactive use with hundreds of tickets.
 */
function similarity(a: string, b: string): number {
  const bigramsA = bigrams(a.toLowerCase());
  const bigramsB = bigrams(b.toLowerCase());

  if (bigramsA.size === 0 && bigramsB.size === 0) return 1;
  if (bigramsA.size === 0 || bigramsB.size === 0) return 0;

  let intersection = 0;
  for (const bg of bigramsA) {
    if (bigramsB.has(bg)) intersection++;
  }

  const union = bigramsA.size + bigramsB.size - intersection;
  return union === 0 ? 0 : intersection / union;
}

function bigrams(s: string): Set<string> {
  const result = new Set<string>();
  const clean = s.replace(/[^a-z0-9 ]/g, '').replace(/\s+/g, ' ').trim();
  for (let i = 0; i < clean.length - 1; i++) {
    result.add(clean.substring(i, i + 2));
  }
  return result;
}
