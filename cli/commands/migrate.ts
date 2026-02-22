import type { Command } from 'commander';
import { readFileSync, writeFileSync, existsSync } from 'fs';
import { join } from 'path';
import chalk from 'chalk';
import ora from 'ora';
import { loadTickets, loadMessages, getTicketMessages } from '../data.js';
import type { Ticket, Message, Customer, TicketStatus, TicketPriority } from '../schema/types.js';

import { zendeskCreateTicket, zendeskPostComment } from '../connectors/zendesk.js';
import type { ZendeskAuth } from '../connectors/zendesk.js';
import { freshdeskCreateTicket, freshdeskReply, freshdeskAddNote } from '../connectors/freshdesk.js';
import type { FreshdeskAuth } from '../connectors/freshdesk.js';
import { grooveCreateTicket, groovePostMessage } from '../connectors/groove.js';
import type { GrooveAuth } from '../connectors/groove.js';
import { helpcrunchCreateChat, helpcrunchPostMessage, helpcrunchFetch } from '../connectors/helpcrunch.js';
import type { HelpcrunchAuth } from '../connectors/helpcrunch.js';
import { kayakoCreateCase, kayakoPostReply, kayakoPostNote } from '../connectors/kayako.js';
import type { KayakoAuth } from '../connectors/kayako.js';
import { intercomCreateConversation, intercomReplyToConversation, intercomAddNote } from '../connectors/intercom.js';
import type { IntercomAuth } from '../connectors/intercom.js';
import { helpscoutCreateConversation, helpscoutReply, helpscoutAddNote } from '../connectors/helpscout.js';
import type { HelpScoutAuth } from '../connectors/helpscout.js';
import { zodeskCreateTicket, zodeskSendReply, zodeskAddComment } from '../connectors/zoho-desk.js';
import type { ZohoDeskAuth } from '../connectors/zoho-desk.js';
import { hubspotCreateTicket, hubspotCreateNote } from '../connectors/hubspot.js';
import type { HubSpotAuth } from '../connectors/hubspot.js';

type TargetConnector = 'zendesk' | 'freshdesk' | 'groove' | 'helpcrunch' | 'kayako' | 'intercom' | 'helpscout' | 'zoho-desk' | 'hubspot';
type AnyAuth = ZendeskAuth | FreshdeskAuth | GrooveAuth | HelpcrunchAuth | KayakoAuth | IntercomAuth | HelpScoutAuth | ZohoDeskAuth | HubSpotAuth;

interface MigrationEntry {
  destId: string;
  migratedAt: string;
}

type MigrationMap = Record<string, MigrationEntry>;

// ---- Auth resolution ----

