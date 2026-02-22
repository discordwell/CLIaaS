import type { Command } from 'commander';
import chalk from 'chalk';
import ora from 'ora';
import { loadTickets, loadMessages, getTicketMessages } from '../data.js';
import { getProvider } from '../providers/index.js';

export function registerSentimentCommand(program: Command): void {
  program
    .command('sentiment')
    .description('Analyze customer sentiment across ticket conversations using LLM')
    .option('--dir <dir>', 'Export directory')
    .option('--status <status>', 'Filter by status', 'open')
    .option('--limit <n>', 'Number of tickets to analyze', '10')
    .action(async (opts: { dir?: string; status: string; limit: string }) => {
      const provider = getProvider();
      const allTickets = loadTickets(opts.dir);
      const allMessages = loadMessages(opts.dir);

      const queue = allTickets
        .filter(t => t.status === opts.status)
        .slice(0, parseInt(opts.limit, 10));

      if (queue.length === 0) {
        console.log(chalk.yellow(`No ${opts.status} tickets found.`));
        return;
      }

      console.log(chalk.bold.cyan(`\nSentiment Analysis — ${queue.length} tickets (${provider.name})\n`));

      interface SentimentResult {
        ticketId: string;
        externalId: string;
        subject: string;
        sentiment: string;
        score: number;
        summary: string;
        escalationRisk: string;
      }

      const results: SentimentResult[] = [];

      for (const ticket of queue) {
        const spinner = ora(`Analyzing #${ticket.externalId}...`).start();
        try {
          const messages = getTicketMessages(ticket.id, allMessages);
          const conversation = messages
            .sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime())
            .map(m => `[${m.author}]: ${m.body}`)
            .join('\n\n');

          const prompt = `Analyze the customer sentiment in this support ticket conversation. Return a JSON object with these fields:
- sentiment: one of "positive", "neutral", "frustrated", "angry", "urgent"
- score: number from -100 (very negative) to 100 (very positive)
- summary: one sentence describing the customer's emotional state
- escalation_risk: "low", "medium", or "high"

Ticket: ${ticket.subject}
Priority: ${ticket.priority}
Status: ${ticket.status}

Conversation:
${conversation}

Return ONLY the JSON object, no other text.`;

          const raw = await provider.generateReply(ticket, messages, { tone: 'concise', context: prompt });

          // Try to parse JSON from response
          let parsed: { sentiment: string; score: number; summary: string; escalation_risk: string };
          try {
            let cleaned = raw.trim();
            const fenceMatch = cleaned.match(/^```(?:json)?\s*\n?([\s\S]*?)\n?\s*```$/);
            if (fenceMatch) cleaned = fenceMatch[1].trim();
            parsed = JSON.parse(cleaned);
          } catch {
            // Fallback: extract what we can
            parsed = {
              sentiment: 'neutral',
              score: 0,
              summary: raw.slice(0, 100),
              escalation_risk: 'medium',
            };
          }

          results.push({
            ticketId: ticket.id,
            externalId: ticket.externalId,
            subject: ticket.subject,
            sentiment: parsed.sentiment,
            score: parsed.score,
            summary: parsed.summary,
            escalationRisk: parsed.escalation_risk,
          });

          const sentColor = parsed.score > 30 ? chalk.green :
            parsed.score > -30 ? chalk.yellow : chalk.red;

          spinner.succeed(
            `#${ticket.externalId} ${sentColor(parsed.sentiment.toUpperCase())} (${parsed.score > 0 ? '+' : ''}${parsed.score}) — ${parsed.summary.slice(0, 60)}`
          );
        } catch (err) {
          spinner.fail(`#${ticket.externalId}: ${err instanceof Error ? err.message : 'analysis failed'}`);
        }
      }

      if (results.length === 0) return;

      // Summary
      console.log(chalk.bold('\n─── Sentiment Summary ───\n'));

      const avgScore = results.reduce((sum, r) => sum + r.score, 0) / results.length;
      const avgColor = avgScore > 30 ? chalk.green : avgScore > -30 ? chalk.yellow : chalk.red;
      console.log(`  Average Score: ${avgColor(String(Math.round(avgScore)))}`);

      const sentimentCounts: Record<string, number> = {};
      for (const r of results) {
        sentimentCounts[r.sentiment] = (sentimentCounts[r.sentiment] ?? 0) + 1;
      }
      console.log(`  Breakdown: ${Object.entries(sentimentCounts).map(([s, c]) => `${s}: ${c}`).join(', ')}`);

      const highRisk = results.filter(r => r.escalationRisk === 'high');
      if (highRisk.length > 0) {
        console.log(chalk.red.bold(`\n  ⚠ ${highRisk.length} ticket${highRisk.length > 1 ? 's' : ''} at HIGH escalation risk:`));
        for (const r of highRisk) {
          console.log(chalk.red(`    #${r.externalId}: ${r.summary.slice(0, 60)}`));
        }
      }

      console.log('');
    });
}
