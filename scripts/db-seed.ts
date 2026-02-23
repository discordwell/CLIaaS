/**
 * Seed the database with demo data from fixtures/demo-data/.
 * Reuses the ingest pipeline from src/lib/zendesk/ingest.ts.
 *
 * Usage: DATABASE_URL=... pnpm db:seed
 */

import 'dotenv/config';
import { join } from 'path';
import { existsSync } from 'fs';
import { ingestZendeskExportDir } from '../src/lib/zendesk/ingest';
import { getPool } from '../src/db';

const FIXTURES_DIR = join(__dirname, '..', 'fixtures', 'demo-data');
const TENANT = 'demo';
const WORKSPACE = 'demo';

async function main() {
  if (!process.env.DATABASE_URL) {
    console.error('DATABASE_URL is required. Set it in .env.local or pass it directly.');
    process.exit(1);
  }

  if (!existsSync(join(FIXTURES_DIR, 'manifest.json'))) {
    console.error(`Missing fixtures at ${FIXTURES_DIR}. Ensure fixtures/demo-data/ contains manifest.json and JSONL files.`);
    process.exit(1);
  }

  console.log(`Seeding database from ${FIXTURES_DIR}...`);
  console.log(`  Tenant: ${TENANT}`);
  console.log(`  Workspace: ${WORKSPACE}`);

  await ingestZendeskExportDir({
    dir: FIXTURES_DIR,
    tenant: TENANT,
    workspace: WORKSPACE,
  });

  console.log('Seed complete.');

  // Close the pool so the process can exit
  const pool = getPool();
  if (pool) await pool.end();
}

main().catch((err) => {
  console.error('Seed failed:', err);
  process.exit(1);
});