function resolveTargetAuth(connector: TargetConnector): AnyAuth {
  switch (connector) {
    case 'zendesk': {
      const subdomain = process.env.ZENDESK_SUBDOMAIN;
      const email = process.env.ZENDESK_EMAIL;
      const token = process.env.ZENDESK_TOKEN;
      if (!subdomain || !email || !token) throw new Error('Missing ZENDESK_SUBDOMAIN, ZENDESK_EMAIL, or ZENDESK_TOKEN env vars');
      return { subdomain, email, token } as ZendeskAuth;
    }
    case 'freshdesk': {
      const subdomain = process.env.FRESHDESK_SUBDOMAIN;
      const apiKey = process.env.FRESHDESK_API_KEY;
      if (!subdomain || !apiKey) throw new Error('Missing FRESHDESK_SUBDOMAIN or FRESHDESK_API_KEY env vars');
      return { subdomain, apiKey } as FreshdeskAuth;
    }
    case 'groove': {
      const apiToken = process.env.GROOVE_API_TOKEN;
      if (!apiToken) throw new Error('Missing GROOVE_API_TOKEN env var');
      return { apiToken } as GrooveAuth;
    }
    case 'helpcrunch': {
      const apiKey = process.env.HELPCRUNCH_API_KEY;
      if (!apiKey) throw new Error('Missing HELPCRUNCH_API_KEY env var');
      return { apiKey } as HelpcrunchAuth;
    }
    case 'kayako': {
      const domain = process.env.KAYAKO_DOMAIN;
      const email = process.env.KAYAKO_EMAIL;
      const password = process.env.KAYAKO_PASSWORD;
      if (!domain || !email || !password) throw new Error('Missing KAYAKO_DOMAIN, KAYAKO_EMAIL, or KAYAKO_PASSWORD env vars');
      return { domain, email, password } as KayakoAuth;
    }
    case 'intercom': {
      const accessToken = process.env.INTERCOM_ACCESS_TOKEN;
      if (!accessToken) throw new Error('Missing INTERCOM_ACCESS_TOKEN env var');
      return { accessToken } as IntercomAuth;
    }
    case 'helpscout': {
      const appId = process.env.HELPSCOUT_APP_ID;
      const appSecret = process.env.HELPSCOUT_APP_SECRET;
      if (!appId || !appSecret) throw new Error('Missing HELPSCOUT_APP_ID or HELPSCOUT_APP_SECRET env vars');
      return { appId, appSecret } as HelpScoutAuth;
    }
    case 'zoho-desk': {
      const orgId = process.env.ZOHO_DESK_ORG_ID;
      const accessToken = process.env.ZOHO_DESK_ACCESS_TOKEN;
      if (!orgId || !accessToken) throw new Error('Missing ZOHO_DESK_ORG_ID or ZOHO_DESK_ACCESS_TOKEN env vars');
      return { orgId, accessToken } as ZohoDeskAuth;
    }
    case 'hubspot': {
      const accessToken = process.env.HUBSPOT_ACCESS_TOKEN;
      if (!accessToken) throw new Error('Missing HUBSPOT_ACCESS_TOKEN env var');
      return { accessToken } as HubSpotAuth;
    }
  }
}

// ---- Reverse status/priority mapping ----

function mapStatusToFreshdesk(status: TicketStatus): number {
  const map: Record<TicketStatus, number> = { open: 2, pending: 3, on_hold: 3, solved: 4, closed: 5 };
  return map[status] ?? 2;
}

function mapPriorityToFreshdesk(priority: TicketPriority): number {
  const map: Record<TicketPriority, number> = { low: 1, normal: 2, high: 3, urgent: 4 };
  return map[priority] ?? 1;
}

// Zendesk and Kayako use string labels matching canonical values directly
// Groove has no priority field — dropped silently
// HelpCrunch has no notes distinction — notes become regular messages

// ---- ID map persistence ----

function loadMigrationMap(sourceDir: string, connector: TargetConnector): MigrationMap {
  const mapPath = join(sourceDir, `migration-map-${connector}.json`);
  if (!existsSync(mapPath)) return {};
  try {
    return JSON.parse(readFileSync(mapPath, 'utf-8'));
  } catch {
    return {};
  }
}

function saveMigrationMap(sourceDir: string, connector: TargetConnector, map: MigrationMap): void {
  const mapPath = join(sourceDir, `migration-map-${connector}.json`);
  writeFileSync(mapPath, JSON.stringify(map, null, 2) + '\n');
}

// ---- Customer loading ----

function loadCustomers(dir: string): Customer[] {
  const filePath = join(dir, 'customers.jsonl');
  if (!existsSync(filePath)) return [];
  const results: Customer[] = [];
  for (const line of readFileSync(filePath, 'utf-8').split('\n')) {
    if (!line.trim()) continue;
    try { results.push(JSON.parse(line)); } catch { /* skip */ }
  }
  return results;
}

// ---- HelpCrunch customer resolution ----

const helpcrunchCustomerCache = new Map<string, number>();

