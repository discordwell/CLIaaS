/**
 * Seed first-party plugins into the marketplace.
 * Called on demand to ensure reference plugins are available.
 */

import { getListing, upsertListing } from '../marketplace-store';
import type { PluginManifestV2 } from '../types';

import slackManifest from './slack-notify/manifest.json';
import jiraManifest from './jira-sync/manifest.json';
import stripeManifest from './stripe-context/manifest.json';
import slaEscalatorManifest from './sla-escalator/manifest.json';
import csatSurveyManifest from './csat-survey/manifest.json';
import webhookRelayManifest from './webhook-relay/manifest.json';
import fieldSyncManifest from './field-sync/manifest.json';
import aiSummaryManifest from './ai-summary/manifest.json';

const FIRST_PARTY_MANIFESTS: PluginManifestV2[] = [
  slackManifest as unknown as PluginManifestV2,
  jiraManifest as unknown as PluginManifestV2,
  stripeManifest as unknown as PluginManifestV2,
  slaEscalatorManifest as unknown as PluginManifestV2,
  csatSurveyManifest as unknown as PluginManifestV2,
  webhookRelayManifest as unknown as PluginManifestV2,
  fieldSyncManifest as unknown as PluginManifestV2,
  aiSummaryManifest as unknown as PluginManifestV2,
];

export async function seedFirstPartyPlugins(): Promise<void> {
  for (const manifest of FIRST_PARTY_MANIFESTS) {
    const existing = await getListing(manifest.id);
    if (!existing) {
      await upsertListing({
        pluginId: manifest.id,
        manifest,
        status: 'published',
        featured: true,
      });
    }
  }
}
