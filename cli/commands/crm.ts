import type { Command } from 'commander';
import chalk from 'chalk';
import { output } from '../output.js';
import * as linkStore from '@/lib/integrations/link-store.js';
import { SalesforceClient } from '@/lib/integrations/salesforce-client.js';
import { HubSpotCrmClient } from '@/lib/integrations/hubspot-crm-client.js';
import { getCrmDataForCustomer } from '@/lib/integrations/crm-sync.js';

export function registerCrmCommands(program: Command): void {
  const crm = program.command('crm').description('CRM integration (Salesforce, HubSpot)');

  crm
    .command('configure')
    .description('Set CRM credentials')
    .requiredOption('--provider <provider>', 'CRM provider (salesforce or hubspot)')
    .option('--instance-url <url>', 'Salesforce instance URL')
    .option('--access-token <token>', 'Access token')
    .action(async (opts: { provider: string; instanceUrl?: string; accessToken?: string }) => {
      try {
        if (opts.provider === 'salesforce') {
          if (!opts.instanceUrl || !opts.accessToken) {
            console.error(chalk.red('Salesforce requires --instance-url and --access-token'));
            process.exitCode = 1;
            return;
          }
          const client = new SalesforceClient({ instanceUrl: opts.instanceUrl, accessToken: opts.accessToken });
          const info = await client.verify();
          linkStore.saveCredentials({
            workspaceId: 'default',
            provider: 'salesforce',
            authType: 'oauth2',
            credentials: { instanceUrl: opts.instanceUrl, accessToken: opts.accessToken },
            scopes: ['read', 'write'],
          });
          output({ ok: true, displayName: info.displayName }, () => {
            console.log(chalk.green(`Connected to Salesforce as ${info.displayName}`));
          });
        } else if (opts.provider === 'hubspot') {
          if (!opts.accessToken) {
            console.error(chalk.red('HubSpot requires --access-token'));
            process.exitCode = 1;
            return;
          }
          const client = new HubSpotCrmClient({ accessToken: opts.accessToken });
          const info = await client.verify();
          linkStore.saveCredentials({
            workspaceId: 'default',
            provider: 'hubspot-crm',
            authType: 'pat',
            credentials: { accessToken: opts.accessToken },
            scopes: ['read', 'write'],
          });
          output({ ok: true, portalId: info.portalId }, () => {
            console.log(chalk.green(`Connected to HubSpot portal ${info.portalId}`));
          });
        } else {
          console.error(chalk.red(`Unknown provider: ${opts.provider}`));
          process.exitCode = 1;
        }
      } catch (err) {
        console.error(chalk.red(`Failed: ${err instanceof Error ? err.message : String(err)}`));
        process.exitCode = 1;
      }
    });

  crm
    .command('show')
    .description('Show CRM data for a customer')
    .requiredOption('--customer <id>', 'Customer ID')
    .action((opts: { customer: string }) => {
      const data = getCrmDataForCustomer(opts.customer);
      output(data, () => {
        if (!data.length) { console.log('No CRM data linked to this customer.'); return; }
        for (const provider of data) {
          console.log(chalk.bold(`\n${provider.provider}`));
          for (const link of provider.links) {
            console.log(`  ${link.crmObjectType} ${link.crmObjectId}`);
            console.log(`    URL: ${link.crmObjectUrl ?? 'N/A'}`);
            const d = link.crmData;
            if (d.name) console.log(`    Name: ${d.name}`);
            if (d.email) console.log(`    Email: ${d.email}`);
            if (d.deals) console.log(`    Deals: ${(d.deals as unknown[]).length}`);
          }
        }
      });
    });

  crm
    .command('link')
    .description('Link a CRM record to a customer')
    .requiredOption('--customer <id>', 'Customer ID')
    .requiredOption('--provider <provider>', 'CRM provider (salesforce or hubspot)')
    .requiredOption('--type <type>', 'CRM object type (contact, account, deal)')
    .requiredOption('--record <id>', 'CRM record ID')
    .action((opts: { customer: string; provider: string; type: string; record: string }) => {
      const link = linkStore.createCrmLink({
        workspaceId: 'default',
        provider: opts.provider === 'hubspot' ? 'hubspot-crm' : opts.provider,
        entityType: 'customer',
        entityId: opts.customer,
        crmObjectType: opts.type,
        crmObjectId: opts.record,
        crmData: {},
      });
      output(link, () => {
        console.log(chalk.green(`Linked ${opts.type} ${opts.record} to customer ${opts.customer}`));
      });
    });

  crm
    .command('status')
    .description('Show CRM sync status')
    .action(() => {
      const sfCreds = linkStore.getCredentials('default', 'salesforce');
      const hubCreds = linkStore.getCredentials('default', 'hubspot-crm');
      const allCrmLinks = linkStore.listCrmLinks();

      const data = {
        salesforce: { configured: !!sfCreds, links: allCrmLinks.filter(l => l.provider === 'salesforce').length },
        hubspot: { configured: !!hubCreds, links: allCrmLinks.filter(l => l.provider === 'hubspot-crm').length },
        totalLinks: allCrmLinks.length,
      };

      output(data, () => {
        console.log(chalk.bold('\nCRM Status'));
        console.log('─'.repeat(40));
        console.log(`  Salesforce: ${sfCreds ? chalk.green('Connected') : chalk.gray('Not configured')} (${data.salesforce.links} links)`);
        console.log(`  HubSpot:    ${hubCreds ? chalk.green('Connected') : chalk.gray('Not configured')} (${data.hubspot.links} links)`);
        console.log(`  Total CRM links: ${data.totalLinks}`);
      });
    });
}
