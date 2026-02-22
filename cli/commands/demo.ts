import type { Command } from 'commander';
import { mkdirSync, writeFileSync, appendFileSync } from 'fs';
import { join } from 'path';
import chalk from 'chalk';
import ora from 'ora';
import type { Ticket, Message, Customer, Organization, KBArticle, Rule, ExportManifest } from '../schema/types.js';

const AGENTS = ['sarah.chen', 'mike.rodriguez', 'alex.kumar', 'jamie.wilson', 'pat.oconnor'];
const TAGS_POOL = ['vip', 'enterprise', 'billing', 'bug', 'feature-request', 'urgent', 'password', 'api', 'mobile', 'sso', 'invoice', 'downgrade', 'upgrade', 'trial'];

const TICKET_TEMPLATES: Array<{ subject: string; category: string; priority: Ticket['priority']; messages: string[] }> = [
  {
    subject: 'Billing error on invoice #INV-2026-0142',
    category: 'billing',
    priority: 'urgent',
    messages: [
      "Hi, I just received invoice #INV-2026-0142 and the amount is $47.50 higher than my subscription plan. I'm on the Team plan at $299/mo but was charged $346.50. Can you look into this?",
      "Hi! I've pulled up your account and I can see the discrepancy. It looks like a prorated charge was applied when you added 2 seats mid-cycle on Feb 10. Let me verify the exact breakdown.",
      "That makes sense for the seats, but I only added 1 seat, not 2. Can you check the seat change history?",
      "You're absolutely right — I can see only 1 seat was added on Feb 10 but the system logged it as 2. I've filed a correction and a credit of $47.50 will appear on your next invoice. I'm sorry about this.",
    ],
  },
  {
    subject: "Can't reset password — reset email never arrives",
    category: 'auth',
    priority: 'high',
    messages: [
      "I've tried resetting my password 5 times today and the email never arrives. I've checked spam, verified my email address, and tried both Chrome and Firefox. I'm locked out of my account.",
      "I'm sorry you're experiencing this. Let me check the email delivery logs for your account. Can you confirm the email address on file?",
      "It's jdoe@acmecorp.com. I've been using this account for 2 years without issues.",
      "I found the issue — your domain acmecorp.com recently updated their DMARC policy and our transactional emails are being rejected at the server level before they reach your inbox. I've triggered a reset via our backup delivery system. You should receive it within 5 minutes.",
      "Got it! Thanks for the quick fix. Might want to flag this for other acmecorp users too.",
    ],
  },
  {
    subject: 'Feature request: dark mode for dashboard',
    category: 'product',
    priority: 'normal',
    messages: [
      "Our team works late shifts and the bright white dashboard is painful at 2am. Any plans for dark mode?",
      "Thanks for the feedback! Dark mode is on our roadmap. I've added your vote to the feature request. Currently 47 other customers have requested this as well.",
      "Great, any ETA? Even a simple CSS invert would be better than nothing.",
    ],
  },
  {
    subject: 'Dashboard loading takes 30+ seconds',
    category: 'engineering',
    priority: 'high',
    messages: [
      "For the past 3 days, our main dashboard takes 30-45 seconds to load. We have 50 agents and this is killing our response times. Happens in all browsers.",
      "I'm escalating this to our engineering team immediately. Can you share your organization ID so we can check the backend metrics?",
      "Org ID is ORG-8842. It started around Tuesday afternoon.",
      "Found it — there was a database index that got corrupted during our Tuesday maintenance window. The team is rebuilding it now. You should see improvement within the hour.",
      "Confirmed — loads in under 2 seconds now. Thanks for the fast turnaround.",
    ],
  },
  {
    subject: 'Update company billing address',
    category: 'admin',
    priority: 'low',
    messages: [
      "We moved offices. New billing address: 500 Market St, Suite 300, San Francisco, CA 94105. Please update.",
      "Updated! The new address will appear on your next invoice. Let me know if you need anything else.",
    ],
  },
  {
    subject: 'SSO integration with Okta failing after update',
    category: 'integrations',
    priority: 'urgent',
    messages: [
      "After updating our Okta integration to use the new OIDC connector, none of our 200 agents can log in. This is a P1 for us.",
      "This is critical — I'm looping in our integrations team right now. Can you share your Okta tenant URL and the error message you're seeing?",
      "Tenant: acme.okta.com. Error: 'invalid_client — The client_id is not valid.' We triple-checked the client ID.",
      "Our integrations engineer found it — the new OIDC connector requires the client ID to be URL-encoded when it contains special characters. Your client ID has a '+' character. We're pushing a hotfix that handles this automatically. ETA 30 minutes.",
      "Hotfix is live. Can you try logging in again?",
      "Working! All 200 agents are back online. Please add URL-encoding to your setup docs.",
    ],
  },
  {
    subject: 'How to set up webhook notifications?',
    category: 'onboarding',
    priority: 'normal',
    messages: [
      "We just signed up for the Enterprise plan and want to set up webhooks to push ticket events to our Slack channel. Where do I configure this?",
      "Welcome aboard! Webhooks are configured under Settings → Integrations → Webhooks. Here's a step-by-step guide: [link to KB article #42]. You'll need your Slack webhook URL which you can generate at api.slack.com/incoming-webhooks.",
      "Perfect, got it working. One more question — can we filter webhooks to only fire on high-priority tickets?",
      "Yes! In the webhook configuration, there's a 'Conditions' section where you can set priority >= high. You can also filter by assignee group, tags, or custom fields.",
    ],
  },
  {
    subject: 'API rate limit too restrictive for our integration',
    category: 'integrations',
    priority: 'high',
    messages: [
      "We're hitting the 200 req/min rate limit constantly with our CRM sync. We process 10,000 tickets/day and the current limit means syncs take 50 minutes instead of 5.",
      "I understand this is impacting your workflow. For Enterprise customers, we can increase the rate limit. Let me check what tier would work for your volume.",
      "We'd need at least 2000 req/min to keep syncs under 10 minutes.",
      "I've approved a rate limit increase to 2500 req/min for your API key. The change is effective immediately. I've also set up monitoring on our side to make sure this doesn't impact service quality.",
    ],
  },
  {
    subject: 'Data export for compliance audit',
    category: 'admin',
    priority: 'normal',
    messages: [
      "We need a full export of all ticket data from the past 12 months for our SOC 2 audit. What format options do you have?",
      "We support JSON, CSV, and JSONL exports. For audit purposes, I'd recommend JSONL as it preserves all metadata including internal notes and timestamp precision. You can run: cliaas zendesk export --subdomain yourco --out ./audit-export",
      "Does the export include ticket deletion history and access logs?",
      "Yes, the full export includes audit trails. Access logs are in a separate endpoint — I'll add that to the export manifest. Give me a moment to prepare the extended export.",
    ],
  },
  {
    subject: 'Agent collision — two agents replying simultaneously',
    category: 'product',
    priority: 'normal',
    messages: [
      "We keep having incidents where two agents reply to the same ticket within seconds of each other, sending contradictory answers to customers. Is there a locking mechanism?",
      "This is a known pain point. We have a 'ticket locking' feature in beta — when an agent opens a ticket, others see a banner saying 'Sarah is viewing this ticket' and replies are queued rather than sent immediately. Want me to enable the beta for your account?",
      "Yes please! How does the queue work exactly?",
      "When Agent B tries to reply while Agent A has the lock, their reply goes into a 'pending review' state. Agent A sees a notification that a conflicting reply exists and can merge, replace, or discard it. I've enabled the beta for your org.",
    ],
  },
  {
    subject: 'Bulk import of 5000 historical tickets',
    category: 'onboarding',
    priority: 'normal',
    messages: [
      "We're migrating from our old system and have 5000 tickets in CSV format. What's the best way to import them while preserving timestamps and assignee history?",
      "For bulk imports, use our CLI tool: cliaas import --format csv --input ./historical.csv --preserve-timestamps. The CSV needs columns: subject, description, status, priority, created_at, assignee_email. I can send you a template.",
      "That would be great. Will it also import the reply threads?",
      "Reply threads need to be in a separate CSV with ticket_id, body, author_email, created_at columns. Run the ticket import first, then the replies import. The CLI handles the linking automatically.",
    ],
  },
  {
    subject: 'Downgrade from Enterprise to Team plan',
    category: 'billing',
    priority: 'normal',
    messages: [
      "We'd like to downgrade from Enterprise ($999/mo) to Team ($299/mo) at the end of this billing cycle. We no longer need SSO or the advanced reporting.",
      "I can schedule that downgrade for you. Just to confirm: you'll lose access to SSO, advanced reporting, custom roles, and the API rate limit will drop from 2500 to 200 req/min. The change takes effect on March 1.",
      "That's fine. We've already migrated off SSO. Please proceed.",
      "Done — your plan will switch to Team on March 1. You'll receive a confirmation email shortly. If you change your mind before then, just let us know.",
    ],
  },
];

