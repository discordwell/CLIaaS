import type { Command } from 'commander';
import chalk from 'chalk';
import ora from 'ora';
import { loadTickets, loadKBArticles } from '../data.js';
import { getProvider } from '../providers/index.js';

const API_BASE = process.env.CLIAAS_API_URL || 'http://localhost:3000';

async function apiFetch(path: string, init?: RequestInit) {
  const url = `${API_BASE}${path}`;
  const res = await fetch(url, {
    ...init,
    headers: { 'Content-Type': 'application/json', ...init?.headers },
  });
  if (!res.ok) {
    const body = await res.json().catch(() => null);
    throw new Error(body?.error || `API error ${res.status}`);
  }
  return res.json();
}

export function registerKBCommand(program: Command): void {
  const kb = program
    .command('kb')
    .description('Knowledge base operations');

  // ---- translate ----
  kb
    .command('translate')
    .description('Create a translation for an article')
    .requiredOption('--article <id>', 'Article ID')
    .requiredOption('--locale <locale>', 'Target locale (e.g. es, fr, de)')
    .option('--title <title>', 'Translated title')
    .option('--body <body>', 'Translated body')
    .action(async (opts: { article: string; locale: string; title?: string; body?: string }) => {
      const spinner = ora(`Creating ${opts.locale} translation for article ${opts.article}...`).start();
      try {
        const payload: Record<string, string> = { locale: opts.locale };
        if (opts.title) payload.title = opts.title;
        if (opts.body) payload.body = opts.body;

        // If title/body not provided, fetch the parent article to use as template
        if (!opts.title || !opts.body) {
          const parentData = await apiFetch(`/api/kb/${opts.article}`);
          const parent = parentData.article;
          if (!opts.title) payload.title = `[${opts.locale.toUpperCase()}] ${parent.title}`;
          if (!opts.body) payload.body = parent.body;
        }

        const data = await apiFetch(`/api/kb/${opts.article}/translations`, {
          method: 'POST',
          body: JSON.stringify(payload),
        });

        spinner.succeed(`Translation created: ${data.translation?.id ?? 'ok'} (locale: ${opts.locale})`);
      } catch (err) {
        spinner.fail(`Translation failed: ${err instanceof Error ? err.message : err}`);
        process.exit(1);
      }
    });

  // ---- translate-status ----
  kb
    .command('translate-status')
    .description('Show translation coverage matrix')
    .option('--dir <dir>', 'Export directory')
    .action(async (opts: { dir?: string }) => {
      const spinner = ora('Loading translation status...').start();
      try {
        const articles = loadKBArticles(opts.dir);
        if (articles.length === 0) {
          spinner.warn('No KB articles found.');
          return;
        }

        // Group articles by parentArticleId
        const parents = articles.filter(a => !a.parentArticleId);
        const translations = articles.filter(a => a.parentArticleId);

        // Collect all locales
        const localeSet = new Set<string>();
        for (const a of articles) {
          if (a.locale) localeSet.add(a.locale);
        }
        const locales = Array.from(localeSet).sort();

        spinner.succeed(`${parents.length} articles, ${translations.length} translations, ${locales.length} locales\n`);

        // Header
        const colWidth = 8;
        const titleWidth = 40;
        const header = chalk.bold('Article'.padEnd(titleWidth)) +
          locales.map(l => l.padStart(colWidth)).join('');
        console.log(header);
        console.log('-'.repeat(titleWidth + locales.length * colWidth));

        // Matrix
        for (const parent of parents) {
          const parentLocale = parent.locale ?? 'en';
          const articleTranslations = translations.filter(t => t.parentArticleId === parent.id);
          const translatedLocales = new Set(articleTranslations.map(t => t.locale));
          translatedLocales.add(parentLocale);

          const title = parent.title.length > titleWidth - 2
            ? parent.title.slice(0, titleWidth - 5) + '...'
            : parent.title;

          const row = locales.map(l => {
            if (translatedLocales.has(l)) {
              return chalk.green('\u2713'.padStart(colWidth));
            }
            return chalk.red('\u2717'.padStart(colWidth));
          }).join('');

          console.log(`${title.padEnd(titleWidth)}${row}`);
        }
      } catch (err) {
        spinner.fail(`Failed: ${err instanceof Error ? err.message : err}`);
        process.exit(1);
      }
    });

  // ---- feedback ----
  kb
    .command('feedback')
    .description('Show feedback for an article')
    .requiredOption('--article <id>', 'Article ID')
    .action(async (opts: { article: string }) => {
      const spinner = ora('Loading feedback...').start();
      try {
        const data = await apiFetch(`/api/kb/${opts.article}`);
        const article = data.article;

        spinner.succeed(`Feedback for: ${article.title}\n`);

        const helpful = article.helpfulCount ?? 0;
        const notHelpful = article.notHelpfulCount ?? 0;
        const total = helpful + notHelpful;
        const rate = total > 0 ? Math.round((helpful / total) * 100) : 0;

        console.log(`  ${chalk.bold('Helpful:')}     ${chalk.green(String(helpful))}`);
        console.log(`  ${chalk.bold('Not Helpful:')} ${chalk.red(String(notHelpful))}`);
        console.log(`  ${chalk.bold('Total:')}       ${total}`);
        console.log(`  ${chalk.bold('Satisfaction:')} ${rate >= 70 ? chalk.green(`${rate}%`) : rate >= 40 ? chalk.yellow(`${rate}%`) : chalk.red(`${rate}%`)}`);
        console.log(`  ${chalk.bold('Views:')}       ${article.viewCount ?? 0}`);
      } catch (err) {
        spinner.fail(`Failed: ${err instanceof Error ? err.message : err}`);
        process.exit(1);
      }
    });

  // ---- content-gaps ----
  kb
    .command('content-gaps')
    .description('List content gaps (topics with no KB coverage)')
    .action(async () => {
      const spinner = ora('Loading content gaps...').start();
      try {
        const data = await apiFetch('/api/kb/content-gaps');
        const gaps = data.gaps ?? [];

        if (gaps.length === 0) {
          spinner.succeed('No content gaps detected.');
          return;
        }

        spinner.succeed(`${gaps.length} content gap${gaps.length !== 1 ? 's' : ''} found\n`);

        for (const [i, gap] of gaps.entries()) {
          const statusColor = gap.status === 'open' ? chalk.yellow : gap.status === 'resolved' ? chalk.green : chalk.gray;
          console.log(`${chalk.bold(`${i + 1}.`)} ${gap.topic}`);
          console.log(`   Status: ${statusColor(gap.status)} | Tickets: ${gap.ticketCount}`);
          if (gap.suggestedTitle) {
            console.log(`   Suggested: ${chalk.cyan(gap.suggestedTitle)}`);
          }
          console.log();
        }
      } catch (err) {
        spinner.fail(`Failed: ${err instanceof Error ? err.message : err}`);
        process.exit(1);
      }
    });

  // ---- seo-audit ----
  kb
    .command('seo-audit')
    .description('Audit KB articles for missing SEO fields')
    .option('--dir <dir>', 'Export directory')
    .action(async (opts: { dir?: string }) => {
      const spinner = ora('Auditing SEO fields...').start();
      try {
        // Try API first (includes DB-backed articles with full SEO fields)
        let articles: Array<{
          id: string;
          title: string;
          slug?: string;
          metaTitle?: string;
          metaDescription?: string;
        }>;

        try {
          const data = await apiFetch('/api/kb');
          articles = data.articles ?? [];
        } catch {
          // Fall back to local data
          articles = loadKBArticles(opts.dir);
        }

        if (articles.length === 0) {
          spinner.warn('No KB articles found.');
          return;
        }

        const issues: Array<{ article: string; id: string; missing: string[] }> = [];

        for (const a of articles) {
          const missing: string[] = [];
          if (!a.slug) missing.push('slug');
          if (!a.metaTitle) missing.push('meta_title');
          if (!a.metaDescription) missing.push('meta_description');
          if (missing.length > 0) {
            issues.push({ article: a.title, id: a.id, missing });
          }
        }

        if (issues.length === 0) {
          spinner.succeed(`All ${articles.length} articles pass SEO audit.`);
          return;
        }

        spinner.warn(`${issues.length}/${articles.length} articles have missing SEO fields\n`);

        for (const [i, issue] of issues.entries()) {
          const title = issue.article.length > 50
            ? issue.article.slice(0, 47) + '...'
            : issue.article;
          console.log(`${chalk.bold(`${i + 1}.`)} ${title}`);
          console.log(`   ID: ${issue.id}`);
          console.log(`   Missing: ${chalk.red(issue.missing.join(', '))}\n`);
        }
      } catch (err) {
        spinner.fail(`SEO audit failed: ${err instanceof Error ? err.message : err}`);
        process.exit(1);
      }
    });

  // ---- suggest (existing) ----
  kb
    .command('suggest')
    .description('Suggest relevant KB articles for a ticket')
    .requiredOption('--ticket <id>', 'Ticket ID')
    .option('--dir <dir>', 'Export directory')
    .option('--top <n>', 'Number of suggestions', '3')
    .option('--rag', 'Use RAG semantic search instead of LLM-based matching')
    .action(async (opts: { ticket: string; dir?: string; top: string; rag?: boolean }) => {
      const tickets = loadTickets(opts.dir);

      const ticket = tickets.find(t => t.id === opts.ticket || t.externalId === opts.ticket);
      if (!ticket) {
        console.error(chalk.red(`Ticket not found: ${opts.ticket}`));
        process.exit(1);
      }

      const top = parseInt(opts.top, 10);

      if (opts.rag) {
        // RAG-based semantic search
        console.log(chalk.cyan(`\nFinding relevant articles for: ${ticket.subject}`));
        console.log(chalk.gray('Mode: RAG semantic search\n'));

        const spinner = ora('Searching RAG store...').start();
        try {
          const { retrieve } = await import('../rag/retriever.js');
          const results = await retrieve({
            query: ticket.subject,
            topK: top * 2, // fetch extra to group by source
            sourceType: 'kb_article',
          });

          if (results.length === 0) {
            spinner.warn('No results. Import KB articles first: cliaas rag import source --type kb');
            return;
          }

          // Group by source article, keep highest score per article
          const articleMap = new Map<string, { title: string; score: number; content: string }>();
          for (const r of results) {
            const existing = articleMap.get(r.chunk.sourceId);
            if (!existing || r.combinedScore > existing.score) {
              articleMap.set(r.chunk.sourceId, {
                title: r.chunk.sourceTitle,
                score: r.combinedScore,
                content: r.chunk.content.slice(0, 200),
              });
            }
          }

          const articles = [...articleMap.entries()].slice(0, top);
          spinner.succeed(`Found ${articles.length} relevant articles\n`);

          for (const [i, [id, a]] of articles.entries()) {
            const score = Math.round(a.score * 1000);
            const scoreColor = score >= 12 ? chalk.green : score >= 8 ? chalk.yellow : chalk.gray;
            console.log(`${chalk.bold(`${i + 1}.`)} ${a.title}`);
            console.log(`   ID: ${id} | Score: ${scoreColor(String(score))}`);
            console.log(`   ${chalk.gray(a.content.replace(/\n/g, ' '))}...\n`);
          }
        } catch (err) {
          spinner.fail(`RAG search failed: ${err instanceof Error ? err.message : err}`);
          process.exit(1);
        }
        return;
      }

      // Original LLM-based matching
      const provider = getProvider();
      const articles = loadKBArticles(opts.dir);

      if (articles.length === 0) {
        console.log(chalk.yellow('No KB articles found in export data.'));
        return;
      }

      console.log(chalk.cyan(`\nFinding relevant articles for: ${ticket.subject}\n`));

      const spinner = ora('Analyzing with LLM...').start();
      try {
        const suggestions = await provider.suggestKB(ticket, articles);
        const display = suggestions.slice(0, top);
        spinner.succeed(`Found ${display.length} suggestions\n`);

        for (const [i, s] of display.entries()) {
          const score = Math.round(s.relevanceScore * 100);
          const scoreColor = score >= 80 ? chalk.green : score >= 50 ? chalk.yellow : chalk.gray;
          console.log(`${chalk.bold(`${i + 1}.`)} ${s.title}`);
          console.log(`   ID: ${s.articleId} | Relevance: ${scoreColor(`${score}%`)}`);
          console.log(`   ${chalk.gray(s.reasoning)}\n`);
        }
      } catch (err) {
        spinner.fail(`KB suggestion failed: ${err instanceof Error ? err.message : err}`);
        process.exit(1);
      }
    });
}
