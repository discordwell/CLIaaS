/**
 * MCP campaign tools: campaign_list, campaign_create, campaign_send.
 * campaign_create and campaign_send use the confirmation pattern.
 */

import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { textResult, errorResult } from '../util.js';
import { withConfirmation, recordMCPAction } from './confirm.js';
import { scopeGuard } from './scopes.js';
import {
  getCampaigns,
  getCampaign,
  createCampaign,
  sendCampaign,
  getCampaignAnalytics,
} from '@/lib/campaigns/campaign-store.js';

export function registerCampaignTools(server: McpServer): void {
  // ---- campaign_list ----
  server.tool(
    'campaign_list',
    'List outbound campaigns with optional status filter',
    {
      status: z.enum(['draft', 'scheduled', 'sending', 'sent', 'cancelled']).optional().describe('Filter by status'),
      channel: z.enum(['email', 'sms', 'whatsapp']).optional().describe('Filter by channel'),
    },
    async ({ status, channel }) => {
      try {
        const campaigns = await getCampaigns({ status, channel });
        const summary = campaigns.map(c => ({
          id: c.id,
          name: c.name,
          channel: c.channel,
          status: c.status,
          subject: c.subject,
          sentAt: c.sentAt,
          createdAt: c.createdAt,
        }));

        return textResult({
          total: campaigns.length,
          campaigns: summary,
        });
      } catch (err) {
        return errorResult(err instanceof Error ? err.message : 'Failed to list campaigns');
      }
    },
  );

  // ---- campaign_create ----
  server.tool(
    'campaign_create',
    'Create a new outbound campaign (requires confirm=true)',
    {
      name: z.string().describe('Campaign name'),
      channel: z.enum(['email', 'sms', 'whatsapp']).describe('Delivery channel'),
      subject: z.string().optional().describe('Email subject line'),
      templateBody: z.string().optional().describe('Message body template (supports {{variable}} syntax)'),
      confirm: z.boolean().optional().describe('Must be true to create'),
    },
    async ({ name, channel, subject, templateBody, confirm }) => {
      const guard = scopeGuard('campaign_create');
      if (guard) return guard;

      const result = withConfirmation(confirm, {
        description: `Create ${channel} campaign: "${name}"`,
        preview: { name, channel, subject, templateBody },
        execute: () => {
          const campaign = createCampaign({ name, channel, subject, templateBody });

          const now = new Date().toISOString();
          recordMCPAction({
            tool: 'campaign_create', action: 'create',
            params: { name, channel },
            timestamp: now, result: 'success',
          });

          return {
            created: true,
            campaign: {
              id: campaign.id,
              name: campaign.name,
              channel: campaign.channel,
              status: campaign.status,
            },
            timestamp: now,
          };
        },
      });

      if (result.needsConfirmation) return result.result;
      const value = await result.value;
      return textResult(value);
    },
  );

  // ---- campaign_send ----
  server.tool(
    'campaign_send',
    'Trigger sending a campaign (must be draft or scheduled, requires confirm=true)',
    {
      campaignId: z.string().describe('Campaign ID'),
      confirm: z.boolean().optional().describe('Must be true to send'),
    },
    async ({ campaignId, confirm }) => {
      const guard = scopeGuard('campaign_send');
      if (guard) return guard;

      const campaign = await getCampaign(campaignId);
      if (!campaign) return errorResult(`Campaign "${campaignId}" not found.`);

      if (campaign.status !== 'draft' && campaign.status !== 'scheduled') {
        return errorResult(`Campaign "${campaignId}" is in status "${campaign.status}" — can only send draft or scheduled campaigns.`);
      }

      const result = withConfirmation(confirm, {
        description: `Send campaign: "${campaign.name}" via ${campaign.channel}`,
        preview: {
          campaignId: campaign.id,
          name: campaign.name,
          channel: campaign.channel,
          subject: campaign.subject,
          currentStatus: campaign.status,
        },
        execute: async () => {
          const sent = await sendCampaign(campaignId);
          if (!sent) return { sent: false, error: 'Failed to send campaign' };

          const analytics = await getCampaignAnalytics(campaignId);
          const now = new Date().toISOString();

          recordMCPAction({
            tool: 'campaign_send', action: 'send',
            params: { campaignId },
            timestamp: now, result: 'success',
          });

          return {
            sent: true,
            campaign: { id: sent.id, name: sent.name, status: sent.status, sentAt: sent.sentAt },
            recipientCount: analytics?.total ?? 0,
            timestamp: now,
          };
        },
      });

      if (result.needsConfirmation) return result.result;
      const value = await result.value;
      return textResult(value);
    },
  );
}
