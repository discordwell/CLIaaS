#!/usr/bin/env tsx
/**
 * Seed Zendesk with 25 realistic support tickets for demo purposes.
 * Usage: pnpm tsx scripts/seed-zendesk.ts
 */

import { zendeskCreateTicket, zendeskVerifyConnection, type ZendeskAuth } from '../cli/connectors/zendesk.js';
import chalk from 'chalk';
import 'dotenv/config';

const subdomain = process.env.ZENDESK_SUBDOMAIN;
const email = process.env.ZENDESK_EMAIL;
const token = process.env.ZENDESK_TOKEN;

if (!subdomain || !email || !token) {
  console.error(chalk.red('Missing required env vars: ZENDESK_SUBDOMAIN, ZENDESK_EMAIL, ZENDESK_TOKEN'));
  process.exit(1);
}

const auth: ZendeskAuth = { subdomain, email, token };

interface SeedTicket {
  subject: string;
  body: string;
  priority: 'urgent' | 'high' | 'normal' | 'low';
  tags: string[];
}

const tickets: SeedTicket[] = [
  // BILLING (5)
  {
    subject: 'Billing error on invoice #2026-0142',
    body: 'Hi, I was charged $147.50 instead of $99.99 on my latest invoice. The extra charge appeared as "Add-on: Premium Analytics" but I never subscribed to that. Can you please correct this and issue a credit? My account is acme-corp-2841.',
    priority: 'urgent',
    tags: ['billing', 'invoice', 'overcharge'],
  },
  {
    subject: 'Need to update payment method',
    body: 'Our company credit card was replaced. I need to update the payment method on file before the next billing cycle on March 1st. Can you walk me through the process or do it on your end?',
    priority: 'normal',
    tags: ['billing', 'payment', 'account'],
  },
  {
    subject: 'Requesting refund for duplicate charge',
    body: 'We were charged twice for our February subscription — $49.99 appeared on Feb 1 and again on Feb 3. Transaction IDs: TXN-88421 and TXN-88509. Please refund the duplicate.',
    priority: 'high',
    tags: ['billing', 'refund', 'duplicate-charge'],
  },
  {
    subject: 'Downgrade plan from Enterprise to Professional',
    body: 'We would like to downgrade from Enterprise ($299/mo) to Professional ($149/mo) effective next billing cycle. We no longer need the advanced reporting features. Please confirm what happens to our historical data when we downgrade.',
    priority: 'normal',
    tags: ['billing', 'plan-change', 'downgrade'],
  },
  {
    subject: 'Annual billing discount not applied',
    body: 'I switched to annual billing last month and was told I would receive a 20% discount. My latest invoice still shows the monthly rate. Order confirmation: ORD-2026-1187. Please apply the correct pricing.',
    priority: 'high',
    tags: ['billing', 'discount', 'annual-plan'],
  },

  // AUTH / PASSWORD (4)
  {
    subject: "Can't reset password — email not arriving",
    body: "I've tried resetting my password three times in the last hour but I'm not receiving the reset email. I've checked spam/junk folders. My email is jsmith@contoso.com. This is blocking our entire team from accessing the admin panel.",
    priority: 'urgent',
    tags: ['auth', 'password-reset', 'email'],
  },
  {
    subject: 'SSO login failing with SAML error',
    body: 'Since this morning, our team gets "SAML Response signature verification failed" when trying to log in via Okta SSO. Nothing changed on our IdP config. This affects all 45 users in our organization. Error trace attached.',
    priority: 'urgent',
    tags: ['auth', 'sso', 'saml', 'okta'],
  },
  {
    subject: 'Two-factor authentication locked out',
    body: "I lost my phone and can't access my 2FA codes. I don't have backup codes saved. My account email is karen.lee@brightwave.io. Can you disable 2FA so I can set it up again with my new device?",
    priority: 'high',
    tags: ['auth', '2fa', 'lockout'],
  },
  {
    subject: 'API token expired — automation broken',
    body: 'Our CI/CD pipeline uses an API token that expired overnight. All automated ticket creation from our monitoring system has stopped. We need a new long-lived token or guidance on token rotation best practices. Org ID: org-7712.',
    priority: 'high',
    tags: ['auth', 'api', 'token', 'automation'],
  },

  // FEATURE REQUESTS (4)
  {
    subject: 'Feature request: dark mode for dashboard',
    body: "Our support team works late shifts and the bright white dashboard causes eye strain. We'd love a dark mode option, even if it's just a simple CSS toggle. Several other tools we use (Slack, VS Code) already support this.",
    priority: 'normal',
    tags: ['feature-request', 'ui', 'dark-mode'],
  },
  {
    subject: 'Request: bulk ticket export to CSV',
    body: "We need to export our ticket data to CSV for quarterly reporting. Currently we can only export one ticket at a time. Could you add a bulk export feature with date range filtering? We have about 3,000 tickets per quarter.",
    priority: 'normal',
    tags: ['feature-request', 'export', 'reporting'],
  },
  {
    subject: 'Webhook support for ticket status changes',
    body: 'We want to integrate ticket status changes with our internal Slack bot. Could you add webhook support that fires on ticket create, update, and resolve events? We need the payload to include ticket ID, status, priority, and assignee.',
    priority: 'low',
    tags: ['feature-request', 'webhook', 'integration'],
  },
  {
    subject: 'Custom fields on ticket creation form',
    body: 'We need to add custom dropdown fields to the ticket creation form — specifically "Product Area" (Billing, API, Dashboard, Mobile) and "Customer Tier" (Free, Pro, Enterprise). This would help with routing and reporting.',
    priority: 'normal',
    tags: ['feature-request', 'custom-fields', 'forms'],
  },

  // BUG REPORTS (4)
  {
    subject: 'Dashboard loading spinner never resolves',
    body: 'Since the update on Feb 18, the main dashboard shows an infinite loading spinner. This happens in Chrome 121 and Firefox 124. Console shows a 500 error on GET /api/v2/dashboard/stats. Cleared cache, tried incognito — same result.',
    priority: 'high',
    tags: ['bug', 'dashboard', 'ui', 'loading'],
  },
  {
    subject: 'Ticket search returns wrong results for quoted phrases',
    body: 'When I search for "password reset" (with quotes for exact match), I get results containing just "password" or just "reset" separately. Exact phrase search seems broken. This used to work correctly last month.',
    priority: 'normal',
    tags: ['bug', 'search', 'tickets'],
  },
  {
    subject: 'Email notifications sent to wrong assignee',
    body: 'Ticket #4482 was reassigned from Mike to Sarah, but Mike keeps getting the email notifications instead of Sarah. This has happened on at least 3 other tickets this week. It seems like reassignment notifications are going to the previous assignee.',
    priority: 'high',
    tags: ['bug', 'notifications', 'email', 'assignee'],
  },
  {
    subject: 'Mobile app crashes when opening attachments',
    body: 'The iOS app (v3.2.1) crashes every time I try to open a PDF attachment on a ticket. Force closing and reopening doesn\'t help. iPhone 15 Pro, iOS 17.3. This started after the latest app update.',
    priority: 'normal',
    tags: ['bug', 'mobile', 'ios', 'crash', 'attachments'],
  },

  // ONBOARDING (3)
  {
    subject: 'New team setup — need onboarding walkthrough',
    body: "We just signed up for the Professional plan with 12 seats. We're migrating from Freshdesk and need help with: 1) Importing our existing 5,000 tickets, 2) Setting up our team structure and roles, 3) Configuring our email channel. When can we schedule an onboarding call?",
    priority: 'normal',
    tags: ['onboarding', 'new-customer', 'migration'],
  },
  {
    subject: 'How to set up email forwarding for support@',
    body: "I'm trying to configure our support@ourcompany.com to forward into the ticketing system but the verification email isn't arriving. I've added the MX records as specified in the docs. Our DNS provider is Cloudflare. Domain: ourcompany.com.",
    priority: 'normal',
    tags: ['onboarding', 'email', 'configuration', 'dns'],
  },
  {
    subject: 'Importing data from Intercom — format questions',
    body: 'We have a CSV export from Intercom with 8,200 conversations. The import tool shows "invalid format" for the date column. Intercom exports dates as "Feb 15, 2026 2:30 PM" but your system seems to want ISO 8601. Is there a conversion guide or can you handle the Intercom format?',
    priority: 'low',
    tags: ['onboarding', 'import', 'migration', 'intercom'],
  },

  // API ISSUES (3)
  {
    subject: 'API rate limit hit during bulk update',
    body: 'We\'re getting 429 Too Many Requests when running our nightly batch update script. We need to update ~500 tickets per run. Current rate limit seems to be 100 req/min. Can we get a rate limit increase, or is there a batch update endpoint we should use instead?',
    priority: 'high',
    tags: ['api', 'rate-limit', 'batch', 'integration'],
  },
  {
    subject: 'REST API v2 returning 502 intermittently',
    body: 'Our integration with /api/v2/tickets.json has been returning 502 Bad Gateway errors about 15% of the time since yesterday around 3pm EST. Response times for successful requests also increased from ~200ms to ~1.5s. Is there a known issue?',
    priority: 'urgent',
    tags: ['api', 'outage', '502', 'performance'],
  },
  {
    subject: 'GraphQL endpoint missing ticket.customFields',
    body: 'The GraphQL API documentation shows ticket.customFields as a queryable field, but when I include it in my query I get "Cannot query field customFields on type Ticket". Is this field not yet supported in GraphQL, or is the syntax different?',
    priority: 'low',
    tags: ['api', 'graphql', 'documentation', 'custom-fields'],
  },

  // ACCOUNT CHANGES (2)
  {
    subject: 'Update company name after acquisition',
    body: 'Our company "TechStart Labs" was acquired by "NovaCorp Global" effective Feb 1. We need to update: 1) Company name across the account, 2) Billing contact to finance@novacorp.com, 3) Primary admin to j.martinez@novacorp.com. Legal documentation attached.',
    priority: 'normal',
    tags: ['account', 'company-change', 'admin'],
  },
  {
    subject: 'Remove former employee access immediately',
    body: 'Employee david.chen@ourcompany.com was terminated today and needs immediate access revocation. He had admin-level access to our account. Please confirm once his access has been removed and send us an audit log of his recent activity.',
    priority: 'urgent',
    tags: ['account', 'security', 'access-revocation', 'urgent'],
  },
];