async function resolveHelpcrunchCustomer(auth: HelpcrunchAuth, email: string, customers: Customer[]): Promise<number> {
  if (helpcrunchCustomerCache.has(email)) return helpcrunchCustomerCache.get(email)!;

  // Search HelpCrunch for existing customer
  try {
    const result = await helpcrunchFetch<{ data: Array<{ id: number; email: string | null }> }>(
      auth, `/customers?email=${encodeURIComponent(email)}&limit=1`,
    );
    if (result.data.length > 0) {
      helpcrunchCustomerCache.set(email, result.data[0].id);
      return result.data[0].id;
    }
  } catch { /* not found, create */ }

  // Find name from source customers
  const srcCustomer = customers.find(c => c.email === email);
  const name = srcCustomer?.name ?? email.split('@')[0] ?? 'Migrated User';

  // Create customer in HelpCrunch
  const created = await helpcrunchFetch<{ id: number }>(auth, '/customers', {
    method: 'POST',
    body: { email, name },
  });
  helpcrunchCustomerCache.set(email, created.id);
  return created.id;
}

// ---- Per-ticket migration ----

interface MigrateResult {
  destId: string;
  failedMessages: number;
}

function findRequesterEmail(ticket: Ticket, customers: Customer[]): string | undefined {
  const c = customers.find(c => c.id === ticket.requester || c.externalId === ticket.requester || c.email === ticket.requester);
  return c?.email || undefined;
}

