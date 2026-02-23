import type { Command } from 'commander';
import chalk from 'chalk';
import ora from 'ora';
import { getPool } from '../../src/db/index.js';
import { importKBArticles, importTickets, importFile } from '../rag/importer.js';
import { retrieve, formatRetrievedContext } from '../rag/retriever.js';
import { getProvider } from '../providers/index.js';
import { buildRagAskPrompt } from '../providers/base.js';
import type { RagImportStats } from '../rag/types.js';

function requireDb() {
  const pool = getPool();
  if (!pool) {
    console.error(chalk.red('DATABASE_URL is not set. RAG requires a PostgreSQL database.'));
    console.error(chalk.yellow('Set DATABASE_URL in .env or environment.'));
    process.exit(1);
  }
  return pool;
}

function formatStats(stats: RagImportStats): void {
  console.log(chalk.green(`\n  Source type:  ${stats.sourceType}`));
  console.log(chalk.green(`  Sources:      ${stats.totalSources}`));
  console.log(chalk.green(`  Total chunks: ${stats.totalChunks}`));
  console.log(chalk.green(`  New/updated:  ${stats.newChunks}`));
  console.log(chalk.green(`  Skipped:      ${stats.skippedChunks}`));
  console.log(chalk.green(`  Embeddings:   ${stats.embeddingsGenerated}`));
  console.log(chalk.gray(`  Duration:     ${(stats.durationMs / 1000).toFixed(1)}s\n`));
}

