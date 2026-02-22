import type { Command } from 'commander';
import chalk from 'chalk';
import {
  exportKayakoClassic,
  kayakoClassicVerifyConnection,
  kayakoClassicUpdateTicket,
  kayakoClassicPostReply,
  kayakoClassicPostNote,
  kayakoClassicCreateTicket,
} from '../connectors/kayako-classic.js';
import type { KayakoClassicAuth } from '../connectors/kayako-classic.js';

function resolveAuth(opts: { domain?: string; apikey?: string; secret?: string }): KayakoClassicAuth {
  const domain = opts.domain ?? process.env.KAYAKO_CLASSIC_DOMAIN;
  const apiKey = opts.apikey ?? process.env.KAYAKO_CLASSIC_APIKEY;
  const secretKey = opts.secret ?? process.env.KAYAKO_CLASSIC_SECRET;

  if (!domain) { console.error(chalk.red('Missing --domain or KAYAKO_CLASSIC_DOMAIN env var')); process.exit(1); }
  if (!apiKey) { console.error(chalk.red('Missing --apikey or KAYAKO_CLASSIC_APIKEY env var')); process.exit(1); }
  if (!secretKey) { console.error(chalk.red('Missing --secret or KAYAKO_CLASSIC_SECRET env var')); process.exit(1); }

  return { domain, apiKey, secretKey };
}