async function migrateTicket(
  ticket: Ticket,
  messages: Message[],
  connector: TargetConnector,
  auth: AnyAuth,
  customers: Customer[],
): Promise<MigrateResult> {
  const sorted = [...messages].sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  const firstMsg = sorted[0];
  const body = firstMsg?.body || ticket.subject;
  const followUps = sorted.slice(1);

  // Step 1: Create the ticket (throw on failure — no cleanup needed)
  let destId: string;

  switch (connector) {
    case 'zendesk': {
      const a = auth as ZendeskAuth;
      const result = await zendeskCreateTicket(a, ticket.subject, body, {
        priority: ticket.priority,
        tags: ticket.tags,
      });
      destId = String(result.id);
      break;
    }
    case 'freshdesk': {
      const a = auth as FreshdeskAuth;
      const result = await freshdeskCreateTicket(a, ticket.subject, body, {
        email: findRequesterEmail(ticket, customers),
        priority: mapPriorityToFreshdesk(ticket.priority),
        status: mapStatusToFreshdesk(ticket.status),
        tags: ticket.tags,
      });
      destId = String(result.id);
      break;
    }
    case 'groove': {
      const a = auth as GrooveAuth;
      const to = findRequesterEmail(ticket, customers) || ticket.requester;
      const result = await grooveCreateTicket(a, to, body, {
        subject: ticket.subject,
        tags: ticket.tags,
      });
      destId = String(result.number);
      break;
    }
    case 'helpcrunch': {
      const a = auth as HelpcrunchAuth;
      const email = findRequesterEmail(ticket, customers) || ticket.requester;
      const customerId = await resolveHelpcrunchCustomer(a, email, customers);
      const result = await helpcrunchCreateChat(a, customerId, body);
      destId = String(result.id);
      break;
    }
    case 'kayako': {
      const a = auth as KayakoAuth;
      const result = await kayakoCreateCase(a, ticket.subject, body, {
        priority: ticket.priority,
        tags: ticket.tags,
      });
      destId = String(result.id);
      break;
    }
    case 'intercom': {
      const a = auth as IntercomAuth;
      // Intercom needs a contact ID — use requester directly or find from customers
      const contactId = ticket.requester;
      const result = await intercomCreateConversation(a, contactId, body);
      destId = result.id;
      break;
    }
    case 'helpscout': {
      const a = auth as HelpScoutAuth;
      const mailboxId = parseInt(process.env.HELPSCOUT_MAILBOX_ID ?? '0', 10);
      if (!mailboxId) throw new Error('HELPSCOUT_MAILBOX_ID env var required for migration');
      const requesterEmail = findRequesterEmail(ticket, customers);
      const result = await helpscoutCreateConversation(a, mailboxId, ticket.subject, body, {
        customerEmail: requesterEmail,
        tags: ticket.tags,
      });
      destId = String(result.id);
      break;
    }
    case 'zoho-desk': {
      const a = auth as ZohoDeskAuth;
      const result = await zodeskCreateTicket(a, ticket.subject, body, {
        priority: ticket.priority === 'low' ? 'Low' : ticket.priority === 'high' ? 'High' : ticket.priority === 'urgent' ? 'Urgent' : 'Medium',
        status: ticket.status === 'open' ? 'Open' : ticket.status === 'closed' ? 'Closed' : 'Open',
      });
      destId = result.id;
      break;
    }
    case 'hubspot': {
      const a = auth as HubSpotAuth;
      const result = await hubspotCreateTicket(a, ticket.subject, body, {
        priority: ticket.priority === 'low' ? 'LOW' : ticket.priority === 'high' ? 'HIGH' : 'MEDIUM',
      });
      destId = result.id;
      break;
    }
    default:
      throw new Error(`Unsupported connector: ${connector satisfies never}`);
  }

  // Step 2: Replay follow-up messages (continue on error to avoid orphaned tickets)
  let failedMessages = 0;
  for (const msg of followUps) {
    try {
      switch (connector) {
        case 'zendesk':
          await zendeskPostComment(auth as ZendeskAuth, Number(destId), msg.body, msg.type === 'reply');
          break;
        case 'freshdesk':
          if (msg.type === 'note') {
            await freshdeskAddNote(auth as FreshdeskAuth, Number(destId), msg.body);
          } else {
            await freshdeskReply(auth as FreshdeskAuth, Number(destId), msg.body);
          }
          break;
        case 'groove':
          await groovePostMessage(auth as GrooveAuth, Number(destId), msg.body, msg.type === 'note');
          break;
        case 'helpcrunch':
          await helpcrunchPostMessage(auth as HelpcrunchAuth, Number(destId), msg.body);
          break;
        case 'kayako':
          if (msg.type === 'note') {
            await kayakoPostNote(auth as KayakoAuth, Number(destId), msg.body);
          } else {
            await kayakoPostReply(auth as KayakoAuth, Number(destId), msg.body);
          }
          break;
        case 'intercom': {
          // Intercom requires an admin ID for replies/notes — use env var
          const adminId = process.env.INTERCOM_ADMIN_ID ?? '0';
          if (msg.type === 'note') {
            await intercomAddNote(auth as IntercomAuth, destId, msg.body, adminId);
          } else {
            await intercomReplyToConversation(auth as IntercomAuth, destId, msg.body, adminId);
          }
          break;
        }
        case 'helpscout':
          if (msg.type === 'note') {
            await helpscoutAddNote(auth as HelpScoutAuth, Number(destId), msg.body);
          } else {
            await helpscoutReply(auth as HelpScoutAuth, Number(destId), msg.body);
          }
          break;
        case 'zoho-desk':
          if (msg.type === 'note') {
            await zodeskAddComment(auth as ZohoDeskAuth, destId, msg.body, false);
          } else {
            await zodeskSendReply(auth as ZohoDeskAuth, destId, msg.body);
          }
          break;
        case 'hubspot':
          // HubSpot only supports notes on tickets, not threaded replies
          await hubspotCreateNote(auth as HubSpotAuth, destId, msg.body);
          break;
      }
    } catch {
      failedMessages++;
    }
  }

  return { destId, failedMessages };
}

// ---- Command registration ----

