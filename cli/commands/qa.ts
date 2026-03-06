import type { Command } from 'commander';
import chalk from 'chalk';
import { output, isJsonMode } from '../output.js';
import { getQADashboard } from '@/lib/qa/qa-store.js';
import { getAutoQAConfig, upsertAutoQAConfig } from '@/lib/qa/autoqa-config-store.js';
import { getFlags, dismissFlag } from '@/lib/qa/qa-flags-store.js';
import { getCoachingAssignments } from '@/lib/qa/qa-coaching-store.js';
import { getPredictions, getAccuracyStats } from '@/lib/predictions/csat-prediction-store.js';
import { getAtRiskCustomers, getHealthScore } from '@/lib/customers/health-score-store.js';

export function registerQACommands(program: Command): void {
  const qa = program
    .command('qa')
    .description('QA & conversation review');

  // ---- qa review <ticketId> ----
  qa
    .command('review <ticketId>')
    .description('Run AutoQA on a ticket (real LLM/heuristic scoring)')
    .action(async (ticketId: string) => {
      const { runAutoQA } = await import('@/lib/ai/autoqa.js');
      const { loadTickets, loadMessages } = await import('@/lib/data.js');

      const tickets = await loadTickets();
      const ticket = tickets.find(t => t.id === ticketId);
      if (!ticket) {
        console.log(chalk.red('Ticket not found.'));
        return;
      }

      const messages = await loadMessages(ticketId);
      const agentReplies = messages.filter(m => m.type === 'reply' && m.author !== ticket.requester);
      const responseText = agentReplies.length > 0 ? agentReplies[agentReplies.length - 1].body : messages[messages.length - 1]?.body ?? '';

      const result = await runAutoQA(ticketId, 'default', { ticket, messages, responseText }, { skipSampling: true });

      if (result.skipped) {
        console.log(chalk.yellow(`Skipped: ${result.skipReason}`));
        return;
      }

      output(
        { review: result.review, flags: result.flagsCreated, csatPrediction: result.csatPrediction },
        () => {
          const pct = result.review.maxPossibleScore > 0
            ? Math.round((result.review.totalScore / result.review.maxPossibleScore) * 100)
            : 0;
          const color = pct >= 80 ? chalk.green : pct >= 60 ? chalk.yellow : chalk.red;
          console.log(chalk.bold.cyan('\n  AutoQA Review\n'));
          console.log(`  ${'Ticket:'.padEnd(16)} ${chalk.bold(ticketId)}`);
          console.log(`  ${'Score:'.padEnd(16)} ${color(`${result.review.totalScore}/${result.review.maxPossibleScore}`)} (${color(pct + '%')})`);
          console.log(`  ${'Flags:'.padEnd(16)} ${result.flagsCreated > 0 ? chalk.red(String(result.flagsCreated)) : chalk.green('0')}`);
          if (result.csatPrediction) {
            const riskColor = result.csatPrediction.riskLevel === 'high' ? chalk.red : result.csatPrediction.riskLevel === 'medium' ? chalk.yellow : chalk.green;
            console.log(`  ${'CSAT Pred:'.padEnd(16)} ${result.csatPrediction.score}/5 (${riskColor(result.csatPrediction.riskLevel)} risk)`);
          }
          if (result.report.suggestions.length > 0) {
            console.log(chalk.bold('\n  Suggestions:'));
            for (const s of result.report.suggestions) console.log(`    - ${s}`);
          }
          console.log(`\n  ${chalk.gray(`Review ID: ${result.review.id}`)}\n`);
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
        if (isJsonMode()) { output(dashboard, () => {}); } else { console.log(chalk.yellow('No QA reviews found.')); }
        return;
      }
      output(dashboard, () => {
        console.log(chalk.bold.cyan('\n  QA Dashboard\n'));
        console.log(`  ${'Total Reviews:'.padEnd(20)} ${chalk.bold(String(dashboard.totalReviews))}`);
        console.log(`  ${'Completed:'.padEnd(20)} ${dashboard.completedReviews}`);
        console.log(`  ${'Average Score:'.padEnd(20)} ${chalk.bold(String(dashboard.averageScore))}`);
        console.log(`  ${'Average %:'.padEnd(20)} ${chalk.bold(String(dashboard.averagePercentage))}%`);
        if (dashboard.byScorecard.length > 0) {
          console.log(chalk.bold('\n  By Scorecard'));
          for (const e of dashboard.byScorecard) {
            console.log(`  ${chalk.bold(e.scorecardName.padEnd(30))} ${String(e.reviewCount).padStart(3)} reviews  avg: ${chalk.cyan(String(e.avgScore))}  ${e.avgPercentage}%`);
          }
        }
        console.log();
      });
    });

  // ---- qa autoqa ----
  const autoqa = qa.command('autoqa').description('AutoQA pipeline management');

  autoqa.command('config').description('Show AutoQA configuration').action(() => {
    const config = getAutoQAConfig('default');
    output(config ?? { enabled: false }, () => {
      console.log(chalk.bold.cyan('\n  AutoQA Config\n'));
      if (!config) { console.log('  Not configured.\n'); return; }
      console.log(`  ${'Enabled:'.padEnd(20)} ${config.enabled ? chalk.green('Yes') : chalk.red('No')}`);
      console.log(`  ${'Sample Rate:'.padEnd(20)} ${Math.round(config.sampleRate * 100)}%`);
      console.log(`  ${'Provider:'.padEnd(20)} ${config.provider}`);
      console.log(`  ${'Scorecard:'.padEnd(20)} ${config.scorecardId ?? 'default'}`);
      console.log(`  ${'Trigger Resolved:'.padEnd(20)} ${config.triggerOnResolved ? 'Yes' : 'No'}`);
      console.log(`  ${'Trigger Closed:'.padEnd(20)} ${config.triggerOnClosed ? 'Yes' : 'No'}\n`);
    });
  });

  autoqa.command('enable').description('Enable AutoQA').action(() => {
    const config = upsertAutoQAConfig('default', { enabled: true });
    console.log(chalk.green('AutoQA enabled.'));
    output(config, () => {});
  });

  autoqa.command('disable').description('Disable AutoQA').action(() => {
    const config = upsertAutoQAConfig('default', { enabled: false });
    console.log(chalk.yellow('AutoQA disabled.'));
    output(config, () => {});
  });

  // ---- qa flags ----
  qa.command('flags')
    .description('List spotlight flags')
    .option('--severity <level>', 'Filter by severity (info, warning, critical)')
    .action((opts: { severity?: string }) => {
      const flags = getFlags({ dismissed: false, severity: opts.severity });
      output({ flags }, () => {
        console.log(chalk.bold.cyan(`\n  QA Flags (${flags.length})\n`));
        if (flags.length === 0) { console.log('  No active flags.\n'); return; }
        for (const f of flags) {
          const sevColor = f.severity === 'critical' ? chalk.red : f.severity === 'warning' ? chalk.yellow : chalk.gray;
          console.log(`  ${sevColor(`[${f.severity.toUpperCase()}]`.padEnd(12))} ${f.message}`);
          console.log(`  ${' '.repeat(12)} ticket: ${f.ticketId ?? 'N/A'}  ${chalk.gray(f.id)}`);
        }
        console.log();
      });
    });

  qa.command('flags-dismiss <flagId>')
    .description('Dismiss a flag')
    .action((flagId: string) => {
      const result = dismissFlag(flagId, 'cli-user');
      if (!result) { console.log(chalk.red('Flag not found.')); return; }
      console.log(chalk.green(`Flag ${flagId} dismissed.`));
    });

  // ---- qa coaching ----
  qa.command('coaching')
    .description('List coaching assignments')
    .option('--agent <id>', 'Filter by agent')
    .option('--status <status>', 'Filter by status')
    .action((opts: { agent?: string; status?: string }) => {
      const assignments = getCoachingAssignments({ agentId: opts.agent, status: opts.status });
      output({ assignments }, () => {
        console.log(chalk.bold.cyan(`\n  Coaching Assignments (${assignments.length})\n`));
        for (const a of assignments) {
          const statusColor = a.status === 'completed' ? chalk.green : a.status === 'acknowledged' ? chalk.yellow : chalk.red;
          console.log(`  ${statusColor(a.status.padEnd(14))} agent: ${a.agentId}  review: ${a.reviewId}`);
        }
        console.log();
      });
    });

  // ---- predict ----
  const predict = program.command('predict').description('Satisfaction predictions');

  predict.command('csat <ticketId>')
    .description('Predict CSAT for a ticket')
    .action(async (ticketId: string) => {
      const { predictCSAT } = await import('@/lib/predictions/csat-predictor.js');
      const { loadTickets, loadMessages } = await import('@/lib/data.js');

      const tickets = await loadTickets();
      const ticket = tickets.find(t => t.id === ticketId);
      if (!ticket) { console.log(chalk.red('Ticket not found.')); return; }

      const messages = await loadMessages(ticketId);
      const result = predictCSAT({ ticket, messages });

      output(result, () => {
        const riskColor = result.riskLevel === 'high' ? chalk.red : result.riskLevel === 'medium' ? chalk.yellow : chalk.green;
        console.log(chalk.bold.cyan('\n  CSAT Prediction\n'));
        console.log(`  ${'Predicted Score:'.padEnd(20)} ${chalk.bold(String(result.score))}/5`);
        console.log(`  ${'Confidence:'.padEnd(20)} ${Math.round(result.confidence * 100)}%`);
        console.log(`  ${'Risk Level:'.padEnd(20)} ${riskColor(result.riskLevel)}`);
        console.log(chalk.bold('\n  Factors:'));
        for (const [k, v] of Object.entries(result.factors)) {
          console.log(`    ${k.padEnd(25)} ${chalk.gray(String(v))}`);
        }
        console.log();
      });
    });

  predict.command('accuracy')
    .description('Show prediction accuracy report')
    .action(() => {
      const stats = getAccuracyStats();
      output(stats, () => {
        console.log(chalk.bold.cyan('\n  CSAT Prediction Accuracy\n'));
        console.log(`  ${'Total Predictions:'.padEnd(22)} ${stats.totalPredictions}`);
        console.log(`  ${'With Actual Score:'.padEnd(22)} ${stats.withActual}`);
        console.log(`  ${'Avg Error:'.padEnd(22)} ${chalk.bold(String(stats.avgError))}`);
        console.log(`  ${'Avg Confidence:'.padEnd(22)} ${Math.round(stats.avgConfidence * 100)}%`);
        console.log();
      });
    });

  // ---- customers health ----
  const customers = program.commands.find(c => c.name() === 'customers')
    ?? program.command('customers').description('Customer management');

  customers.command('health <customerId>')
    .description('Show customer health score')
    .action((customerId: string) => {
      const score = getHealthScore('default', customerId);
      if (!score) { console.log(chalk.yellow('No health score found. Run health-compute first.')); return; }
      output(score, () => {
        const color = score.overallScore >= 70 ? chalk.green : score.overallScore >= 40 ? chalk.yellow : chalk.red;
        console.log(chalk.bold.cyan('\n  Customer Health Score\n'));
        console.log(`  ${'Overall:'.padEnd(18)} ${color(String(score.overallScore))}/100 (${score.trend})`);
        console.log(`  ${'CSAT:'.padEnd(18)} ${score.csatScore ?? '-'}`);
        console.log(`  ${'Sentiment:'.padEnd(18)} ${score.sentimentScore ?? '-'}`);
        console.log(`  ${'Effort:'.padEnd(18)} ${score.effortScore ?? '-'}`);
        console.log(`  ${'Resolution:'.padEnd(18)} ${score.resolutionScore ?? '-'}`);
        console.log(`  ${'Engagement:'.padEnd(18)} ${score.engagementScore ?? '-'}\n`);
      });
    });

  customers.command('at-risk')
    .description('List at-risk customers')
    .option('--limit <n>', 'Max results', '20')
    .action((opts: { limit: string }) => {
      const atRisk = getAtRiskCustomers('default', parseInt(opts.limit, 10));
      output({ atRisk }, () => {
        console.log(chalk.bold.cyan(`\n  At-Risk Customers (${atRisk.length})\n`));
        if (atRisk.length === 0) { console.log('  No at-risk customers.\n'); return; }
        for (const s of atRisk) {
          const trendIcon = s.trend === 'declining' ? chalk.red('↓') : s.trend === 'improving' ? chalk.green('↑') : chalk.gray('→');
          console.log(`  ${chalk.red(String(s.overallScore).padStart(3))} ${trendIcon} ${s.customerId}`);
        }
        console.log();
      });
    });
}
