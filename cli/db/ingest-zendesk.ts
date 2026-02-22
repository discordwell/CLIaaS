import chalk from 'chalk';
import { readFileSync, existsSync } from 'fs';
import { join } from 'path';
import ora from 'ora';
import type { Ticket, Message, Customer, Organization, KBArticle, Rule } from '../schema/types.js';
import { pool } from '../../src/db/index.js';
import { ingestZendeskExportDir } from '../../src/lib/zendesk/ingest.js';

interface IngestOptions {
  dir: string;
  tenant: string;
  workspace: string;
}

function readJsonl<T>(filePath: string): T[] {
  if (!existsSync(filePath)) return [];
  const results: T[] = [];
  for (const line of readFileSync(filePath, 'utf-8').split('\n')) {
    if (!line.trim()) continue;
    try {
      results.push(JSON.parse(line) as T);
    } catch {
      // Skip malformed lines
    }
  }
  return results;
}

export async function ingestZendeskToDb(opts: IngestOptions): Promise<void> {
  const manifestPath = join(opts.dir, 'manifest.json');
  if (!existsSync(manifestPath)) {
    throw new Error(`Missing manifest.json in ${opts.dir}`);
  }

  const ticketsData = readJsonl<Ticket>(join(opts.dir, 'tickets.jsonl'));
  const messagesData = readJsonl<Message>(join(opts.dir, 'messages.jsonl'));
  const customersData = readJsonl<Customer>(join(opts.dir, 'customers.jsonl'));
  const orgsData = readJsonl<Organization>(join(opts.dir, 'organizations.jsonl'));
  const groupsData = readJsonl<unknown>(join(opts.dir, 'groups.jsonl'));
  const fieldsData = readJsonl<unknown>(join(opts.dir, 'custom_fields.jsonl'));
  const viewsData = readJsonl<unknown>(join(opts.dir, 'views.jsonl'));
  const slaPoliciesData = readJsonl<unknown>(join(opts.dir, 'sla_policies.jsonl'));
  const formsData = readJsonl<unknown>(join(opts.dir, 'ticket_forms.jsonl'));
  const brandsData = readJsonl<unknown>(join(opts.dir, 'brands.jsonl'));
  const kbData = readJsonl<KBArticle>(join(opts.dir, 'kb_articles.jsonl'));
  const rulesData = readJsonl<Rule>(join(opts.dir, 'rules.jsonl'));
  const attachmentsCount = messagesData.reduce((sum, msg) => sum + (msg.attachments?.length ?? 0), 0);

  const spinner = ora('Ingesting Zendesk export into Postgres...').start();
  await ingestZendeskExportDir(opts);
  spinner.succeed('Zendesk ingest complete.');

  console.log(chalk.gray(`  Workspace: ${opts.workspace}`));
  console.log(chalk.gray(`  Tickets:   ${ticketsData.length}`));
  console.log(chalk.gray(`  Messages:  ${messagesData.length}`));
  console.log(chalk.gray(`  Customers: ${customersData.length}`));
  console.log(chalk.gray(`  Orgs:      ${orgsData.length}`));
  console.log(chalk.gray(`  Groups:    ${groupsData.length}`));
  console.log(chalk.gray(`  Fields:    ${fieldsData.length}`));
  console.log(chalk.gray(`  Views:     ${viewsData.length}`));
  console.log(chalk.gray(`  SLA:       ${slaPoliciesData.length}`));
  console.log(chalk.gray(`  Forms:     ${formsData.length}`));
  console.log(chalk.gray(`  Brands:    ${brandsData.length}`));
  console.log(chalk.gray(`  Attach:    ${attachmentsCount}`));
  console.log(chalk.gray(`  KB:        ${kbData.length}`));
  console.log(chalk.gray(`  Rules:     ${rulesData.length}`));
}

export async function runZendeskIngest(opts: IngestOptions): Promise<void> {
  try {
    await ingestZendeskToDb(opts);
  } finally {
    await pool.end();
  }
}