export function registerRagCommands(program: Command): void {
  const rag = program
    .command('rag')
    .description('RAG (Retrieval-Augmented Generation) pipeline');

  // rag init
  rag
    .command('init')
    .description('Initialize pgvector extension, RAG tables, and indexes')
    .action(async () => {
      const pool = requireDb();
      const spinner = ora('Initializing RAG infrastructure...').start();

      try {
        // Enable pgvector extension
        await pool.query('CREATE EXTENSION IF NOT EXISTS vector');
        spinner.text = 'pgvector extension enabled';

        // Create enum types (idempotent)
        await pool.query(`
          DO $$ BEGIN
            CREATE TYPE rag_chunk_source AS ENUM ('kb_article', 'ticket_thread', 'external_file');
          EXCEPTION WHEN duplicate_object THEN NULL;
          END $$
        `);

        await pool.query(`
          DO $$ BEGIN
            CREATE TYPE rag_job_status AS ENUM ('running', 'success', 'error');
          EXCEPTION WHEN duplicate_object THEN NULL;
          END $$
        `);

        // Create rag_chunks table
        await pool.query(`
          CREATE TABLE IF NOT EXISTS rag_chunks (
            id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
            workspace_id UUID NOT NULL REFERENCES workspaces(id),
            source_type rag_chunk_source NOT NULL,
            source_id TEXT NOT NULL,
            source_title TEXT NOT NULL,
            chunk_index INTEGER NOT NULL,
            content TEXT NOT NULL,
            token_count INTEGER NOT NULL,
            content_hash VARCHAR(64) NOT NULL,
            metadata JSONB NOT NULL DEFAULT '{}',
            embedding vector(1536),
            created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
            updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
          )
        `);

        // Create rag_import_jobs table
        await pool.query(`
          CREATE TABLE IF NOT EXISTS rag_import_jobs (
            id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
            workspace_id UUID NOT NULL REFERENCES workspaces(id),
            source_type rag_chunk_source NOT NULL,
            status rag_job_status NOT NULL DEFAULT 'running',
            total_sources INTEGER NOT NULL DEFAULT 0,
            total_chunks INTEGER NOT NULL DEFAULT 0,
            new_chunks INTEGER NOT NULL DEFAULT 0,
            skipped_chunks INTEGER NOT NULL DEFAULT 0,
            error TEXT,
            started_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
            finished_at TIMESTAMPTZ
          )
        `);

        spinner.text = 'Tables created';

        // Create indexes
        await pool.query(`
          CREATE INDEX IF NOT EXISTS rag_chunks_workspace_source_idx
          ON rag_chunks (workspace_id, source_type, source_id)
        `);

        await pool.query(`
          CREATE UNIQUE INDEX IF NOT EXISTS rag_chunks_dedup_idx
          ON rag_chunks (workspace_id, source_id, chunk_index)
        `);

        // HNSW index for vector similarity search
        await pool.query(`
          CREATE INDEX IF NOT EXISTS rag_chunks_embedding_hnsw_idx
          ON rag_chunks USING hnsw (embedding vector_cosine_ops)
          WITH (m = 16, ef_construction = 64)
        `);

        spinner.text = 'HNSW index created';

        // Add generated tsvector column for full-text search
        await pool.query(`
          DO $$ BEGIN
            ALTER TABLE rag_chunks ADD COLUMN IF NOT EXISTS
              search_vector tsvector
              GENERATED ALWAYS AS (to_tsvector('english', content)) STORED;
          EXCEPTION WHEN duplicate_column THEN NULL;
          END $$
        `);

        // GIN index for full-text search
        await pool.query(`
          CREATE INDEX IF NOT EXISTS rag_chunks_search_vector_gin_idx
          ON rag_chunks USING gin (search_vector)
        `);

        spinner.succeed('RAG infrastructure initialized');
        console.log(chalk.green('\n  pgvector extension: enabled'));
        console.log(chalk.green('  rag_chunks table:   created'));
        console.log(chalk.green('  rag_import_jobs:    created'));
        console.log(chalk.green('  HNSW index:         created'));
        console.log(chalk.green('  GIN index:          created'));
        console.log(chalk.green('  tsvector column:    created\n'));
      } catch (err) {
        spinner.fail(`RAG init failed: ${err instanceof Error ? err.message : err}`);
        process.exit(1);
      }
    });

  // rag import
  const ragImport = rag
    .command('import')
    .description('Import data into the RAG vector store');

  ragImport
    .command('source')
    .description('Import KB articles or tickets')
    .requiredOption('--type <type>', 'Source type: kb or tickets')
    .option('--status <status>', 'Ticket status filter (e.g. solved)')
    .option('--dir <dir>', 'Export directory')
    .action(async (opts: { type: string; status?: string; dir?: string }) => {
      requireDb();
      const spinner = ora(`Importing ${opts.type}...`).start();

      try {
        let stats: RagImportStats;

        if (opts.type === 'kb') {
          stats = await importKBArticles(opts.dir);
        } else if (opts.type === 'tickets') {
          stats = await importTickets(opts.dir, opts.status);
        } else {
          spinner.fail(`Unknown source type: ${opts.type}. Use "kb" or "tickets".`);
          process.exit(1);
        }

        spinner.succeed(`Import complete`);
        formatStats(stats);
      } catch (err) {
        spinner.fail(`Import failed: ${err instanceof Error ? err.message : err}`);
        process.exit(1);
      }
    });

  ragImport
    .command('file')
    .description('Import a markdown/text file or directory')
    .argument('<path>', 'File or directory path')
    .action(async (path: string) => {
      requireDb();
      const spinner = ora(`Importing ${path}...`).start();

      try {
        const stats = await importFile(path);
        spinner.succeed('Import complete');
        formatStats(stats);
      } catch (err) {
        spinner.fail(`Import failed: ${err instanceof Error ? err.message : err}`);
        process.exit(1);
      }
    });

  // rag status
  rag
    .command('status')
    .description('Show RAG store statistics')
    .action(async () => {
      const pool = requireDb();

      try {
        // Check if rag_chunks table exists
        const tableCheck = await pool.query(`
          SELECT EXISTS (
            SELECT FROM information_schema.tables
            WHERE table_name = 'rag_chunks'
          ) AS exists
        `);

        if (!tableCheck.rows[0].exists) {
          console.log(chalk.yellow('RAG not initialized. Run: cliaas rag init'));
          return;
        }

        const counts = await pool.query(`
          SELECT source_type, COUNT(*) AS total,
                 COUNT(embedding) AS with_embedding
          FROM rag_chunks
          GROUP BY source_type
          ORDER BY source_type
        `);

        const totalResult = await pool.query('SELECT COUNT(*) AS total FROM rag_chunks');

        const lastJob = await pool.query(`
          SELECT source_type, status, finished_at
          FROM rag_import_jobs
          ORDER BY started_at DESC
          LIMIT 1
        `);

        console.log(chalk.cyan('\n  RAG Store Status\n'));
        console.log(chalk.gray(`  Total chunks: ${totalResult.rows[0].total}\n`));

        if (counts.rows.length === 0) {
          console.log(chalk.yellow('  No data imported yet. Run: cliaas rag import source --type kb'));
        } else {
          console.log(`  ${'Source Type'.padEnd(20)} ${'Chunks'.padEnd(10)} ${'Embedded'.padEnd(10)}`);
          console.log(`  ${'─'.repeat(20)} ${'─'.repeat(10)} ${'─'.repeat(10)}`);
          for (const row of counts.rows) {
            const type = String(row.source_type).padEnd(20);
            const total = String(row.total).padEnd(10);
            const embedded = String(row.with_embedding).padEnd(10);
            console.log(`  ${type} ${total} ${embedded}`);
          }
        }

        if (lastJob.rows.length > 0) {
          const job = lastJob.rows[0];
          console.log(chalk.gray(`\n  Last import: ${job.source_type} (${job.status}) at ${job.finished_at ?? 'running'}`));
        }

        console.log();
      } catch (err) {
        console.error(chalk.red(`Status check failed: ${err instanceof Error ? err.message : err}`));
        process.exit(1);
      }
    });

  // rag search
  rag
    .command('search')
    .description('Semantic search over the RAG store')
    .argument('<query>', 'Search query')
    .option('--top <n>', 'Number of results', '5')
    .option('--source <type>', 'Filter by source type')
    .action(async (query: string, opts: { top: string; source?: string }) => {
      requireDb();
      const topK = parseInt(opts.top, 10);
      if (isNaN(topK) || topK < 1) {
        console.error(chalk.red('--top must be a positive integer'));
        process.exit(1);
      }
      const spinner = ora('Searching...').start();

      try {
        const results = await retrieve({
          query,
          topK,
          sourceType: opts.source,
        });

        if (results.length === 0) {
          spinner.warn('No results found');
          return;
        }

        spinner.succeed(`Found ${results.length} results\n`);

        for (const [i, r] of results.entries()) {
          const score = (r.combinedScore * 1000).toFixed(1);
          const vScore = (r.vectorScore * 100).toFixed(0);
          const tScore = (r.textScore * 100).toFixed(0);

          console.log(chalk.bold(`${i + 1}. ${r.chunk.sourceTitle}`));
          console.log(chalk.gray(`   Type: ${r.chunk.sourceType} | Score: ${score} (vec: ${vScore}%, text: ${tScore}%)`));
          console.log(chalk.gray(`   ${r.chunk.content.slice(0, 200).replace(/\n/g, ' ')}...\n`));
        }
      } catch (err) {
        spinner.fail(`Search failed: ${err instanceof Error ? err.message : err}`);
        process.exit(1);
      }
    });

  // rag ask
  rag
    .command('ask')
    .description('Ask a question using RAG-retrieved context')
    .argument('<question>', 'Your question')
    .option('--top <n>', 'Number of context chunks', '5')
    .action(async (question: string, opts: { top: string }) => {
      requireDb();
      const topK = parseInt(opts.top, 10);
      if (isNaN(topK) || topK < 1) {
        console.error(chalk.red('--top must be a positive integer'));
        process.exit(1);
      }

      const searchSpinner = ora('Retrieving context...').start();

      try {
        const results = await retrieve({
          query: question,
          topK,
        });

        if (results.length === 0) {
          searchSpinner.warn('No relevant context found in RAG store');
          return;
        }

        searchSpinner.succeed(`Retrieved ${results.length} context chunks`);

        const context = formatRetrievedContext(results);
        const provider = getProvider();

        const answerSpinner = ora('Generating answer...').start();

        const prompt = buildRagAskPrompt(question, context);
        const reply = await provider.generateReply(
          { id: 'rag-ask', externalId: '', source: 'zendesk', subject: 'RAG Question', status: 'open', priority: 'normal', requester: 'user', tags: [], createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() },
          [{ id: 'q', ticketId: 'rag-ask', author: 'system', body: prompt, type: 'note', createdAt: new Date().toISOString() }],
        );

        answerSpinner.succeed('Answer generated\n');

        console.log(chalk.green('─── Answer ───'));
        console.log(reply);
        console.log(chalk.green('──────────────'));

        // Show sources
        console.log(chalk.gray('\nSources:'));
        for (const r of results) {
          console.log(chalk.gray(`  - ${r.chunk.sourceTitle} (${r.chunk.sourceType})`));
        }
        console.log();
      } catch (err) {
        console.error(chalk.red(`\nFailed: ${err instanceof Error ? err.message : err}`));
        process.exit(1);
      }
    });
}