function pick<T>(arr: T[]): T {
  return arr[Math.floor(Math.random() * arr.length)];
}

function pickN<T>(arr: T[], n: number): T[] {
  const shuffled = [...arr].sort(() => Math.random() - 0.5);
  return shuffled.slice(0, n);
}

function randomDate(daysBack: number): string {
  const now = Date.now();
  const offset = Math.random() * daysBack * 24 * 60 * 60 * 1000;
  return new Date(now - offset).toISOString();
}

function appendJsonl(filePath: string, record: unknown): void {
  appendFileSync(filePath, JSON.stringify(record) + '\n');
}

const KB_ARTICLES: KBArticle[] = [
  { id: 'kb-1', externalId: '1001', source: 'zendesk', title: 'How to reset your password', body: 'Navigate to Settings → Security → Password Reset. Click "Send Reset Email". If the email doesn\'t arrive within 5 minutes, check your spam folder and verify your DMARC settings. Enterprise customers with SSO should use their identity provider\'s password reset flow instead.', categoryPath: ['Account', 'Security'] },
  { id: 'kb-2', externalId: '1002', source: 'zendesk', title: 'Understanding your invoice', body: 'Your monthly invoice includes: base subscription fee, prorated charges for mid-cycle seat changes, any add-on features, and applicable taxes. Prorated charges are calculated daily. To view invoice history, go to Settings → Billing → Invoice History.', categoryPath: ['Billing'] },
  { id: 'kb-3', externalId: '1003', source: 'zendesk', title: 'Setting up SSO with Okta', body: 'Prerequisites: Enterprise plan, Okta admin access. Step 1: Create a new OIDC app in Okta. Step 2: Copy the Client ID and Client Secret. Step 3: In CLIaaS Settings → SSO, paste the credentials and set the Okta tenant URL. Step 4: Test with a single user before rolling out. Note: Client IDs containing special characters must be URL-encoded.', categoryPath: ['Integrations', 'SSO'] },
  { id: 'kb-4', externalId: '1004', source: 'zendesk', title: 'Webhook configuration guide', body: 'Webhooks send HTTP POST requests to your endpoint when ticket events occur. Supported events: ticket.created, ticket.updated, ticket.solved, ticket.assigned. Configure at Settings → Integrations → Webhooks. Use conditions to filter events by priority, tags, or assignee group.', categoryPath: ['Integrations', 'Webhooks'] },
  { id: 'kb-5', externalId: '1005', source: 'zendesk', title: 'API rate limits by plan', body: 'Free: 50 req/min. Team: 200 req/min. Enterprise: 2500 req/min (adjustable on request). Rate limit headers: X-RateLimit-Limit, X-RateLimit-Remaining, X-RateLimit-Reset. When limit is exceeded, API returns 429 with Retry-After header.', categoryPath: ['API', 'Limits'] },
  { id: 'kb-6', externalId: '1006', source: 'zendesk', title: 'Bulk data import guide', body: 'Use the CLIaaS CLI for bulk imports: cliaas import --format csv --input file.csv. Required columns: subject, description, status, priority, created_at. Optional: assignee_email, tags, custom_fields. For reply threads, use a separate CSV with ticket_id, body, author_email, created_at.', categoryPath: ['Migration', 'Import'] },
  { id: 'kb-7', externalId: '1007', source: 'zendesk', title: 'Data export for compliance', body: 'Full data exports are available in JSON, CSV, and JSONL formats. Use cliaas export for automated exports. Exports include: tickets, replies, internal notes, user data, audit trails. For SOC 2 compliance, use JSONL format which preserves all metadata and timestamps.', categoryPath: ['Compliance', 'Export'] },
  { id: 'kb-8', externalId: '1008', source: 'zendesk', title: 'Ticket collision prevention', body: 'Enable ticket locking (beta) to prevent multiple agents from replying simultaneously. When enabled, agents see a real-time indicator showing who else is viewing the ticket. Conflicting replies are queued for review instead of sent immediately.', categoryPath: ['Features', 'Collaboration'] },
  { id: 'kb-9', externalId: '1009', source: 'zendesk', title: 'Plan comparison: Team vs Enterprise', body: 'Team ($299/mo): 10 agents, basic reporting, 200 API req/min, email support. Enterprise ($999/mo): unlimited agents, advanced reporting, SSO, custom roles, 2500 API req/min, priority support, audit logs, data retention controls.', categoryPath: ['Billing', 'Plans'] },
];

