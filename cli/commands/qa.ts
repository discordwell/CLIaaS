import type { Command } from 'commander';
import chalk from 'chalk';
import { output, isJsonMode } from '../output.js';
import {
  getScorecards,
  createReview,
  getQADashboard,
} from '@/lib/qa/qa-store.js';

export function registerQACommands(program: Command): void {
  const qa = program
    .command('qa')
    .description('QA & conversation review');

  // ---- qa review <ticketId> ----
  qa
    .command('review <ticketId>')
    .description('Create an auto-review for a ticket')
    .action((ticketId: string) => {
      const scorecards = getScorecards();
      const activeScorecard = scorecards.find((s) => s.enabled);

      if (!activeScorecard) {
        if (isJsonMode()) {
          output({ error: 'No active scorecard found' }, () => {});
        } else {
          console.log(chalk.red('No active scorecard found. Create and enable a scorecard first.'));
        }
        return;
      }

      // Generate auto scores
      const scores: Record<string, number> = {};
      let maxPossibleScore = 0;

      for (const criterion of activeScorecard.criteria) {
        const score = Math.floor(Math.random() * criterion.maxScore) + 1;
        scores[criterion.name] = score;
        maxPossibleScore += criterion.maxScore;
      }

      const totalScore = Object.values(scores).reduce((a, b) => a + b, 0);

      const review = createReview({
        ticketId,
        scorecardId: activeScorecard.id,
        reviewType: 'auto',
        scores,
        totalScore,
        maxPossibleScore,
        notes: 'Auto-generated review via CLI.',
        status: 'completed',
      });

      output(
        { review },
        () => {
          console.log(chalk.bold.cyan('\n  QA Review Created\n'));
          console.log(`  ${'Ticket:'.padEnd(16)} ${chalk.bold(ticketId)}`);
          console.log(`  ${'Scorecard:'.padEnd(16)} ${activeScorecard.name}`);
          console.log(`  ${'Score:'.padEnd(16)} ${chalk.bold(String(totalScore))} / ${maxPossibleScore}`);
          console.log(`  ${'Percentage:'.padEnd(16)} ${chalk.bold(String(Math.round((totalScore / maxPossibleScore) * 100)))}%`);
          console.log(`  ${'Type:'.padEnd(16)} auto`);
          console.log(`  ${'ID:'.padEnd(16)} ${chalk.gray(review.id)}`);

          console.log(chalk.bold('\n  Scores:'));
          for (const [name, score] of Object.entries(scores)) {
            const criterion = activeScorecard.criteria.find((c) => c.name === name);
            const max = criterion?.maxScore ?? '?';
            console.log(`    ${name.padEnd(25)} ${chalk.cyan(String(score))} / ${max}`);
          }

          console.log();
        },
      );
    });

  // ---- qa dashboard ----
  qa
    .command('dashboard')
    .description('Show QA metrics dashboard')
    .action(() => {
      const dashboard = getQADashboard();

      if (dashboard.totalReviews === 0) {
        if (isJsonMode()) {
          output(dashboard, () => {});
        } else {
          console.log(chalk.yellow('No QA reviews found. Create a review first.'));
        }
        return;
      }

      output(
        dashboard,
        () => {
          console.log(chalk.bold.cyan('\n  QA Dashboard\n'));

          console.log(chalk.bold('  Overview'));
          console.log(`  ${'Total Reviews:'.padEnd(20)} ${chalk.bold(String(dashboard.totalReviews))}`);
          console.log(`  ${'Completed:'.padEnd(20)} ${dashboard.completedReviews}`);
          console.log(`  ${'Average Score:'.padEnd(20)} ${chalk.bold(String(dashboard.averageScore))}`);
          console.log(`  ${'Average %:'.padEnd(20)} ${chalk.bold(String(dashboard.averagePercentage))}%`);
          console.log(`  ${'Scorecards:'.padEnd(20)} ${dashboard.scorecardCount}`);

          if (dashboard.byScorecard.length > 0) {
            console.log(chalk.bold('\n  By Scorecard'));
            for (const entry of dashboard.byScorecard) {
              console.log(
                `  ${chalk.bold(entry.scorecardName.padEnd(30))} ${String(entry.reviewCount).padStart(3)} reviews  avg: ${chalk.cyan(String(entry.avgScore))}  ${entry.avgPercentage}%`
              );
            }
          }

          if (dashboard.recentReviews.length > 0) {
            console.log(chalk.bold('\n  Recent Reviews'));
            for (const review of dashboard.recentReviews.slice(0, 5)) {
              const pct = review.maxPossibleScore > 0
                ? Math.round((review.totalScore / review.maxPossibleScore) * 100)
                : 0;
              const color = pct >= 80 ? chalk.green : pct >= 60 ? chalk.yellow : chalk.red;
              console.log(
                `  ${chalk.gray(review.id.slice(0, 12).padEnd(14))} ${(review.ticketId ?? 'N/A').padEnd(15)} ${color(`${review.totalScore}/${review.maxPossibleScore}`)} (${color(String(pct) + '%')})  ${chalk.gray(review.reviewType)}`
              );
            }
          }

          console.log();
        },
      );
    });
}