async function main() {
  console.log(chalk.bold('\nCLIaaS Zendesk Seed Script'));
  console.log(chalk.gray('─'.repeat(50)));

  // Verify connection first
  console.log(chalk.blue('Verifying Zendesk connection...'));
  const verify = await zendeskVerifyConnection(auth);
  if (!verify.success) {
    console.error(chalk.red(`Connection failed: ${verify.error}`));
    process.exit(1);
  }
  console.log(chalk.green(`Connected as ${verify.userName} (${verify.ticketCount} existing tickets)`));
  console.log('');

  let created = 0;
  let failed = 0;

  for (const ticket of tickets) {
    try {
      const result = await zendeskCreateTicket(auth, ticket.subject, ticket.body, {
        priority: ticket.priority,
        tags: ticket.tags,
      });
      created++;
      const priorityColor = {
        urgent: chalk.red,
        high: chalk.yellow,
        normal: chalk.blue,
        low: chalk.gray,
      }[ticket.priority];
      console.log(
        `  ${chalk.green('✓')} #${result.id} ${priorityColor(`[${ticket.priority.toUpperCase()}]`)} ${ticket.subject.slice(0, 60)}`
      );

      // Small delay to avoid rate limiting
      await new Promise(r => setTimeout(r, 500));
    } catch (err) {
      failed++;
      console.log(
        `  ${chalk.red('✗')} ${ticket.subject.slice(0, 60)} — ${err instanceof Error ? err.message : String(err)}`
      );
    }
  }

  console.log('');
  console.log(chalk.gray('─'.repeat(50)));
  console.log(chalk.green(`Created: ${created}`), failed > 0 ? chalk.red(`Failed: ${failed}`) : '');
  console.log('');
  console.log(chalk.blue('Next steps:'));
  console.log('  pnpm cliaas zendesk export    # Re-export with new tickets');
  console.log('  pnpm cliaas triage --limit 5  # Test LLM triage');
}

main().catch((err) => {
  console.error(chalk.red('Fatal error:'), err);
  process.exit(1);
});