const RULES: Rule[] = [
  { id: 'rule-1', externalId: 'r1', source: 'zendesk', type: 'trigger', title: 'Auto-assign billing tickets to billing team', conditions: { all: [{ field: 'tag', operator: 'includes', value: 'billing' }] }, actions: [{ field: 'group', value: 'billing-team' }], active: true },
  { id: 'rule-2', externalId: 'r2', source: 'zendesk', type: 'trigger', title: 'Escalate urgent tickets to senior agents', conditions: { all: [{ field: 'priority', operator: 'is', value: 'urgent' }] }, actions: [{ field: 'group', value: 'senior-support' }, { field: 'notify', value: 'slack-urgent-channel' }], active: true },
  { id: 'rule-3', externalId: 'r3', source: 'zendesk', type: 'automation', title: 'Auto-close solved tickets after 48h', conditions: { all: [{ field: 'status', operator: 'is', value: 'solved' }, { field: 'hours_since_update', operator: 'greater_than', value: 48 }] }, actions: [{ field: 'status', value: 'closed' }], active: true },
  { id: 'rule-4', externalId: 'r4', source: 'zendesk', type: 'macro', title: 'Request more information', conditions: null, actions: [{ field: 'status', value: 'pending' }, { field: 'comment', value: 'Thanks for reaching out. To help resolve this, could you provide: 1) Your account email 2) Steps to reproduce 3) Any error messages or screenshots?' }], active: true },
  { id: 'rule-5', externalId: 'r5', source: 'zendesk', type: 'sla', title: 'Enterprise SLA: 1h first response', conditions: { all: [{ field: 'plan', operator: 'is', value: 'enterprise' }] }, actions: [{ field: 'first_reply_time', value: '1h' }, { field: 'next_reply_time', value: '4h' }, { field: 'resolution_time', value: '24h' }], active: true },
  { id: 'rule-6', externalId: 'r6', source: 'zendesk', type: 'trigger', title: 'Tag SSO-related tickets', conditions: { any: [{ field: 'subject', operator: 'contains', value: 'SSO' }, { field: 'subject', operator: 'contains', value: 'Okta' }, { field: 'subject', operator: 'contains', value: 'SAML' }] }, actions: [{ field: 'tag', value: 'sso' }], active: true },
];