export function registerKayakoClassicCommands(program: Command): void {
  const kayako = program
    .command('kayako-classic')
    .description('Kayako Classic operations: export, update, reply, note, create');

  kayako
    .command('verify')
    .description('Test Kayako Classic API connectivity and authentication')
    .option('--domain <domain>', 'Kayako Classic domain (or KAYAKO_CLASSIC_DOMAIN env)')
    .option('--apikey <key>', 'REST API key (or KAYAKO_CLASSIC_APIKEY env)')
    .option('--secret <secret>', 'REST API secret key (or KAYAKO_CLASSIC_SECRET env)')
    .action(async (opts: { domain?: string; apikey?: string; secret?: string }) => {
      const auth = resolveAuth(opts);
      console.log(chalk.cyan(`\nVerifying connection to ${auth.domain}...\n`));

      const result = await kayakoClassicVerifyConnection(auth);
      if (result.success) {
        console.log(chalk.green('  ✓ Connection successful'));
        console.log(`  Departments: ${result.departments?.join(', ') ?? 'none'}`);
        console.log(`  Tickets:     ${result.ticketCount ?? 'unknown'}`);
        console.log('');
      } else {
        console.error(chalk.red(`  ✗ Connection failed: ${result.error}\n`));
        process.exit(1);
      }
    });

  kayako
    .command('export')
    .description('Export all data from a Kayako Classic instance')
    .option('--domain <domain>', 'Kayako Classic domain (or KAYAKO_CLASSIC_DOMAIN env)')
    .option('--apikey <key>', 'REST API key (or KAYAKO_CLASSIC_APIKEY env)')
    .option('--secret <secret>', 'REST API secret key (or KAYAKO_CLASSIC_SECRET env)')
    .option('--out <dir>', 'Output directory', './exports/kayako-classic')
    .action(async (opts: { domain?: string; apikey?: string; secret?: string; out: string }) => {
      const auth = resolveAuth(opts);
      try {
        const manifest = await exportKayakoClassic(auth, opts.out);
        console.log(chalk.green('\nExport summary:'));
        console.log(`  Tickets:       ${manifest.counts.tickets}`);
        console.log(`  Messages:      ${manifest.counts.messages}`);
        console.log(`  Users:         ${manifest.counts.customers}`);
        console.log(`  Organizations: ${manifest.counts.organizations}`);
        console.log(`  KB Articles:   ${manifest.counts.kbArticles}`);
        console.log(`  Departments:   ${manifest.counts.rules}`);
      } catch (err) {
        console.error(chalk.red(`Export failed: ${err instanceof Error ? err.message : err}`));
        process.exit(1);
      }
    });

  kayako
    .command('update')
    .description('Update a Kayako Classic ticket')
    .requiredOption('--ticket <id>', 'Ticket ID')
    .option('--domain <domain>', 'Kayako Classic domain (or KAYAKO_CLASSIC_DOMAIN env)')
    .option('--apikey <key>', 'REST API key (or KAYAKO_CLASSIC_APIKEY env)')
    .option('--secret <secret>', 'REST API secret key (or KAYAKO_CLASSIC_SECRET env)')
    .option('--subject <subject>', 'New subject')
    .option('--statusid <id>', 'New status ID')
    .option('--priorityid <id>', 'New priority ID')
    .option('--departmentid <id>', 'New department ID')
    .option('--ownerstaffid <id>', 'Assigned staff ID')
    .action(async (opts: {
      ticket: string; domain?: string; apikey?: string; secret?: string;
      subject?: string; statusid?: string; priorityid?: string; departmentid?: string; ownerstaffid?: string;
    }) => {
      const auth = resolveAuth(opts);
      const ticketId = parseInt(opts.ticket, 10);
      if (isNaN(ticketId)) {
        console.error(chalk.red('Invalid ticket ID'));
        process.exit(1);
      }

      const updates: Parameters<typeof kayakoClassicUpdateTicket>[2] = {};
      if (opts.subject) updates.subject = opts.subject;
      if (opts.statusid) updates.statusid = parseInt(opts.statusid, 10);
      if (opts.priorityid) updates.priorityid = parseInt(opts.priorityid, 10);
      if (opts.departmentid) updates.departmentid = parseInt(opts.departmentid, 10);
      if (opts.ownerstaffid) updates.ownerstaffid = parseInt(opts.ownerstaffid, 10);

      if (!opts.subject && !opts.statusid && !opts.priorityid && !opts.departmentid && !opts.ownerstaffid) {
        console.error(chalk.red('No updates specified. Use --subject, --statusid, --priorityid, --departmentid, or --ownerstaffid'));
        process.exit(1);
      }

      try {
        await kayakoClassicUpdateTicket(auth, ticketId, updates);
        console.log(chalk.green(`Ticket #${ticketId} updated successfully`));
      } catch (err) {
        console.error(chalk.red(`Update failed: ${err instanceof Error ? err.message : err}`));
        process.exit(1);
      }
    });

  kayako
    .command('reply')
    .description('Post a reply to a Kayako Classic ticket')
    .requiredOption('--ticket <id>', 'Ticket ID')
    .requiredOption('--body <text>', 'Reply body text')
    .option('--domain <domain>', 'Kayako Classic domain (or KAYAKO_CLASSIC_DOMAIN env)')
    .option('--apikey <key>', 'REST API key (or KAYAKO_CLASSIC_APIKEY env)')
    .option('--secret <secret>', 'REST API secret key (or KAYAKO_CLASSIC_SECRET env)')
    .option('--staffid <id>', 'Staff ID for the reply')
    .action(async (opts: {
      ticket: string; body: string; domain?: string; apikey?: string; secret?: string; staffid?: string;
    }) => {
      const auth = resolveAuth(opts);
      const ticketId = parseInt(opts.ticket, 10);
      if (isNaN(ticketId)) {
        console.error(chalk.red('Invalid ticket ID'));
        process.exit(1);
      }
      try {
        await kayakoClassicPostReply(auth, ticketId, opts.body, opts.staffid ? parseInt(opts.staffid, 10) : undefined);
        console.log(chalk.green(`Reply posted to ticket #${ticketId}`));
      } catch (err) {
        console.error(chalk.red(`Reply failed: ${err instanceof Error ? err.message : err}`));
        process.exit(1);
      }
    });

  kayako
    .command('note')
    .description('Post an internal note to a Kayako Classic ticket')
    .requiredOption('--ticket <id>', 'Ticket ID')
    .requiredOption('--body <text>', 'Note body text')
    .option('--domain <domain>', 'Kayako Classic domain (or KAYAKO_CLASSIC_DOMAIN env)')
    .option('--apikey <key>', 'REST API key (or KAYAKO_CLASSIC_APIKEY env)')
    .option('--secret <secret>', 'REST API secret key (or KAYAKO_CLASSIC_SECRET env)')
    .option('--staffid <id>', 'Staff ID for the note')
    .action(async (opts: {
      ticket: string; body: string; domain?: string; apikey?: string; secret?: string; staffid?: string;
    }) => {
      const auth = resolveAuth(opts);
      const ticketId = parseInt(opts.ticket, 10);
      if (isNaN(ticketId)) {
        console.error(chalk.red('Invalid ticket ID'));
        process.exit(1);
      }
      try {
        await kayakoClassicPostNote(auth, ticketId, opts.body, opts.staffid ? parseInt(opts.staffid, 10) : undefined);
        console.log(chalk.green(`Internal note posted to ticket #${ticketId}`));
      } catch (err) {
        console.error(chalk.red(`Note failed: ${err instanceof Error ? err.message : err}`));
        process.exit(1);
      }
    });

  kayako
    .command('create')
    .description('Create a new Kayako Classic ticket')
    .requiredOption('--subject <subject>', 'Ticket subject')
    .requiredOption('--body <text>', 'Ticket body')
    .requiredOption('--departmentid <id>', 'Department ID (required)')
    .option('--domain <domain>', 'Kayako Classic domain (or KAYAKO_CLASSIC_DOMAIN env)')
    .option('--apikey <key>', 'REST API key (or KAYAKO_CLASSIC_APIKEY env)')
    .option('--secret <secret>', 'REST API secret key (or KAYAKO_CLASSIC_SECRET env)')
    .option('--email <email>', 'Creator email address')
    .option('--fullname <name>', 'Creator full name')
    .option('--statusid <id>', 'Status ID')
    .option('--priorityid <id>', 'Priority ID')
    .option('--staffid <id>', 'Staff ID')
    .action(async (opts: {
      subject: string; body: string; departmentid: string;
      domain?: string; apikey?: string; secret?: string;
      email?: string; fullname?: string; statusid?: string; priorityid?: string; staffid?: string;
    }) => {
      const auth = resolveAuth(opts);
      try {
        const result = await kayakoClassicCreateTicket(auth, opts.subject, opts.body, {
          departmentid: parseInt(opts.departmentid, 10),
          email: opts.email,
          fullname: opts.fullname,
          statusid: opts.statusid ? parseInt(opts.statusid, 10) : undefined,
          priorityid: opts.priorityid ? parseInt(opts.priorityid, 10) : undefined,
          staffid: opts.staffid ? parseInt(opts.staffid, 10) : undefined,
          autouserid: !opts.email, // auto-assign user if no email provided
        });
        console.log(chalk.green(`Ticket #${result.id} (${result.displayId}) created successfully`));
      } catch (err) {
        console.error(chalk.red(`Create failed: ${err instanceof Error ? err.message : err}`));
        process.exit(1);
      }
    });
}
