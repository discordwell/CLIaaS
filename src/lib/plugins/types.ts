/**
 * Plugin platform types — manifest v2, installations, marketplace, reviews.
 */

// ---- Hook Types ----

export type PluginHookType =
  // Ticket lifecycle
  | 'ticket.created'
  | 'ticket.updated'
  | 'ticket.resolved'
  | 'ticket.deleted'
  | 'ticket.assigned'
  | 'ticket.tagged'
  | 'ticket.priority_changed'
  | 'ticket.merged'
  | 'ticket.split'
  | 'ticket.unmerged'
  // Messages
  | 'message.created'
  | 'message.updated'
  | 'message.displayed'
  | 'message.clicked'
  | 'message.dismissed'
  // SLA
  | 'sla.breached'
  | 'sla.warning'
  // Customer
  | 'customer.created'
  | 'customer.updated'
  | 'customer.merged'
  // Satisfaction & surveys
  | 'csat.submitted'
  | 'survey.submitted'
  | 'survey.sent'
  // KB
  | 'kb.article_created'
  | 'kb.article_updated'
  // Campaigns
  | 'campaign.created'
  | 'campaign.sent'
  | 'campaign.activated'
  | 'campaign.paused'
  | 'campaign.step_executed'
  | 'campaign.enrollment_completed'
  // Automation
  | 'automation.executed'
  // Forum
  | 'forum.thread_created'
  | 'forum.reply_created'
  | 'forum.thread_converted'
  // QA
  | 'qa.review_created'
  | 'qa.review_completed'
  // Time tracking
  | 'time.entry_created'
  // Side conversations
  | 'side_conversation.created'
  | 'side_conversation.replied'
  // Tours
  | 'tour.started'
  | 'tour.completed'
  | 'tour.dismissed'
  // Lifecycle hooks
  | 'plugin.installed'
  | 'plugin.uninstalled'
  | 'plugin.enabled'
  | 'plugin.disabled'
  | 'plugin.configured';

// ---- Permissions ----

export type PluginPermission =
  | 'tickets:read'
  | 'tickets:write'
  | 'customers:read'
  | 'customers:write'
  | 'kb:read'
  | 'kb:write'
  | 'messages:read'
  | 'messages:write'
  | 'analytics:read'
  | 'webhooks:manage'
  | 'oauth:external';

// ---- Runtime ----

export type PluginRuntime = 'node' | 'webhook';

// ---- UI Slots ----

export interface PluginUISlot {
  location: 'ticket.sidebar' | 'ticket.toolbar' | 'dashboard.widget' | 'nav.item';
  component: string;
}

// ---- OAuth ----

export interface PluginOAuthRequirement {
  provider: string;
  scopes: string[];
}

// ---- Manifest V2 ----

export interface PluginManifestV2 {
  id: string; // slug, e.g. "slack-notify"
  name: string;
  version: string;
  description: string;
  author: string;
  hooks: PluginHookType[];
  permissions: PluginPermission[];
  actions: PluginAction[];
  uiSlots: PluginUISlot[];
  oauthRequirements: PluginOAuthRequirement[];
  configSchema?: Record<string, unknown>; // JSON Schema
  entrypoint?: string; // path to handler code
  webhookUrl?: string; // for runtime: 'webhook'
  runtime: PluginRuntime;
  icon?: string;
  category?: string;
  dependencies?: string[]; // plugin IDs that must be installed before this one
}

export interface PluginAction {
  id: string;
  name: string;
  description: string;
}

// ---- Installation ----

export interface PluginInstallation {
  id: string;
  workspaceId: string;
  pluginId: string;
  version: string;
  enabled: boolean;
  config: Record<string, unknown>;
  installedBy?: string;
  createdAt: string;
  updatedAt: string;
}

// ---- Hook Context & Result ----

export interface PluginHookContext {
  event: string;
  data: Record<string, unknown>;
  timestamp: string;
  workspaceId?: string;
  pluginId?: string;
  config?: Record<string, unknown>;
}

export interface PluginHandlerResult {
  ok: boolean;
  data?: Record<string, unknown>;
  error?: string;
}

// ---- Marketplace ----

export type MarketplaceListingStatus = 'draft' | 'review' | 'published' | 'rejected' | 'deprecated';

export interface MarketplaceListing {
  id: string;
  pluginId: string;
  manifest: PluginManifestV2;
  status: MarketplaceListingStatus;
  publishedBy?: string;
  installCount: number;
  averageRating: number | null;
  reviewCount: number;
  featured: boolean;
  createdAt: string;
  updatedAt: string;
}

// ---- Reviews ----

export interface PluginReview {
  id: string;
  listingId: string;
  workspaceId: string;
  userId: string;
  rating: number; // 1-5
  title: string;
  body: string;
  createdAt: string;
  updatedAt: string;
}

// ---- Execution Logs ----

export interface PluginExecutionLog {
  id: string;
  installationId: string;
  workspaceId: string;
  hookName: string;
  status: string;
  durationMs: number;
  input?: Record<string, unknown>;
  output?: Record<string, unknown>;
  error?: string;
  createdAt: string;
}