export function registerDemoCommand(program: Command): void {
  program
    .command('demo')
    .description('Generate realistic sample data for demo/testing (no API keys needed)')
    .option('--out <dir>', 'Output directory', './exports/demo')
    .option('--tickets <n>', 'Number of tickets to generate', '50')
    .action(async (opts: { out: string; tickets: string }) => {
      const outDir = opts.out;
      const numTickets = Math.min(parseInt(opts.tickets, 10), 500);

      mkdirSync(outDir, { recursive: true });

      const ticketsFile = join(outDir, 'tickets.jsonl');
      const messagesFile = join(outDir, 'messages.jsonl');
      const customersFile = join(outDir, 'customers.jsonl');
      const orgsFile = join(outDir, 'organizations.jsonl');
      const kbFile = join(outDir, 'kb_articles.jsonl');
      const rulesFile = join(outDir, 'rules.jsonl');

      for (const f of [ticketsFile, messagesFile, customersFile, orgsFile, kbFile, rulesFile]) {
        writeFileSync(f, '');
      }

      const counts = { tickets: 0, messages: 0, customers: 0, organizations: 0, kbArticles: 0, rules: 0 };

      // Generate organizations
      const orgSpinner = ora('Generating organizations...').start();
      const orgs = [
        { name: 'Acme Corp', domains: ['acmecorp.com'] },
        { name: 'Globex Industries', domains: ['globex.com', 'globex.io'] },
        { name: 'Initech Solutions', domains: ['initech.com'] },
        { name: 'Massive Dynamic', domains: ['massivedynamic.com'] },
        { name: 'Stark Industries', domains: ['stark.com'] },
        { name: 'Wayne Enterprises', domains: ['wayne.co'] },
        { name: 'Cyberdyne Systems', domains: ['cyberdyne.io'] },
        { name: 'Umbrella Corp', domains: ['umbrella.com'] },
      ];

      for (const [i, o] of orgs.entries()) {
        const org: Organization = {
          id: `demo-org-${i + 1}`,
          externalId: String(i + 1),
          source: 'zendesk',
          name: o.name,
          domains: o.domains,
        };
        appendJsonl(orgsFile, org);
        counts.organizations++;
      }
      orgSpinner.succeed(`${counts.organizations} organizations generated`);

      // Generate customers
      const customerSpinner = ora('Generating customers...').start();
      const customerNames = [
        'John Doe', 'Jane Smith', 'Alice Johnson', 'Bob Williams', 'Carol Brown',
        'David Lee', 'Eva Martinez', 'Frank Garcia', 'Grace Kim', 'Henry Patel',
        'Iris Nakamura', 'Jack Thompson', 'Kate O\'Brien', 'Leo Fernandez', 'Mia Zhang',
        'Noah Johansson', 'Olivia Dubois', 'Peter Muller', 'Quinn O\'Sullivan', 'Rachel Tanaka',
      ];
      const customers: Customer[] = [];
      for (const [i, name] of customerNames.entries()) {
        const orgIdx = i % orgs.length;
        const email = name.toLowerCase().replace(/[' ]/g, '.').replace('..', '.') + '@' + orgs[orgIdx].domains[0];
        const customer: Customer = {
          id: `demo-user-${i + 1}`,
          externalId: String(1000 + i),
          source: 'zendesk',
          name,
          email,
          orgId: `demo-org-${orgIdx + 1}`,
        };
        appendJsonl(customersFile, customer);
        customers.push(customer);
        counts.customers++;
      }
      customerSpinner.succeed(`${counts.customers} customers generated`);

      // Generate tickets with realistic conversation threads
      const ticketSpinner = ora('Generating tickets...').start();
      const statuses: Ticket['status'][] = ['open', 'open', 'open', 'pending', 'pending', 'solved', 'solved', 'closed'];

      for (let i = 0; i < numTickets; i++) {
        const template = TICKET_TEMPLATES[i % TICKET_TEMPLATES.length];
        const suffix = i >= TICKET_TEMPLATES.length ? ` (#${Math.floor(i / TICKET_TEMPLATES.length) + 1})` : '';
        const customer = customers[i % customers.length];
        const agent = pick(AGENTS);
        const created = randomDate(30);
        const updated = randomDate(7);
        const status = i < 15 ? pick(['open', 'open', 'pending'] as const) : pick(statuses);

        const ticket: Ticket = {
          id: `demo-${4500 + i}`,
          externalId: String(4500 + i),
          source: 'zendesk',
          subject: template.subject + suffix,
          status,
          priority: template.priority,
          assignee: agent,
          requester: customer.email,
          tags: pickN(TAGS_POOL, 2 + Math.floor(Math.random() * 3)),
          createdAt: created,
          updatedAt: updated,
        };
        appendJsonl(ticketsFile, ticket);
        counts.tickets++;

        // Generate messages for this ticket
        for (const [j, body] of template.messages.entries()) {
          const isCustomer = j % 2 === 0;
          const msg: Message = {
            id: `demo-msg-${i * 10 + j}`,
            ticketId: ticket.id,
            author: isCustomer ? customer.name : agent,
            body,
            type: 'reply',
            createdAt: new Date(new Date(created).getTime() + j * 3600000).toISOString(),
          };
          appendJsonl(messagesFile, msg);
          counts.messages++;
        }

        ticketSpinner.text = `Generating tickets... ${counts.tickets}`;
      }
      ticketSpinner.succeed(`${counts.tickets} tickets generated (${counts.messages} messages)`);

      // Write KB articles
      const kbSpinner = ora('Generating KB articles...').start();
      for (const article of KB_ARTICLES) {
        appendJsonl(kbFile, article);
        counts.kbArticles++;
      }
      kbSpinner.succeed(`${counts.kbArticles} KB articles generated`);

      // Write rules
      const rulesSpinner = ora('Generating business rules...').start();
      for (const rule of RULES) {
        appendJsonl(rulesFile, rule);
        counts.rules++;
      }
      rulesSpinner.succeed(`${counts.rules} business rules generated`);

      // Write manifest
      const manifest: ExportManifest = {
        source: 'zendesk',
        exportedAt: new Date().toISOString(),
        counts,
      };
      writeFileSync(join(outDir, 'manifest.json'), JSON.stringify(manifest, null, 2) + '\n');

      console.log(chalk.green(`\nDemo data ready → ${outDir}/`));
      console.log(chalk.cyan('\nTry these commands:'));
      console.log(`  cliaas tickets list --dir ${outDir}`);
      console.log(`  cliaas tickets show demo-4500 --dir ${outDir}`);
      console.log(`  cliaas triage --dir ${outDir} --limit 5`);
      console.log(`  cliaas draft reply --ticket demo-4500 --dir ${outDir}`);
      console.log(`  cliaas kb suggest --ticket demo-4500 --dir ${outDir}`);
      console.log(`  cliaas summarize --dir ${outDir}`);
    });
}