export function registerMigrateCommand(program: Command): void {
  program
    .command('migrate')
    .description('Migrate tickets from an export directory to a target connector')
    .requiredOption('--from <dir>', 'Source export directory (e.g., ./exports/zendesk)')
    .requiredOption('--to <connector>', 'Target connector (zendesk | freshdesk | groove | helpcrunch | kayako | intercom | helpscout | zoho-desk | hubspot)')
    .option('--dry-run', 'Preview migration without making API calls')
    .option('--limit <n>', 'Migrate only the first N tickets', parseInt)
    .action(async (opts: { from: string; to: string; dryRun?: boolean; limit?: number }) => {
      const connector = opts.to as TargetConnector;
      const validConnectors: TargetConnector[] = ['zendesk', 'freshdesk', 'groove', 'helpcrunch', 'kayako', 'intercom', 'helpscout', 'zoho-desk', 'hubspot'];
      if (!validConnectors.includes(connector)) {
        console.error(chalk.red(`Invalid target connector: ${opts.to}. Must be one of: ${validConnectors.join(', ')}`));
        process.exit(1);
      }

      if (!existsSync(opts.from)) {
        console.error(chalk.red(`Source directory not found: ${opts.from}`));
        process.exit(1);
      }

      // Resolve auth (skip in dry-run)
      let auth: AnyAuth | null = null;
      if (!opts.dryRun) {
        try {
          auth = resolveTargetAuth(connector);
        } catch (err) {
          console.error(chalk.red(err instanceof Error ? err.message : String(err)));
          process.exit(1);
        }
      }

      // Load source data
      const loadSpinner = ora('Loading source data...').start();
      const tickets = loadTickets(opts.from);
      const allMessages = loadMessages(opts.from);
      const customers = loadCustomers(opts.from);
      loadSpinner.succeed(`Loaded ${tickets.length} tickets, ${allMessages.length} messages, ${customers.length} customers`);

      // Load migration map
      const migrationMap = loadMigrationMap(opts.from, connector);
      const alreadyMigrated = Object.keys(migrationMap).length;
      if (alreadyMigrated > 0) {
        console.log(chalk.yellow(`  ${alreadyMigrated} tickets already migrated (will be skipped)`));
      }

      // Filter tickets
      let toMigrate = tickets.filter(t => !migrationMap[t.id]);
      if (opts.limit && opts.limit > 0) {
        toMigrate = toMigrate.slice(0, opts.limit);
      }

      if (toMigrate.length === 0) {
        console.log(chalk.green('\nNo tickets to migrate.'));
        return;
      }

      console.log(chalk.cyan(`\nMigrating ${toMigrate.length} tickets → ${connector}${opts.dryRun ? ' (dry run)' : ''}\n`));

      // Dry-run preview
      if (opts.dryRun) {
        for (const ticket of toMigrate) {
          const msgs = getTicketMessages(ticket.id, allMessages);
          console.log(`  ${chalk.bold(ticket.id)} — ${ticket.subject}`);
          console.log(`    Status: ${ticket.status} | Priority: ${ticket.priority} | Messages: ${msgs.length}`);
        }
        console.log(chalk.cyan(`\n${toMigrate.length} tickets would be migrated. Run without --dry-run to proceed.\n`));
        return;
      }

      // Live migration
      let succeeded = 0;
      let failed = 0;
      let partialMessages = 0;
      const spinner = ora('Migrating...').start();

      for (let i = 0; i < toMigrate.length; i++) {
        const ticket = toMigrate[i];
        const msgs = getTicketMessages(ticket.id, allMessages);
        spinner.text = `Migrating ${i + 1}/${toMigrate.length}: ${ticket.subject.slice(0, 50)}`;

        try {
          const result = await migrateTicket(ticket, msgs, connector, auth!, customers);
          migrationMap[ticket.id] = { destId: result.destId, migratedAt: new Date().toISOString() };
          saveMigrationMap(opts.from, connector, migrationMap);
          succeeded++;
          if (result.failedMessages > 0) {
            partialMessages += result.failedMessages;
            spinner.warn(`  Partial: ${ticket.id} → ${result.destId} (${result.failedMessages} messages failed)`);
            spinner.start();
          }
        } catch (err) {
          failed++;
          spinner.warn(`  Failed: ${ticket.id} — ${err instanceof Error ? err.message : String(err)}`);
          spinner.start();
        }
      }

      spinner.succeed('Migration complete');
      console.log('');
      console.log(chalk.green(`  Succeeded: ${succeeded}`));
      if (failed > 0) console.log(chalk.red(`  Failed:    ${failed}`));
      if (partialMessages > 0) console.log(chalk.yellow(`  Messages failed: ${partialMessages}`));
      console.log(chalk.gray(`  Map saved: ${join(opts.from, `migration-map-${connector}.json`)}`));
      console.log('');
    });
}
