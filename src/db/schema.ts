import { sql } from 'drizzle-orm';
import {
  pgTable,
  pgEnum,
  uuid,
  text,
  varchar,
  integer,
  bigint,
  boolean,
  numeric,
  jsonb,
  timestamp,
  primaryKey,
  uniqueIndex,
  index,
  inet,
  customType,
  date,
  time,
  real,
  smallint,
} from 'drizzle-orm/pg-core';

export const providerEnum = pgEnum('provider', [
  'zendesk',
  'kayako',
  'kayako-classic',
  'helpcrunch',
  'freshdesk',
  'groove',
  'intercom',
  'helpscout',
  'zoho-desk',
  'hubspot',
]);

export const ticketStatusEnum = pgEnum('ticket_status', [
  'open',
  'pending',
  'on_hold',
  'solved',
  'closed',
]);

export const ticketPriorityEnum = pgEnum('ticket_priority', [
  'low',
  'normal',
  'high',
  'urgent',
]);

export const ruleTypeEnum = pgEnum('rule_type', [
  'macro',
  'trigger',
  'automation',
  'sla',
]);

export const templateScopeEnum = pgEnum('template_scope', ['personal', 'shared']);

export const channelTypeEnum = pgEnum('channel_type', [
  'email',
  'chat',
  'api',
  'sms',
  'phone',
  'web',
  'whatsapp',
  'facebook',
  'instagram',
  'twitter',
  'slack',
  'teams',
  'telegram',
  'sdk',
  'other',
]);

export const messageAuthorEnum = pgEnum('message_author_type', [
  'user',
  'customer',
  'system',
  'bot',
]);

export const messageVisibilityEnum = pgEnum('message_visibility', [
  'public',
  'internal',
]);

export const notificationTypeEnum = pgEnum('notification_type', [
  'mention',
  'side_conversation_reply',
  'assignment',
  'escalation',
]);

export const conversationKindEnum = pgEnum('conversation_kind', [
  'primary',
  'side',
]);

export const sideConversationStatusEnum = pgEnum('side_conversation_status', [
  'open',
  'closed',
]);

export const kbVisibilityEnum = pgEnum('kb_visibility', [
  'public',
  'internal',
  'draft',
]);

export const kbGapStatusEnum = pgEnum('kb_gap_status', [
  'open',
  'accepted',
  'dismissed',
  'created',
]);

export const ssoProtocolEnum = pgEnum('sso_protocol', [
  'saml',
  'oidc',
]);

export const integrationStatusEnum = pgEnum('integration_status', [
  'planned',
  'active',
  'disabled',
  'error',
]);

export const jobStatusEnum = pgEnum('job_status', [
  'queued',
  'running',
  'success',
  'error',
]);

export const userRoleEnum = pgEnum('user_role', [
  'owner',
  'admin',
  'agent',
  'light_agent',
  'collaborator',
  'viewer',
  'system',
  'unknown',
]);

export const userStatusEnum = pgEnum('user_status', [
  'active',
  'inactive',
  'invited',
  'disabled',
]);

export const tenants = pgTable(
  'tenants',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    name: text('name').notNull(),
    plan: text('plan').notNull().default('byoc'),
    stripeCustomerId: text('stripe_customer_id'),
    stripeSubscriptionId: text('stripe_subscription_id'),
    stripeSubscriptionStatus: text('stripe_subscription_status'),
    currentPeriodEnd: timestamp('current_period_end', { withTimezone: true }),
    cancelAtPeriodEnd: boolean('cancel_at_period_end'),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  },
  table => ({
    tenantsNameIdx: uniqueIndex('tenants_name_idx').on(table.name),
    tenantsStripeCustomerIdx: uniqueIndex('tenants_stripe_customer_idx').on(table.stripeCustomerId),
  }),
);

export const workspaces = pgTable(
  'workspaces',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    tenantId: uuid('tenant_id').notNull().references(() => tenants.id),
    name: text('name').notNull(),
    timezone: text('timezone').notNull().default('UTC'),
    defaultInboxId: uuid('default_inbox_id'),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  },
  table => ({
    workspaceTenantNameIdx: uniqueIndex('workspaces_tenant_name_idx').on(
      table.tenantId,
      table.name,
    ),
  }),
);

export const users = pgTable(
  'users',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    tenantId: uuid('tenant_id').references(() => tenants.id),
    workspaceId: uuid('workspace_id').notNull().references(() => workspaces.id),
    email: varchar('email', { length: 320 }),
    passwordHash: text('password_hash'),
    name: text('name').notNull(),
    role: userRoleEnum('role').notNull().default('agent'),
    status: userStatusEnum('status').notNull().default('active'),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
  },
  table => ({
    usersWorkspaceEmailIdx: uniqueIndex('users_workspace_email_idx').on(
      table.workspaceId,
      table.email,
    ),
    usersTenantIdx: index('users_tenant_idx').on(table.tenantId),
  }),
);

export const organizations = pgTable(
  'organizations',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    workspaceId: uuid('workspace_id').notNull().references(() => workspaces.id),
    name: text('name').notNull(),
    domains: text('domains').array().notNull().default([]),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
  },
  table => ({
    organizationsWorkspaceNameIdx: uniqueIndex('orgs_workspace_name_idx').on(
      table.workspaceId,
      table.name,
    ),
  }),
);

export const customers = pgTable(
  'customers',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    workspaceId: uuid('workspace_id').notNull().references(() => workspaces.id),
    externalRef: text('external_ref'),
    name: text('name').notNull(),
    email: varchar('email', { length: 320 }),
    phone: text('phone'),
    orgId: uuid('org_id').references(() => organizations.id),
    // Customer 360 enrichment fields
    customAttributes: jsonb('custom_attributes').default({}),
    avatarUrl: text('avatar_url'),
    locale: text('locale'),
    timezone: text('timezone'),
    lastSeenAt: timestamp('last_seen_at', { withTimezone: true }),
    browser: text('browser'),
    os: text('os'),
    ipAddress: inet('ip_address'),
    signupDate: timestamp('signup_date', { withTimezone: true }),
    plan: text('plan'),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
  },
  table => ({
    customersWorkspaceEmailIdx: index('customers_workspace_email_idx').on(
      table.workspaceId,
      table.email,
    ),
  }),
);

export const groups = pgTable('groups', {
  id: uuid('id').defaultRandom().primaryKey(),
  workspaceId: uuid('workspace_id').notNull().references(() => workspaces.id),
  name: text('name').notNull(),
  defaultRole: text('default_role').default('agent'),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
});

export const inboxes = pgTable('inboxes', {
  id: uuid('id').defaultRandom().primaryKey(),
  workspaceId: uuid('workspace_id').notNull().references(() => workspaces.id),
  name: text('name').notNull(),
  channelType: channelTypeEnum('channel_type').notNull().default('email'),
  address: text('address'),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
});

export const ticketForms = pgTable(
  'ticket_forms',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    workspaceId: uuid('workspace_id').notNull().references(() => workspaces.id),
    name: text('name').notNull(),
    active: boolean('active').notNull().default(true),
    position: integer('position'),
    fieldIds: bigint('field_ids', { mode: 'number' }).array().notNull().default([]),
    raw: jsonb('raw'),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
  },
  table => ({
    ticketFormsWorkspaceNameIdx: uniqueIndex('ticket_forms_workspace_name_idx').on(
      table.workspaceId,
      table.name,
    ),
  }),
);

export const brands = pgTable(
  'brands',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    workspaceId: uuid('workspace_id').notNull().references(() => workspaces.id),
    name: text('name').notNull(),
    raw: jsonb('raw'),
    businessHoursId: uuid('business_hours_id').references(() => businessHours.id),
    subdomain: varchar('subdomain', { length: 63 }),
    logoUrl: text('logo_url'),
    faviconUrl: text('favicon_url'),
    primaryColor: varchar('primary_color', { length: 7 }).default('#000000'),
    accentColor: varchar('accent_color', { length: 7 }).default('#3b82f6'),
    headerHtml: text('header_html'),
    footerHtml: text('footer_html'),
    customCss: text('custom_css'),
    helpCenterEnabled: boolean('help_center_enabled').default(false),
    helpCenterTitle: text('help_center_title'),
    defaultLocale: varchar('default_locale', { length: 10 }).default('en'),
    supportedLocales: text('supported_locales').array().default(['en']),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
  },
  table => ({
    brandsWorkspaceNameIdx: uniqueIndex('brands_workspace_name_idx').on(
      table.workspaceId,
      table.name,
    ),
    brandsSubdomainIdx: uniqueIndex('brands_subdomain_idx').on(table.subdomain),
  }),
);

export const tickets = pgTable(
  'tickets',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    tenantId: uuid('tenant_id').references(() => tenants.id),
    workspaceId: uuid('workspace_id').notNull().references(() => workspaces.id),
    requesterId: uuid('requester_id').references(() => customers.id),
    assigneeId: uuid('assignee_id').references(() => users.id),
    groupId: uuid('group_id').references(() => groups.id),
    brandId: uuid('brand_id').references(() => brands.id),
    ticketFormId: uuid('ticket_form_id').references(() => ticketForms.id),
    inboxId: uuid('inbox_id').references(() => inboxes.id),
    subject: text('subject').notNull(),
    description: text('description'),
    customerEmail: varchar('customer_email', { length: 320 }),
    status: ticketStatusEnum('status').notNull().default('open'),
    priority: ticketPriorityEnum('priority').notNull().default('normal'),
    source: providerEnum('source').default('zendesk'),
    tags: text('tags').array().default([]),
    customFields: jsonb('custom_fields'),
    hasPii: boolean('has_pii').default(false),
    piiScannedAt: timestamp('pii_scanned_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
    closedAt: timestamp('closed_at', { withTimezone: true }),
    mergedIntoTicketId: uuid('merged_into_ticket_id'),
    splitFromTicketId: uuid('split_from_ticket_id'),
  },
  table => ({
    ticketsWorkspaceStatusIdx: index('tickets_workspace_status_idx').on(
      table.workspaceId,
      table.status,
    ),
    ticketsTenantIdx: index('tickets_tenant_idx').on(table.tenantId),
    ticketsCustomerEmailIdx: index('tickets_customer_email_idx').on(
      table.workspaceId,
      table.customerEmail,
    ),
    ticketsMergedIntoIdx: index('tickets_merged_into_idx').on(table.mergedIntoTicketId),
    ticketsSplitFromIdx: index('tickets_split_from_idx').on(table.splitFromTicketId),
  }),
);

export const conversations = pgTable(
  'conversations',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    ticketId: uuid('ticket_id').notNull().references(() => tickets.id),
    workspaceId: uuid('workspace_id').references(() => workspaces.id),
    channelType: channelTypeEnum('channel_type').notNull().default('email'),
    kind: conversationKindEnum('kind').notNull().default('primary'),
    subject: text('subject'),
    externalEmail: varchar('external_email', { length: 320 }),
    createdById: uuid('created_by_id').references(() => users.id),
    status: sideConversationStatusEnum('status').notNull().default('open'),
    startedAt: timestamp('started_at', { withTimezone: true }).defaultNow().notNull(),
    lastActivityAt: timestamp('last_activity_at', { withTimezone: true }).defaultNow().notNull(),
  },
  table => ({
    conversationsTicketIdx: index('conversations_ticket_idx').on(table.ticketId),
    conversationsWorkspaceIdx: index('conversations_workspace_idx').on(table.workspaceId),
    conversationsKindIdx: index('conversations_kind_idx').on(table.ticketId, table.kind),
  }),
);

export const messages = pgTable(
  'messages',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    conversationId: uuid('conversation_id').notNull().references(() => conversations.id),
    workspaceId: uuid('workspace_id').references(() => workspaces.id),
    authorType: messageAuthorEnum('author_type').notNull().default('customer'),
    authorId: uuid('author_id'),
    body: text('body').notNull(),
    bodyHtml: text('body_html'),
    bodyRedacted: text('body_redacted'),
    hasPii: boolean('has_pii').default(false),
    piiScannedAt: timestamp('pii_scanned_at', { withTimezone: true }),
    visibility: messageVisibilityEnum('visibility').notNull().default('public'),
    mentionedUserIds: uuid('mentioned_user_ids').array(),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  },
  table => ({
    messagesConversationIdx: index('messages_conversation_idx').on(
      table.conversationId,
      table.createdAt,
    ),
    messagesWorkspaceIdx: index('messages_workspace_idx').on(table.workspaceId),
  }),
);

export const attachments = pgTable(
  'attachments',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    messageId: uuid('message_id').notNull().references(() => messages.id),
    workspaceId: uuid('workspace_id').references(() => workspaces.id),
    filename: text('filename').notNull(),
    size: integer('size').notNull().default(0),
    contentType: text('content_type'),
    storageKey: text('storage_key'),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  },
  table => ({
    attachmentsWorkspaceIdx: index('attachments_workspace_idx').on(table.workspaceId),
  }),
);

export const notifications = pgTable(
  'notifications',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    workspaceId: uuid('workspace_id').references(() => workspaces.id),
    userId: uuid('user_id').notNull().references(() => users.id),
    type: notificationTypeEnum('type').notNull(),
    title: text('title').notNull(),
    body: text('body'),
    resourceType: text('resource_type'),
    resourceId: uuid('resource_id'),
    readAt: timestamp('read_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  },
  table => ({
    notificationsUserUnreadIdx: index('notifications_user_unread_idx').on(table.userId, table.createdAt),
    notificationsWorkspaceIdx: index('notifications_workspace_idx').on(table.workspaceId),
  }),
);

export const mentions = pgTable(
  'mentions',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    messageId: uuid('message_id').notNull().references(() => messages.id),
    mentionedUserId: uuid('mentioned_user_id').notNull().references(() => users.id),
    workspaceId: uuid('workspace_id').references(() => workspaces.id),
    readAt: timestamp('read_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  },
  table => ({
    mentionsMessageIdx: index('mentions_message_idx').on(table.messageId),
    mentionsUserUnreadIdx: index('mentions_user_unread_idx').on(table.mentionedUserId, table.createdAt),
  }),
);

export const tags = pgTable(
  'tags',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    workspaceId: uuid('workspace_id').notNull().references(() => workspaces.id),
    name: text('name').notNull(),
    color: text('color').default('#71717a'),
    description: text('description'),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  },
  table => ({
    tagsWorkspaceNameIdx: uniqueIndex('tags_workspace_name_idx').on(
      table.workspaceId,
      table.name,
    ),
  }),
);

export const ticketTags = pgTable(
  'ticket_tags',
  {
    ticketId: uuid('ticket_id').notNull().references(() => tickets.id),
    tagId: uuid('tag_id').notNull().references(() => tags.id),
    workspaceId: uuid('workspace_id').references(() => workspaces.id),
  },
  table => ({
    pk: primaryKey({ columns: [table.ticketId, table.tagId] }),
    ticketTagsWorkspaceIdx: index('ticket_tags_workspace_idx').on(table.workspaceId),
  }),
);

export const customFields = pgTable('custom_fields', {
  id: uuid('id').defaultRandom().primaryKey(),
  workspaceId: uuid('workspace_id').notNull().references(() => workspaces.id),
  objectType: text('object_type').notNull(),
  name: text('name').notNull(),
  fieldType: text('field_type').notNull(),
  options: jsonb('options'),
  required: boolean('required').notNull().default(false),
  encrypted: boolean('encrypted').notNull().default(false),
  piiCategory: text('pii_category'),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
});

export const customFieldValues = pgTable(
  'custom_field_values',
  {
    objectType: text('object_type').notNull(),
    objectId: uuid('object_id').notNull(),
    fieldId: uuid('field_id').notNull().references(() => customFields.id),
    workspaceId: uuid('workspace_id').references(() => workspaces.id),
    value: jsonb('value'),
  },
  table => ({
    pk: primaryKey({ columns: [table.objectType, table.objectId, table.fieldId] }),
    customFieldValuesWorkspaceIdx: index('custom_field_values_workspace_idx').on(table.workspaceId),
  }),
);

export const rules = pgTable('rules', {
  id: uuid('id').defaultRandom().primaryKey(),
  workspaceId: uuid('workspace_id').notNull().references(() => workspaces.id),
  type: ruleTypeEnum('type').notNull(),
  name: text('name').notNull(),
  description: text('description'),
  enabled: boolean('enabled').notNull().default(true),
  conditions: jsonb('conditions'),
  actions: jsonb('actions'),
  source: providerEnum('source').default('zendesk'),
  version: integer('version').notNull().default(1),
  executionOrder: integer('execution_order').notNull().default(0),
  lastExecutedAt: timestamp('last_executed_at', { withTimezone: true }),
  executionCount: integer('execution_count').notNull().default(0),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
});

export const ruleExecutions = pgTable(
  'rule_executions',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    workspaceId: uuid('workspace_id').notNull().references(() => workspaces.id),
    ruleId: text('rule_id').notNull(),
    ruleName: text('rule_name').notNull(),
    ruleType: ruleTypeEnum('rule_type').notNull(),
    ticketId: text('ticket_id').notNull(),
    event: text('event').notNull(),
    matched: boolean('matched').notNull(),
    dryRun: boolean('dry_run').notNull().default(false),
    actionsExecuted: integer('actions_executed').notNull().default(0),
    changes: jsonb('changes'),
    errors: jsonb('errors'),
    notificationsSent: integer('notifications_sent').default(0),
    webhooksFired: integer('webhooks_fired').default(0),
    durationMs: integer('duration_ms'),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  },
  table => ({
    ruleExecWorkspaceIdx: index('rule_executions_workspace_idx').on(table.workspaceId, table.createdAt),
    ruleExecRuleIdx: index('rule_executions_rule_idx').on(table.ruleId),
    ruleExecTicketIdx: index('rule_executions_ticket_idx').on(table.ticketId),
  }),
);

export const slaPolicies = pgTable('sla_policies', {
  id: uuid('id').defaultRandom().primaryKey(),
  workspaceId: uuid('workspace_id').notNull().references(() => workspaces.id),
  name: text('name').notNull(),
  priority: ticketPriorityEnum('priority'),
  responseTime: integer('response_time'),
  resolutionTime: integer('resolution_time'),
  enabled: boolean('enabled').notNull().default(true),
  targets: jsonb('targets'),
  schedules: jsonb('schedules'),
  businessHoursId: uuid('business_hours_id').references(() => businessHours.id),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
});

export const slaEvents = pgTable(
  'sla_events',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    ticketId: uuid('ticket_id').notNull().references(() => tickets.id),
    policyId: uuid('policy_id').notNull().references(() => slaPolicies.id),
    workspaceId: uuid('workspace_id').references(() => workspaces.id),
    metric: text('metric').notNull(),
    dueAt: timestamp('due_at', { withTimezone: true }).notNull(),
    breachedAt: timestamp('breached_at', { withTimezone: true }),
  },
  table => ({
    slaEventsWorkspaceIdx: index('sla_events_workspace_idx').on(table.workspaceId),
  }),
);

export const views = pgTable('views', {
  id: uuid('id').defaultRandom().primaryKey(),
  workspaceId: uuid('workspace_id').notNull().references(() => workspaces.id),
  userId: uuid('user_id').references(() => users.id),
  name: text('name').notNull(),
  description: text('description'),
  query: jsonb('query').notNull(),
  viewType: text('view_type').notNull().default('shared'),
  active: boolean('active').notNull().default(true),
  position: integer('position').notNull().default(0),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
});

export const csatRatings = pgTable(
  'csat_ratings',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    ticketId: uuid('ticket_id').notNull().references(() => tickets.id),
    workspaceId: uuid('workspace_id').references(() => workspaces.id),
    rating: integer('rating').notNull(),
    comment: text('comment'),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  },
  table => ({
    csatRatingsWorkspaceIdx: index('csat_ratings_workspace_idx').on(table.workspaceId),
  }),
);

export const timeEntries = pgTable(
  'time_entries',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    ticketId: uuid('ticket_id').notNull().references(() => tickets.id),
    workspaceId: uuid('workspace_id').references(() => workspaces.id),
    userId: uuid('user_id').references(() => users.id),
    minutes: integer('minutes').notNull().default(0),
    note: text('note'),
    billable: boolean('billable').default(true),
    customerId: uuid('customer_id').references(() => customers.id),
    groupId: uuid('group_id').references(() => groups.id),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  },
  table => ({
    timeEntriesWorkspaceIdx: index('time_entries_workspace_idx').on(table.workspaceId),
  }),
);

export const kbCollections = pgTable('kb_collections', {
  id: uuid('id').defaultRandom().primaryKey(),
  workspaceId: uuid('workspace_id').notNull().references(() => workspaces.id),
  name: text('name').notNull(),
  brandId: uuid('brand_id').references(() => brands.id),
  description: text('description'),
  locale: varchar('locale', { length: 10 }).default('en'),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
});

export const kbCategories = pgTable(
  'kb_categories',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    collectionId: uuid('collection_id').references(() => kbCollections.id),
    workspaceId: uuid('workspace_id').references(() => workspaces.id),
    name: text('name').notNull(),
    parentId: uuid('parent_id'),
    locale: varchar('locale', { length: 10 }).default('en'),
    brandId: uuid('brand_id').references(() => brands.id),
    slug: varchar('slug', { length: 255 }),
    description: text('description'),
    position: integer('position').default(0),
    icon: text('icon'),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  },
  table => ({
    kbCategoriesWorkspaceIdx: index('kb_categories_workspace_idx').on(table.workspaceId),
  }),
);

export const kbArticles = pgTable(
  'kb_articles',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    workspaceId: uuid('workspace_id').notNull().references(() => workspaces.id),
    collectionId: uuid('collection_id').references(() => kbCollections.id),
    categoryId: uuid('category_id').references(() => kbCategories.id),
    categoryPath: text('category_path').array(),
    title: text('title').notNull(),
    body: text('body').notNull(),
    status: text('status').notNull().default('published'),
    authorId: uuid('author_id').references(() => users.id),
    source: providerEnum('source').default('zendesk'),
    locale: varchar('locale', { length: 10 }).default('en'),
    parentArticleId: uuid('parent_article_id'),
    brandId: uuid('brand_id').references(() => brands.id),
    visibility: varchar('visibility', { length: 10 }).default('public'),
    slug: varchar('slug', { length: 255 }),
    metaTitle: text('meta_title'),
    metaDescription: text('meta_description'),
    seoKeywords: text('seo_keywords').array(),
    position: integer('position').default(0),
    helpfulCount: integer('helpful_count').default(0),
    notHelpfulCount: integer('not_helpful_count').default(0),
    viewCount: integer('view_count').default(0),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
  },
  table => ({
    kbArticlesLocaleIdx: index('kb_articles_locale_idx').on(table.locale),
    kbArticlesParentIdx: index('kb_articles_parent_idx').on(table.parentArticleId),
    kbArticlesBrandIdx: index('kb_articles_brand_idx').on(table.brandId),
    kbArticlesSlugIdx: index('kb_articles_slug_idx').on(table.workspaceId, table.slug),
    kbArticlesTranslationUniqueIdx: uniqueIndex('kb_articles_translation_unique_idx')
      .on(table.parentArticleId, table.locale),
  }),
);

export const kbRevisions = pgTable(
  'kb_revisions',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    articleId: uuid('article_id').notNull().references(() => kbArticles.id),
    workspaceId: uuid('workspace_id').references(() => workspaces.id),
    body: text('body').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  },
  table => ({
    kbRevisionsWorkspaceIdx: index('kb_revisions_workspace_idx').on(table.workspaceId),
  }),
);

export const integrations = pgTable(
  'integrations',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    workspaceId: uuid('workspace_id').notNull().references(() => workspaces.id),
    provider: providerEnum('provider').notNull(),
    status: integrationStatusEnum('status').notNull().default('active'),
    credentialsRef: text('credentials_ref'),
    metadata: jsonb('metadata'),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
  },
  table => ({
    integrationsWorkspaceProviderIdx: uniqueIndex('integrations_workspace_provider_idx').on(
      table.workspaceId,
      table.provider,
    ),
  }),
);

export const externalObjects = pgTable(
  'external_objects',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    integrationId: uuid('integration_id').notNull().references(() => integrations.id),
    workspaceId: uuid('workspace_id').references(() => workspaces.id),
    objectType: text('object_type').notNull(),
    externalId: text('external_id').notNull(),
    internalId: uuid('internal_id').notNull(),
    checksum: text('checksum'),
    lastSeenAt: timestamp('last_seen_at', { withTimezone: true }).defaultNow().notNull(),
  },
  table => ({
    externalObjectsUniqueIdx: uniqueIndex('external_objects_unique_idx').on(
      table.integrationId,
      table.objectType,
      table.externalId,
    ),
    externalObjectsWorkspaceIdx: index('external_objects_workspace_idx').on(table.workspaceId),
  }),
);

export const syncCursors = pgTable(
  'sync_cursors',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    integrationId: uuid('integration_id').notNull().references(() => integrations.id),
    workspaceId: uuid('workspace_id').references(() => workspaces.id),
    objectType: text('object_type').notNull(),
    cursor: text('cursor').notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
  },
  table => ({
    syncCursorsUniqueIdx: uniqueIndex('sync_cursors_unique_idx').on(
      table.integrationId,
      table.objectType,
    ),
    syncCursorsWorkspaceIdx: index('sync_cursors_workspace_idx').on(table.workspaceId),
  }),
);

export const importJobs = pgTable(
  'import_jobs',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    integrationId: uuid('integration_id').notNull().references(() => integrations.id),
    workspaceId: uuid('workspace_id').references(() => workspaces.id),
    status: jobStatusEnum('status').notNull().default('queued'),
    startedAt: timestamp('started_at', { withTimezone: true }),
    finishedAt: timestamp('finished_at', { withTimezone: true }),
    error: text('error'),
  },
  table => ({
    importJobsWorkspaceIdx: index('import_jobs_workspace_idx').on(table.workspaceId),
  }),
);

export const exportJobs = pgTable(
  'export_jobs',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    integrationId: uuid('integration_id').notNull().references(() => integrations.id),
    workspaceId: uuid('workspace_id').references(() => workspaces.id),
    status: jobStatusEnum('status').notNull().default('queued'),
    startedAt: timestamp('started_at', { withTimezone: true }),
    finishedAt: timestamp('finished_at', { withTimezone: true }),
    error: text('error'),
  },
  table => ({
    exportJobsWorkspaceIdx: index('export_jobs_workspace_idx').on(table.workspaceId),
  }),
);

export const rawRecords = pgTable(
  'raw_records',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    integrationId: uuid('integration_id').notNull().references(() => integrations.id),
    workspaceId: uuid('workspace_id').references(() => workspaces.id),
    objectType: text('object_type').notNull(),
    externalId: text('external_id'),
    payload: jsonb('payload').notNull(),
    receivedAt: timestamp('received_at', { withTimezone: true }).defaultNow().notNull(),
  },
  table => ({
    rawRecordsUniqueIdx: uniqueIndex('raw_records_unique_idx').on(
      table.integrationId,
      table.objectType,
      table.externalId,
    ),
    rawRecordsWorkspaceIdx: index('raw_records_workspace_idx').on(table.workspaceId),
  }),
);

export const auditEvents = pgTable(
  'audit_events',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    workspaceId: uuid('workspace_id').notNull().references(() => workspaces.id),
    actorType: text('actor_type').notNull(),
    actorId: uuid('actor_id'),
    action: text('action').notNull(),
    objectType: text('object_type').notNull(),
    objectId: uuid('object_id'),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    diff: jsonb('diff'),
  },
  table => ({
    auditEventsWorkspaceIdx: index('audit_events_workspace_idx').on(
      table.workspaceId,
      table.createdAt,
    ),
  }),
);

// ---- SSO Providers ----

export const ssoProviders = pgTable(
  'sso_providers',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    workspaceId: uuid('workspace_id').notNull().references(() => workspaces.id),
    name: text('name').notNull(),
    protocol: ssoProtocolEnum('protocol').notNull(),
    enabled: boolean('enabled').notNull().default(true),
    // SAML fields
    entityId: text('entity_id'),
    ssoUrl: text('sso_url'),
    certificate: text('certificate'),
    // OIDC fields
    clientId: text('client_id'),
    clientSecret: text('client_secret'),
    issuer: text('issuer'),
    authorizationUrl: text('authorization_url'),
    tokenUrl: text('token_url'),
    userInfoUrl: text('user_info_url'),
    // Common
    domainHint: text('domain_hint'),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
  },
  table => ({
    ssoProvidersDomainIdx: index('sso_providers_domain_idx').on(
      table.workspaceId,
      table.domainHint,
    ),
    ssoProvidersWorkspaceIdx: index('sso_providers_workspace_idx').on(
      table.workspaceId,
    ),
  }),
);

// ---- Audit Entries (user-facing audit log) ----

export const auditEntries = pgTable(
  'audit_entries',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    workspaceId: uuid('workspace_id').references(() => workspaces.id),
    timestamp: timestamp('timestamp', { withTimezone: true }).defaultNow().notNull(),
    userId: text('user_id').notNull(),
    userName: text('user_name').notNull(),
    action: text('action').notNull(),
    resource: text('resource').notNull(),
    resourceId: text('resource_id').notNull(),
    details: jsonb('details'),
    ipAddress: inet('ip_address'),
  },
  table => ({
    auditEntriesTimestampIdx: index('audit_entries_timestamp_idx').on(
      table.timestamp,
    ),
    auditEntriesUserIdx: index('audit_entries_user_idx').on(
      table.userId,
    ),
    auditEntriesActionIdx: index('audit_entries_action_idx').on(
      table.action,
    ),
    auditEntriesResourceIdx: index('audit_entries_resource_idx').on(
      table.resource,
      table.resourceId,
    ),
    auditEntriesWorkspaceIdx: index('audit_entries_workspace_idx').on(
      table.workspaceId,
      table.timestamp,
    ),
  }),
);

// ---- Automation Rules (legacy duplicate removed — use `rules` table) ----

// ---- RAG (Retrieval-Augmented Generation) ----

const vector = customType<{ data: number[]; driverParam: string }>({
  dataType() {
    return 'vector(1536)';
  },
  toDriver(value: number[]): string {
    return `[${value.join(',')}]`;
  },
  fromDriver(value: unknown): number[] {
    return String(value)
      .replace(/^\[|\]$/g, '')
      .split(',')
      .map(Number);
  },
});

export const ragChunkSourceEnum = pgEnum('rag_chunk_source', [
  'kb_article',
  'ticket_thread',
  'external_file',
]);

export const ragJobStatusEnum = pgEnum('rag_job_status', [
  'running',
  'success',
  'error',
]);

export const ragChunks = pgTable(
  'rag_chunks',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    workspaceId: uuid('workspace_id').notNull(), // No FK — RAG DB may be separate
    sourceType: ragChunkSourceEnum('source_type').notNull(),
    sourceId: text('source_id').notNull(),
    sourceTitle: text('source_title').notNull(),
    chunkIndex: integer('chunk_index').notNull(),
    content: text('content').notNull(),
    tokenCount: integer('token_count').notNull(),
    contentHash: varchar('content_hash', { length: 64 }).notNull(),
    metadata: jsonb('metadata').notNull().default({}),
    embedding: vector('embedding'),
    locale: varchar('locale', { length: 10 }).default('en'),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
  },
  table => ({
    ragChunksLocaleIdx: index('rag_chunks_locale_idx').on(table.locale),
    ragChunksWorkspaceSourceIdx: index('rag_chunks_workspace_source_idx').on(
      table.workspaceId,
      table.sourceType,
      table.sourceId,
    ),
    ragChunksDedup: uniqueIndex('rag_chunks_dedup_idx').on(
      table.workspaceId,
      table.sourceId,
      table.chunkIndex,
    ),
  }),
);

export const ragImportJobs = pgTable('rag_import_jobs', {
  id: uuid('id').defaultRandom().primaryKey(),
  workspaceId: uuid('workspace_id').notNull(), // No FK — RAG DB may be separate
  sourceType: ragChunkSourceEnum('source_type').notNull(),
  status: ragJobStatusEnum('status').notNull().default('running'),
  totalSources: integer('total_sources').notNull().default(0),
  totalChunks: integer('total_chunks').notNull().default(0),
  newChunks: integer('new_chunks').notNull().default(0),
  skippedChunks: integer('skipped_chunks').notNull().default(0),
  error: text('error'),
  startedAt: timestamp('started_at', { withTimezone: true }).defaultNow().notNull(),
  finishedAt: timestamp('finished_at', { withTimezone: true }),
});

// ---- API Keys ----

export const apiKeys = pgTable(
  'api_keys',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    workspaceId: uuid('workspace_id').notNull().references(() => workspaces.id),
    name: text('name').notNull(),
    keyHash: varchar('key_hash', { length: 64 }).notNull(),
    prefix: varchar('prefix', { length: 12 }).notNull(),
    scopes: text('scopes').array().notNull().default([]),
    lastUsedAt: timestamp('last_used_at', { withTimezone: true }),
    expiresAt: timestamp('expires_at', { withTimezone: true }),
    createdBy: uuid('created_by').notNull().references(() => users.id),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    revokedAt: timestamp('revoked_at', { withTimezone: true }),
  },
  table => ({
    apiKeysWorkspaceIdx: index('api_keys_workspace_idx').on(table.workspaceId),
    apiKeysHashIdx: uniqueIndex('api_keys_hash_idx').on(table.keyHash),
    apiKeysPrefixIdx: index('api_keys_prefix_idx').on(table.prefix),
  }),
);

// ---- User MFA (TOTP) ----

export const userMfa = pgTable(
  'user_mfa',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    userId: uuid('user_id').notNull().references(() => users.id),
    totpSecret: text('totp_secret').notNull(),
    backupCodes: jsonb('backup_codes').notNull(),
    enabledAt: timestamp('enabled_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  },
  table => ({
    userMfaUserIdx: uniqueIndex('user_mfa_user_idx').on(table.userId),
  }),
);

// ---- Billing: Usage Metrics ----

export const usageMetrics = pgTable(
  'usage_metrics',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    tenantId: uuid('tenant_id').notNull().references(() => tenants.id),
    period: text('period').notNull(), // 'YYYY-MM'
    ticketsCreated: integer('tickets_created').notNull().default(0),
    aiCallsMade: integer('ai_calls_made').notNull().default(0),
    apiRequestsMade: integer('api_requests_made').notNull().default(0),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
  },
  table => ({
    usageMetricsTenantPeriodIdx: uniqueIndex('usage_metrics_tenant_period_idx').on(
      table.tenantId,
      table.period,
    ),
  }),
);

// ---- Billing: Events ----

export const billingEvents = pgTable(
  'billing_events',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    tenantId: uuid('tenant_id').references(() => tenants.id),
    eventType: text('event_type').notNull(),
    stripeEventId: text('stripe_event_id'),
    payload: jsonb('payload'),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  },
  table => ({
    billingEventsStripeIdx: uniqueIndex('billing_events_stripe_idx').on(table.stripeEventId),
  }),
);

// ---- Hybrid Sync Outbox ----

export const syncOutboxOperationEnum = pgEnum('sync_outbox_operation', [
  'create',
  'update',
]);

export const syncOutboxEntityTypeEnum = pgEnum('sync_outbox_entity_type', [
  'ticket',
  'message',
  'kb_article',
]);

export const syncOutboxStatusEnum = pgEnum('sync_outbox_status', [
  'pending_push',
  'pushed',
  'conflict',
  'failed',
]);

export const syncOutbox = pgTable(
  'sync_outbox',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    workspaceId: uuid('workspace_id').notNull().references(() => workspaces.id),
    operation: syncOutboxOperationEnum('operation').notNull(),
    entityType: syncOutboxEntityTypeEnum('entity_type').notNull(),
    entityId: text('entity_id').notNull(),
    payload: jsonb('payload').notNull(),
    status: syncOutboxStatusEnum('status').notNull().default('pending_push'),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    pushedAt: timestamp('pushed_at', { withTimezone: true }),
    error: text('error'),
  },
  table => ({
    syncOutboxStatusIdx: index('sync_outbox_status_idx').on(
      table.workspaceId,
      table.status,
    ),
    syncOutboxEntityIdx: index('sync_outbox_entity_idx').on(
      table.entityType,
      table.entityId,
    ),
  }),
);

// ---- Sync Conflicts ----

export const syncConflicts = pgTable(
  'sync_conflicts',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    workspaceId: uuid('workspace_id').notNull().references(() => workspaces.id),
    entityType: syncOutboxEntityTypeEnum('entity_type').notNull(),
    entityId: text('entity_id').notNull(),
    localVersion: jsonb('local_version').notNull(),
    hostedVersion: jsonb('hosted_version').notNull(),
    localUpdatedAt: timestamp('local_updated_at', { withTimezone: true }).notNull(),
    hostedUpdatedAt: timestamp('hosted_updated_at', { withTimezone: true }).notNull(),
    resolvedAt: timestamp('resolved_at', { withTimezone: true }),
    resolution: text('resolution'), // 'local' | 'hosted' | null
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  },
  table => ({
    syncConflictsUnresolvedIdx: index('sync_conflicts_unresolved_idx').on(
      table.workspaceId,
      table.resolvedAt,
    ),
    syncConflictsEntityIdx: index('sync_conflicts_entity_idx').on(
      table.entityType,
      table.entityId,
    ),
  }),
);

// ---- Survey System (CSAT/NPS/CES) ----

export const surveyTypeEnum = pgEnum('survey_type', ['csat', 'nps', 'ces']);

export const surveyTriggerEnum = pgEnum('survey_trigger', [
  'ticket_solved',
  'ticket_closed',
  'manual',
]);

export const surveyResponses = pgTable(
  'survey_responses',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    workspaceId: uuid('workspace_id').notNull().references(() => workspaces.id),
    ticketId: uuid('ticket_id').references(() => tickets.id),
    customerId: uuid('customer_id').references(() => customers.id),
    surveyType: surveyTypeEnum('survey_type').notNull(),
    rating: integer('rating'),
    comment: text('comment'),
    token: varchar('token', { length: 64 }).unique(),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  },
  table => ({
    surveyResponsesWorkspaceIdx: index('survey_responses_workspace_idx').on(
      table.workspaceId,
      table.surveyType,
    ),
    surveyResponsesTicketIdx: index('survey_responses_ticket_idx').on(table.ticketId),
    surveyResponsesTokenIdx: uniqueIndex('survey_responses_token_idx').on(table.token),
  }),
);

export const surveyConfigs = pgTable(
  'survey_configs',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    workspaceId: uuid('workspace_id').notNull().references(() => workspaces.id),
    surveyType: surveyTypeEnum('survey_type').notNull(),
    enabled: boolean('enabled').notNull().default(false),
    trigger: surveyTriggerEnum('trigger').notNull().default('ticket_solved'),
    delayMinutes: integer('delay_minutes').notNull().default(0),
    question: text('question'),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
  },
  table => ({
    surveyConfigsUniqueIdx: uniqueIndex('survey_configs_workspace_type_idx').on(
      table.workspaceId,
      table.surveyType,
    ),
  }),
);

// ---- Customer-Facing Ticket Events (timeline) ----

export const ticketEventTypeEnum = pgEnum('ticket_event_type', [
  'opened',
  'status_changed',
  'closed',
  'reopened',
  'replied',
]);

export const ticketEventActorEnum = pgEnum('ticket_event_actor', [
  'customer',
  'agent',
  'system',
]);

export const ticketEvents = pgTable(
  'ticket_events',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    ticketId: uuid('ticket_id').notNull().references(() => tickets.id, { onDelete: 'cascade' }),
    workspaceId: uuid('workspace_id').references(() => workspaces.id),
    eventType: ticketEventTypeEnum('event_type').notNull(),
    fromStatus: text('from_status'),
    toStatus: text('to_status'),
    actorType: ticketEventActorEnum('actor_type').notNull().default('system'),
    actorLabel: text('actor_label'),
    note: text('note'),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  },
  table => ({
    ticketEventsTicketIdx: index('ticket_events_ticket_idx').on(
      table.ticketId,
      table.createdAt,
    ),
  }),
);

// ---- Chatbot Flows ----

export const chatbots = pgTable(
  'chatbots',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    workspaceId: uuid('workspace_id').notNull().references(() => workspaces.id),
    name: text('name').notNull(),
    flow: jsonb('flow').notNull(), // serialized ChatbotFlow node map + rootNodeId
    enabled: boolean('enabled').notNull().default(false),
    greeting: text('greeting'),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
  },
  table => ({
    chatbotsWorkspaceEnabledIdx: index('chatbots_workspace_enabled_idx').on(
      table.workspaceId,
      table.enabled,
    ),
  }),
);

// ---- Workflows (visual blueprint builder) ----

export const workflows = pgTable(
  'workflows',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    workspaceId: uuid('workspace_id').notNull().references(() => workspaces.id),
    name: text('name').notNull(),
    description: text('description'),
    flow: jsonb('flow').notNull(), // serialized { nodes, transitions, entryNodeId }
    enabled: boolean('enabled').notNull().default(false),
    version: integer('version').notNull().default(1),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
  },
  table => ({
    workflowsWorkspaceEnabledIdx: index('workflows_workspace_enabled_idx').on(
      table.workspaceId,
      table.enabled,
    ),
  }),
);

// ---- GDPR Deletion Requests ----

export const gdprDeletionRequests = pgTable(
  'gdpr_deletion_requests',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    workspaceId: uuid('workspace_id').notNull().references(() => workspaces.id),
    requestedBy: uuid('requested_by').notNull().references(() => users.id),
    subjectEmail: varchar('subject_email', { length: 320 }).notNull(),
    status: text('status').notNull().default('pending'), // pending, completed, failed
    recordsAffected: jsonb('records_affected'),
    requestedAt: timestamp('requested_at', { withTimezone: true }).defaultNow().notNull(),
    completedAt: timestamp('completed_at', { withTimezone: true }),
  },
  table => ({
    gdprDeletionWorkspaceIdx: index('gdpr_deletion_workspace_idx').on(
      table.workspaceId,
      table.requestedAt,
    ),
  }),
);

// ---- Upstream Outbox (push changes back to source platforms) ----

export const upstreamOperationEnum = pgEnum('upstream_operation', [
  'create_ticket',
  'update_ticket',
  'create_reply',
  'create_note',
]);

export const upstreamStatusEnum = pgEnum('upstream_status', [
  'pending',
  'pushed',
  'failed',
  'skipped',
]);

export const upstreamOutbox = pgTable(
  'upstream_outbox',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    workspaceId: uuid('workspace_id').notNull().references(() => workspaces.id),
    connector: text('connector').notNull(),
    operation: upstreamOperationEnum('operation').notNull(),
    ticketId: text('ticket_id').notNull(),
    externalId: text('external_id'),
    payload: jsonb('payload').notNull(),
    status: upstreamStatusEnum('status').notNull().default('pending'),
    externalResult: jsonb('external_result'),
    pushedAt: timestamp('pushed_at', { withTimezone: true }),
    error: text('error'),
    retryCount: integer('retry_count').notNull().default(0),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  },
  table => ({
    upstreamOutboxStatusIdx: index('upstream_outbox_status_idx').on(
      table.connector,
      table.status,
    ),
    upstreamOutboxTicketIdx: index('upstream_outbox_ticket_idx').on(
      table.ticketId,
    ),
    upstreamOutboxDedupIdx: uniqueIndex('upstream_outbox_dedup_idx')
      .on(table.workspaceId, table.connector, table.operation, table.ticketId)
      .where(sql`status = 'pending' AND operation IN ('create_ticket', 'update_ticket')`),
  }),
);

// ---- Retention Policies ----

export const retentionPolicies = pgTable(
  'retention_policies',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    workspaceId: uuid('workspace_id').notNull().references(() => workspaces.id),
    resource: text('resource').notNull(),
    retentionDays: integer('retention_days').notNull(),
    action: text('action').notNull().default('delete'), // delete, archive
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  },
  table => ({
    retentionPoliciesWsResourceIdx: uniqueIndex('retention_policies_ws_resource').on(
      table.workspaceId,
      table.resource,
    ),
  }),
);

// ---- Sprint Feature Enums ----

export const forumThreadStatusEnum = pgEnum('forum_thread_status', ['open', 'closed', 'pinned']);
export const qaReviewStatusEnum = pgEnum('qa_review_status', ['pending', 'in_progress', 'completed']);
export const campaignStatusEnum = pgEnum('campaign_status', ['draft', 'scheduled', 'sending', 'sent', 'cancelled', 'active', 'paused', 'completed']);
export const campaignChannelEnum = pgEnum('campaign_channel', ['email', 'sms', 'whatsapp', 'in_app', 'push']);
export const campaignStepTypeEnum = pgEnum('campaign_step_type', ['send_email', 'send_sms', 'send_in_app', 'send_push', 'wait_delay', 'wait_event', 'condition', 'branch', 'update_tag', 'webhook']);
export const campaignStepStatusEnum = pgEnum('campaign_step_status', ['pending', 'active', 'completed', 'skipped', 'failed']);
export const inAppMessageTypeEnum = pgEnum('in_app_message_type', ['banner', 'modal', 'tooltip', 'slide_in']);
export const tourStepPositionEnum = pgEnum('tour_step_position', ['top', 'bottom', 'left', 'right', 'center']);
export const customerNoteTypeEnum = pgEnum('customer_note_type', ['note', 'call_log', 'meeting']);

// ---- Customer 360 Tables ----

export const customerActivities = pgTable(
  'customer_activities',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    workspaceId: uuid('workspace_id').notNull().references(() => workspaces.id),
    customerId: uuid('customer_id').notNull().references(() => customers.id),
    activityType: text('activity_type').notNull(),
    entityType: text('entity_type'),
    entityId: text('entity_id'),
    metadata: jsonb('metadata').default({}),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  },
  table => ({
    customerActivitiesWsCustIdx: index('customer_activities_ws_cust_idx').on(table.workspaceId, table.customerId),
  }),
);

export const customerNotes = pgTable(
  'customer_notes',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    workspaceId: uuid('workspace_id').notNull().references(() => workspaces.id),
    customerId: uuid('customer_id').notNull().references(() => customers.id),
    authorId: uuid('author_id').references(() => users.id),
    noteType: customerNoteTypeEnum('note_type').notNull().default('note'),
    body: text('body').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
  },
  table => ({
    customerNotesWsCustIdx: index('customer_notes_ws_cust_idx').on(table.workspaceId, table.customerId),
  }),
);

export const customerSegments = pgTable(
  'customer_segments',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    workspaceId: uuid('workspace_id').notNull().references(() => workspaces.id),
    name: text('name').notNull(),
    description: text('description'),
    query: jsonb('query').notNull().default({}),
    customerCount: integer('customer_count').notNull().default(0),
    createdBy: uuid('created_by').references(() => users.id),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
  },
  table => ({
    customerSegmentsWsIdx: index('customer_segments_ws_idx').on(table.workspaceId),
  }),
);

export const customerMergeLog = pgTable('customer_merge_log', {
  id: uuid('id').defaultRandom().primaryKey(),
  workspaceId: uuid('workspace_id').notNull().references(() => workspaces.id),
  primaryCustomerId: uuid('primary_customer_id').notNull().references(() => customers.id),
  mergedCustomerId: uuid('merged_customer_id').notNull(),
  mergedData: jsonb('merged_data').notNull().default({}),
  mergedBy: uuid('merged_by').references(() => users.id),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
});

// ---- Community Forum Tables ----

export const forumCategories = pgTable(
  'forum_categories',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    workspaceId: uuid('workspace_id').notNull().references(() => workspaces.id),
    name: text('name').notNull(),
    description: text('description'),
    slug: text('slug').notNull(),
    position: integer('position').notNull().default(0),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  },
  table => ({
    forumCategoriesWsSlugIdx: uniqueIndex('forum_categories_ws_slug_idx').on(table.workspaceId, table.slug),
  }),
);

export const forumThreads = pgTable(
  'forum_threads',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    workspaceId: uuid('workspace_id').notNull().references(() => workspaces.id),
    categoryId: uuid('category_id').notNull().references(() => forumCategories.id),
    customerId: uuid('customer_id').references(() => customers.id),
    title: text('title').notNull(),
    body: text('body').notNull(),
    status: forumThreadStatusEnum('status').notNull().default('open'),
    isPinned: boolean('is_pinned').notNull().default(false),
    viewCount: integer('view_count').notNull().default(0),
    replyCount: integer('reply_count').notNull().default(0),
    lastActivityAt: timestamp('last_activity_at', { withTimezone: true }).defaultNow().notNull(),
    convertedTicketId: uuid('converted_ticket_id').references(() => tickets.id),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
  },
  table => ({
    forumThreadsWsCatIdx: index('forum_threads_ws_cat_idx').on(table.workspaceId, table.categoryId),
  }),
);

export const forumReplies = pgTable(
  'forum_replies',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    workspaceId: uuid('workspace_id').notNull().references(() => workspaces.id),
    threadId: uuid('thread_id').notNull().references(() => forumThreads.id),
    customerId: uuid('customer_id').references(() => customers.id),
    body: text('body').notNull(),
    isBestAnswer: boolean('is_best_answer').notNull().default(false),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
  },
  table => ({
    forumRepliesThreadIdx: index('forum_replies_thread_idx').on(table.threadId),
  }),
);

// ---- QA / Conversation Review Tables ----

export const qaScorecards = pgTable(
  'qa_scorecards',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    workspaceId: uuid('workspace_id').notNull().references(() => workspaces.id),
    name: text('name').notNull(),
    criteria: jsonb('criteria').notNull().default([]),
    enabled: boolean('enabled').notNull().default(true),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
  },
  table => ({
    qaScorecardsWsIdx: index('qa_scorecards_ws_idx').on(table.workspaceId),
  }),
);

export const qaReviews = pgTable(
  'qa_reviews',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    workspaceId: uuid('workspace_id').notNull().references(() => workspaces.id),
    ticketId: uuid('ticket_id').references(() => tickets.id),
    conversationId: uuid('conversation_id').references(() => conversations.id),
    scorecardId: uuid('scorecard_id').notNull().references(() => qaScorecards.id),
    reviewerId: uuid('reviewer_id').references(() => users.id),
    reviewType: text('review_type').notNull().default('manual'),
    scores: jsonb('scores').notNull().default({}),
    totalScore: integer('total_score').notNull().default(0),
    maxPossibleScore: integer('max_possible_score').notNull().default(0),
    notes: text('notes'),
    status: qaReviewStatusEnum('status').notNull().default('pending'),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  },
  table => ({
    qaReviewsWsTicketIdx: index('qa_reviews_ws_ticket_idx').on(table.workspaceId, table.ticketId),
  }),
);

// ---- AutoQA & Predictions Tables ----

export const autoqaConfigs = pgTable(
  'autoqa_configs',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    workspaceId: uuid('workspace_id').notNull().references(() => workspaces.id),
    enabled: boolean('enabled').notNull().default(false),
    scorecardId: uuid('scorecard_id').references(() => qaScorecards.id),
    triggerOnResolved: boolean('trigger_on_resolved').notNull().default(true),
    triggerOnClosed: boolean('trigger_on_closed').notNull().default(false),
    provider: text('provider').notNull().default('claude'),
    model: text('model'),
    sampleRate: numeric('sample_rate', { precision: 3, scale: 2 }).notNull().default('1.00'),
    customInstructions: text('custom_instructions'),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
  },
  table => ({
    autoqaConfigsWsUnique: uniqueIndex('autoqa_configs_ws_unique').on(table.workspaceId),
  }),
);

export const qaFlags = pgTable(
  'qa_flags',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    workspaceId: uuid('workspace_id').notNull().references(() => workspaces.id),
    reviewId: uuid('review_id').notNull().references(() => qaReviews.id),
    ticketId: uuid('ticket_id').references(() => tickets.id),
    category: text('category').notNull(),
    severity: text('severity').notNull(),
    message: text('message').notNull(),
    dismissed: boolean('dismissed').notNull().default(false),
    dismissedBy: uuid('dismissed_by').references(() => users.id),
    dismissedAt: timestamp('dismissed_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  },
  table => ({
    qaFlagsWsSeverityIdx: index('qa_flags_ws_severity_idx').on(table.workspaceId, table.severity),
    qaFlagsReviewIdx: index('qa_flags_review_idx').on(table.reviewId),
  }),
);

export const qaCoachingAssignments = pgTable(
  'qa_coaching_assignments',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    workspaceId: uuid('workspace_id').notNull().references(() => workspaces.id),
    reviewId: uuid('review_id').notNull().references(() => qaReviews.id),
    agentId: uuid('agent_id').notNull().references(() => users.id),
    assignedBy: uuid('assigned_by').notNull().references(() => users.id),
    status: text('status').notNull().default('pending'),
    notes: text('notes'),
    agentResponse: text('agent_response'),
    assignedAt: timestamp('assigned_at', { withTimezone: true }).defaultNow().notNull(),
    acknowledgedAt: timestamp('acknowledged_at', { withTimezone: true }),
    completedAt: timestamp('completed_at', { withTimezone: true }),
  },
  table => ({
    qaCoachingWsAgentIdx: index('qa_coaching_ws_agent_idx').on(table.workspaceId, table.agentId, table.status),
  }),
);

export const csatPredictions = pgTable(
  'csat_predictions',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    workspaceId: uuid('workspace_id').notNull().references(() => workspaces.id),
    ticketId: uuid('ticket_id').notNull().references(() => tickets.id),
    predictedScore: numeric('predicted_score', { precision: 3, scale: 1 }).notNull(),
    confidence: numeric('confidence', { precision: 3, scale: 2 }).notNull(),
    riskLevel: text('risk_level').notNull(),
    factors: jsonb('factors').notNull().default({}),
    predictedAt: timestamp('predicted_at', { withTimezone: true }).defaultNow().notNull(),
    actualScore: integer('actual_score'),
    actualReceivedAt: timestamp('actual_received_at', { withTimezone: true }),
  },
  table => ({
    csatPredictionsWsTicketIdx: index('csat_predictions_ws_ticket_idx').on(table.workspaceId, table.ticketId),
    csatPredictionsWsRiskIdx: index('csat_predictions_ws_risk_idx').on(table.workspaceId, table.riskLevel),
  }),
);

export const customerHealthScores = pgTable(
  'customer_health_scores',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    workspaceId: uuid('workspace_id').notNull().references(() => workspaces.id),
    customerId: uuid('customer_id').notNull().references(() => customers.id),
    overallScore: integer('overall_score').notNull(),
    csatScore: integer('csat_score'),
    sentimentScore: integer('sentiment_score'),
    effortScore: integer('effort_score'),
    resolutionScore: integer('resolution_score'),
    engagementScore: integer('engagement_score'),
    trend: text('trend').notNull().default('stable'),
    previousScore: integer('previous_score'),
    signals: jsonb('signals').notNull().default({}),
    computedAt: timestamp('computed_at', { withTimezone: true }).defaultNow().notNull(),
  },
  table => ({
    customerHealthWsCustomerUnique: uniqueIndex('customer_health_ws_customer_unique').on(table.workspaceId, table.customerId),
    customerHealthWsScoreIdx: index('customer_health_ws_score_idx').on(table.workspaceId, table.overallScore),
  }),
);

export const qaCalibrationSessions = pgTable(
  'qa_calibration_sessions',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    workspaceId: uuid('workspace_id').notNull().references(() => workspaces.id),
    name: text('name').notNull(),
    status: text('status').notNull().default('open'),
    createdBy: uuid('created_by').notNull().references(() => users.id),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    closedAt: timestamp('closed_at', { withTimezone: true }),
  },
);

export const qaCalibrationEntries = pgTable(
  'qa_calibration_entries',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    sessionId: uuid('session_id').notNull().references(() => qaCalibrationSessions.id),
    autoReviewId: uuid('auto_review_id').notNull().references(() => qaReviews.id),
    manualReviewId: uuid('manual_review_id').references(() => qaReviews.id),
    scoreDelta: numeric('score_delta', { precision: 4, scale: 2 }),
    notes: text('notes'),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  },
  table => ({
    qaCalibrationEntriesSessionIdx: index('qa_calibration_entries_session_idx').on(table.sessionId),
  }),
);

// ---- Campaign Tables ----

export const campaigns = pgTable(
  'campaigns',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    workspaceId: uuid('workspace_id').notNull().references(() => workspaces.id),
    name: text('name').notNull(),
    channel: campaignChannelEnum('channel').notNull().default('email'),
    status: campaignStatusEnum('status').notNull().default('draft'),
    subject: text('subject'),
    templateBody: text('template_body'),
    templateVariables: jsonb('template_variables').default({}),
    segmentQuery: jsonb('segment_query').default({}),
    scheduledAt: timestamp('scheduled_at', { withTimezone: true }),
    sentAt: timestamp('sent_at', { withTimezone: true }),
    entryStepId: uuid('entry_step_id'),
    createdBy: uuid('created_by').references(() => users.id),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
  },
  table => ({
    campaignsWsStatusIdx: index('campaigns_ws_status_idx').on(table.workspaceId, table.status),
  }),
);

export const campaignRecipients = pgTable(
  'campaign_recipients',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    campaignId: uuid('campaign_id').notNull().references(() => campaigns.id),
    workspaceId: uuid('workspace_id').notNull().references(() => workspaces.id),
    customerId: uuid('customer_id').references(() => customers.id),
    email: text('email'),
    phone: text('phone'),
    status: text('status').notNull().default('pending'),
    sentAt: timestamp('sent_at', { withTimezone: true }),
    deliveredAt: timestamp('delivered_at', { withTimezone: true }),
    openedAt: timestamp('opened_at', { withTimezone: true }),
    clickedAt: timestamp('clicked_at', { withTimezone: true }),
    error: text('error'),
  },
  table => ({
    campaignRecipientsCampaignIdx: index('campaign_recipients_campaign_idx').on(table.campaignId),
  }),
);

// ---- Channel Config Tables ----

export const telegramBotConfigs = pgTable(
  'telegram_bot_configs',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    workspaceId: uuid('workspace_id').notNull().references(() => workspaces.id),
    botToken: text('bot_token').notNull(),
    botUsername: text('bot_username'),
    webhookSecret: text('webhook_secret').notNull(),
    inboxId: uuid('inbox_id').references(() => inboxes.id),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  },
  table => ({
    telegramBotConfigsWsIdx: uniqueIndex('telegram_bot_configs_ws_idx').on(table.workspaceId),
  }),
);

export const slackChannelMappings = pgTable(
  'slack_channel_mappings',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    workspaceId: uuid('workspace_id').notNull().references(() => workspaces.id),
    slackChannelId: text('slack_channel_id').notNull(),
    slackChannelName: text('slack_channel_name'),
    inboxId: uuid('inbox_id').references(() => inboxes.id),
    autoCreateTickets: boolean('auto_create_tickets').notNull().default(true),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  },
  table => ({
    slackMappingsWsChannelIdx: uniqueIndex('slack_mappings_ws_channel_idx').on(table.workspaceId, table.slackChannelId),
  }),
);

export const teamsChannelMappings = pgTable(
  'teams_channel_mappings',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    workspaceId: uuid('workspace_id').notNull().references(() => workspaces.id),
    teamsChannelId: text('teams_channel_id').notNull(),
    teamsTeamId: text('teams_team_id').notNull(),
    teamsChannelName: text('teams_channel_name'),
    inboxId: uuid('inbox_id').references(() => inboxes.id),
    autoCreateTickets: boolean('auto_create_tickets').notNull().default(true),
    serviceUrl: text('service_url'),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  },
  table => ({
    teamsMappingsWsChannelIdx: uniqueIndex('teams_mappings_ws_channel_idx').on(table.workspaceId, table.teamsChannelId),
  }),
);

// ---- Plugin Marketplace Enums ----

export const pluginListingStatusEnum = pgEnum('plugin_listing_status', [
  'draft', 'review', 'published', 'rejected', 'deprecated',
]);

// ---- Marketplace Listings (global plugin catalog) ----

export const marketplaceListings = pgTable(
  'marketplace_listings',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    pluginId: text('plugin_id').notNull().unique(),
    manifest: jsonb('manifest').notNull(),
    status: pluginListingStatusEnum('status').notNull().default('draft'),
    publishedBy: uuid('published_by').references(() => users.id),
    installCount: integer('install_count').notNull().default(0),
    averageRating: numeric('average_rating', { precision: 3, scale: 2 }),
    reviewCount: integer('review_count').notNull().default(0),
    featured: boolean('featured').notNull().default(false),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
  },
  table => ({
    marketplaceListingsStatusIdx: index('marketplace_listings_status_idx').on(table.status),
  }),
);

// ---- Plugin Installations (workspace-scoped) ----

export const pluginInstallations = pgTable(
  'plugin_installations',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    workspaceId: uuid('workspace_id').notNull().references(() => workspaces.id),
    pluginId: text('plugin_id').notNull(),
    version: text('version').notNull(),
    enabled: boolean('enabled').notNull().default(false),
    config: jsonb('config').notNull().default({}),
    installedBy: uuid('installed_by').references(() => users.id),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
  },
  table => ({
    pluginInstallationsWsPluginIdx: uniqueIndex('plugin_installations_ws_plugin_idx').on(
      table.workspaceId,
      table.pluginId,
    ),
  }),
);

// ---- Plugin Hook Registrations ----

export const pluginHookRegistrations = pgTable(
  'plugin_hook_registrations',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    installationId: uuid('installation_id').notNull().references(() => pluginInstallations.id, { onDelete: 'cascade' }),
    workspaceId: uuid('workspace_id').notNull().references(() => workspaces.id),
    hookName: text('hook_name').notNull(),
    priority: integer('priority').notNull().default(100),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  },
  table => ({
    pluginHookRegistrationsWsHookIdx: index('plugin_hook_registrations_ws_hook_idx').on(
      table.workspaceId,
      table.hookName,
    ),
  }),
);

// ---- Plugin Execution Logs ----

export const pluginExecutionLogs = pgTable(
  'plugin_execution_logs',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    installationId: uuid('installation_id').notNull().references(() => pluginInstallations.id, { onDelete: 'cascade' }),
    workspaceId: uuid('workspace_id').notNull(),
    hookName: text('hook_name').notNull(),
    status: text('status').notNull(),
    durationMs: integer('duration_ms').notNull().default(0),
    input: jsonb('input'),
    output: jsonb('output'),
    error: text('error'),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  },
  table => ({
    pluginExecutionLogsWsInstIdx: index('plugin_execution_logs_ws_inst_idx').on(
      table.workspaceId,
      table.installationId,
      table.createdAt,
    ),
  }),
);

// ---- Plugin Reviews ----

export const pluginReviews = pgTable(
  'plugin_reviews',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    listingId: uuid('listing_id').notNull().references(() => marketplaceListings.id, { onDelete: 'cascade' }),
    workspaceId: uuid('workspace_id').notNull(),
    userId: uuid('user_id').notNull().references(() => users.id),
    rating: integer('rating').notNull(),
    title: text('title').notNull().default(''),
    body: text('body').notNull().default(''),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
  },
  table => ({
    pluginReviewsListingWsIdx: uniqueIndex('plugin_reviews_listing_ws_idx').on(
      table.listingId,
      table.workspaceId,
    ),
  }),
);

// ---- Routing Engine Tables ----

export const routingStrategyEnum = pgEnum('routing_strategy', [
  'round_robin',
  'load_balanced',
  'skill_match',
  'priority_weighted',
]);

export const agentAvailabilityEnum = pgEnum('agent_availability', [
  'online',
  'away',
  'offline',
  'on_break',
]);

export const routingTargetTypeEnum = pgEnum('routing_target_type', [
  'queue',
  'group',
  'agent',
]);

export const agentSkills = pgTable(
  'agent_skills',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    workspaceId: uuid('workspace_id').notNull().references(() => workspaces.id),
    userId: uuid('user_id').notNull().references(() => users.id),
    skillName: text('skill_name').notNull(),
    proficiency: integer('proficiency').notNull().default(100), // 0-100
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  },
  table => ({
    agentSkillsUserIdx: index('agent_skills_user_idx').on(table.userId),
    agentSkillsUniqueIdx: uniqueIndex('agent_skills_unique_idx').on(
      table.userId,
      table.skillName,
    ),
  }),
);

export const agentCapacityRules = pgTable(
  'agent_capacity_rules',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    workspaceId: uuid('workspace_id').notNull().references(() => workspaces.id),
    userId: uuid('user_id').notNull().references(() => users.id),
    channelType: channelTypeEnum('channel_type').notNull(),
    maxConcurrent: integer('max_concurrent').notNull().default(10),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  },
  table => ({
    agentCapacityUserIdx: index('agent_capacity_user_idx').on(table.userId),
    agentCapacityUniqueIdx: uniqueIndex('agent_capacity_unique_idx').on(
      table.userId,
      table.channelType,
    ),
  }),
);

export const routingQueues = pgTable(
  'routing_queues',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    workspaceId: uuid('workspace_id').notNull().references(() => workspaces.id),
    name: text('name').notNull(),
    description: text('description'),
    priority: integer('priority').notNull().default(0),
    conditions: jsonb('conditions').notNull().default({}),
    strategy: routingStrategyEnum('strategy').notNull().default('skill_match'),
    groupId: uuid('group_id').references(() => groups.id),
    overflowQueueId: uuid('overflow_queue_id'),
    overflowTimeoutSecs: integer('overflow_timeout_secs'),
    enabled: boolean('enabled').notNull().default(true),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
  },
  table => ({
    routingQueuesWorkspaceIdx: index('routing_queues_workspace_idx').on(
      table.workspaceId,
      table.enabled,
    ),
  }),
);

export const routingRules = pgTable(
  'routing_rules',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    workspaceId: uuid('workspace_id').notNull().references(() => workspaces.id),
    name: text('name').notNull(),
    priority: integer('priority').notNull().default(0),
    conditions: jsonb('conditions').notNull().default({}),
    targetType: routingTargetTypeEnum('target_type').notNull(),
    targetId: uuid('target_id').notNull(),
    enabled: boolean('enabled').notNull().default(true),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
  },
  table => ({
    routingRulesWorkspaceIdx: index('routing_rules_workspace_idx').on(
      table.workspaceId,
      table.enabled,
    ),
  }),
);

export const routingLog = pgTable(
  'routing_log',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    workspaceId: uuid('workspace_id').notNull().references(() => workspaces.id),
    ticketId: uuid('ticket_id').references(() => tickets.id),
    queueId: uuid('queue_id').references(() => routingQueues.id),
    ruleId: uuid('rule_id').references(() => routingRules.id),
    assignedUserId: uuid('assigned_user_id').references(() => users.id),
    strategy: routingStrategyEnum('strategy').notNull(),
    matchedSkills: text('matched_skills').array().default([]),
    scores: jsonb('scores').default({}),
    reasoning: text('reasoning'),
    durationMs: integer('duration_ms'),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  },
  table => ({
    routingLogWorkspaceIdx: index('routing_log_workspace_idx').on(
      table.workspaceId,
      table.createdAt,
    ),
    routingLogTicketIdx: index('routing_log_ticket_idx').on(table.ticketId),
  }),
);

// ---- Workforce Management (WFM) ----

export const timeOffStatusEnum = pgEnum('time_off_status', [
  'pending',
  'approved',
  'denied',
]);

export const scheduleTemplates = pgTable(
  'schedule_templates',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    workspaceId: uuid('workspace_id').notNull().references(() => workspaces.id),
    name: text('name').notNull(),
    shifts: jsonb('shifts').notNull().default([]),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
  },
  table => ({
    scheduleTemplatesWorkspaceIdx: index('schedule_templates_workspace_idx').on(table.workspaceId),
  }),
);

export const agentSchedules = pgTable(
  'agent_schedules',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    workspaceId: uuid('workspace_id').notNull().references(() => workspaces.id),
    userId: uuid('user_id').notNull().references(() => users.id),
    templateId: uuid('template_id').references(() => scheduleTemplates.id),
    effectiveFrom: date('effective_from').notNull(),
    effectiveTo: date('effective_to'),
    timezone: text('timezone').notNull().default('UTC'),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
  },
  table => ({
    agentSchedulesWorkspaceUserIdx: index('agent_schedules_workspace_user_idx').on(
      table.workspaceId,
      table.userId,
    ),
    agentSchedulesEffectiveIdx: index('agent_schedules_effective_idx').on(
      table.userId,
      table.effectiveFrom,
      table.effectiveTo,
    ),
  }),
);

export const scheduleShifts = pgTable(
  'schedule_shifts',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    scheduleId: uuid('schedule_id').notNull().references(() => agentSchedules.id, { onDelete: 'cascade' }),
    dayOfWeek: integer('day_of_week').notNull(),
    startTime: time('start_time').notNull(),
    endTime: time('end_time').notNull(),
    activity: text('activity').notNull().default('work'),
    label: text('label'),
  },
  table => ({
    scheduleShiftsScheduleIdx: index('schedule_shifts_schedule_idx').on(table.scheduleId),
  }),
);

export const timeOffRequests = pgTable(
  'time_off_requests',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    workspaceId: uuid('workspace_id').notNull().references(() => workspaces.id),
    userId: uuid('user_id').notNull().references(() => users.id),
    startDate: date('start_date').notNull(),
    endDate: date('end_date').notNull(),
    reason: text('reason'),
    status: timeOffStatusEnum('status').notNull().default('pending'),
    approvedBy: uuid('approved_by').references(() => users.id),
    decidedAt: timestamp('decided_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  },
  table => ({
    timeOffRequestsWorkspaceStatusIdx: index('time_off_requests_workspace_status_idx').on(
      table.workspaceId,
      table.status,
    ),
    timeOffRequestsUserIdx: index('time_off_requests_user_idx').on(table.userId),
  }),
);

export const agentStatusLog = pgTable(
  'agent_status_log',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    workspaceId: uuid('workspace_id').notNull().references(() => workspaces.id),
    userId: uuid('user_id').notNull().references(() => users.id),
    status: agentAvailabilityEnum('status').notNull(),
    reason: text('reason'),
    startedAt: timestamp('started_at', { withTimezone: true }).defaultNow().notNull(),
  },
  table => ({
    agentStatusLogWorkspaceUserIdx: index('agent_status_log_workspace_user_idx').on(
      table.workspaceId,
      table.userId,
      table.startedAt,
    ),
  }),
);

export const volumeSnapshots = pgTable(
  'volume_snapshots',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    workspaceId: uuid('workspace_id').notNull().references(() => workspaces.id),
    snapshotHour: timestamp('snapshot_hour', { withTimezone: true }).notNull(),
    channel: text('channel'),
    ticketsCreated: integer('tickets_created').notNull().default(0),
    ticketsResolved: integer('tickets_resolved').notNull().default(0),
  },
  table => ({
    volumeSnapshotsUniqueIdx: uniqueIndex('volume_snapshots_ws_hour_channel_idx').on(
      table.workspaceId,
      table.snapshotHour,
      table.channel,
    ),
    volumeSnapshotsWorkspaceHourIdx: index('volume_snapshots_workspace_hour_idx').on(
      table.workspaceId,
      table.snapshotHour,
    ),
  }),
);

export const businessHours = pgTable(
  'business_hours',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    workspaceId: uuid('workspace_id').notNull().references(() => workspaces.id),
    name: text('name').notNull(),
    timezone: text('timezone').notNull().default('UTC'),
    schedule: jsonb('schedule').notNull().default({}),
    holidays: jsonb('holidays').notNull().default([]),
    isDefault: boolean('is_default').notNull().default(false),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
  },
  table => ({
    businessHoursWorkspaceIdx: index('business_hours_workspace_idx').on(table.workspaceId),
  }),
);

// ---- Canned Responses, Macros & Agent Signatures (Plan 07) ----

export const cannedResponses = pgTable(
  'canned_responses',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    workspaceId: uuid('workspace_id').notNull().references(() => workspaces.id),
    createdBy: uuid('created_by').references(() => users.id),
    title: text('title').notNull(),
    body: text('body').notNull(),
    category: text('category'),
    scope: templateScopeEnum('scope').notNull().default('personal'),
    shortcut: text('shortcut'),
    usageCount: integer('usage_count').notNull().default(0),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
  },
  table => ({
    cannedResponsesWorkspaceIdx: index('canned_responses_workspace_idx').on(table.workspaceId),
    cannedResponsesCategoryIdx: index('canned_responses_category_idx').on(table.workspaceId, table.category),
    cannedResponsesCreatedByIdx: index('canned_responses_created_by_idx').on(table.createdBy),
  }),
);

export const nativeMacros = pgTable(
  'macros',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    workspaceId: uuid('workspace_id').notNull().references(() => workspaces.id),
    createdBy: uuid('created_by').references(() => users.id),
    name: text('name').notNull(),
    description: text('description'),
    actions: jsonb('actions').notNull().default([]),
    scope: templateScopeEnum('scope').notNull().default('shared'),
    enabled: boolean('enabled').notNull().default(true),
    usageCount: integer('usage_count').notNull().default(0),
    position: integer('position'),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
  },
  table => ({
    macrosWorkspaceIdx: index('macros_workspace_idx').on(table.workspaceId),
    macrosCreatedByIdx: index('macros_created_by_idx').on(table.createdBy),
  }),
);

export const agentSignatures = pgTable(
  'agent_signatures',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    workspaceId: uuid('workspace_id').notNull().references(() => workspaces.id),
    userId: uuid('user_id').references(() => users.id),
    name: text('name').notNull(),
    bodyHtml: text('body_html').notNull(),
    bodyText: text('body_text').notNull(),
    isDefault: boolean('is_default').notNull().default(false),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
  },
  table => ({
    agentSignaturesWorkspaceIdx: index('agent_signatures_workspace_idx').on(table.workspaceId),
    agentSignaturesUserIdx: index('agent_signatures_user_idx').on(table.userId),
    agentSignaturesUserDefaultIdx: uniqueIndex('agent_signatures_user_default_idx')
      .on(table.userId)
      .where(sql`is_default = true`),
  }),
);

// ---- Ticket Merge & Split Logs ----

export const ticketMergeLog = pgTable(
  'ticket_merge_log',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    workspaceId: uuid('workspace_id').notNull().references(() => workspaces.id),
    primaryTicketId: uuid('primary_ticket_id').notNull().references(() => tickets.id),
    mergedTicketId: uuid('merged_ticket_id').notNull().references(() => tickets.id),
    mergedBy: uuid('merged_by').references(() => users.id),
    mergedTicketSnapshot: jsonb('merged_ticket_snapshot').notNull(),
    movedMessageIds: uuid('moved_message_ids').array().notNull().default([]),
    movedAttachmentIds: uuid('moved_attachment_ids').array().notNull().default([]),
    mergedTags: text('merged_tags').array().notNull().default([]),
    undone: boolean('undone').notNull().default(false),
    undoneAt: timestamp('undone_at', { withTimezone: true }),
    undoneBy: uuid('undone_by').references(() => users.id),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  },
  table => ({
    ticketMergeLogWorkspaceIdx: index('ticket_merge_log_workspace_idx').on(table.workspaceId),
    ticketMergeLogPrimaryIdx: index('ticket_merge_log_primary_idx').on(table.primaryTicketId),
    ticketMergeLogMergedIdx: index('ticket_merge_log_merged_idx').on(table.mergedTicketId),
  }),
);

export const ticketSplitLog = pgTable(
  'ticket_split_log',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    workspaceId: uuid('workspace_id').notNull().references(() => workspaces.id),
    sourceTicketId: uuid('source_ticket_id').notNull().references(() => tickets.id),
    newTicketId: uuid('new_ticket_id').notNull().references(() => tickets.id),
    splitBy: uuid('split_by').references(() => users.id),
    movedMessageIds: uuid('moved_message_ids').array().notNull().default([]),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  },
  table => ({
    ticketSplitLogWorkspaceIdx: index('ticket_split_log_workspace_idx').on(table.workspaceId),
    ticketSplitLogSourceIdx: index('ticket_split_log_source_idx').on(table.sourceTicketId),
    ticketSplitLogNewIdx: index('ticket_split_log_new_idx').on(table.newTicketId),
  }),
);

// ---- Holiday Calendars & Business Hours Enhancements (Plan 12) ----

export const holidayCalendars = pgTable(
  'holiday_calendars',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    workspaceId: uuid('workspace_id').notNull().references(() => workspaces.id),
    name: text('name').notNull(),
    description: text('description'),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
  },
  table => ({
    holidayCalendarsWorkspaceIdx: index('holiday_calendars_workspace_idx').on(table.workspaceId),
  }),
);

export const holidayEntries = pgTable(
  'holiday_entries',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    calendarId: uuid('calendar_id').notNull().references(() => holidayCalendars.id),
    name: text('name').notNull(),
    date: date('date').notNull(),
    recurring: boolean('recurring').notNull().default(false),
    startTime: time('start_time'),
    endTime: time('end_time'),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  },
  table => ({
    holidayEntriesCalendarIdx: index('holiday_entries_calendar_idx').on(table.calendarId),
  }),
);

export const businessHoursHolidayLinks = pgTable(
  'business_hours_holiday_links',
  {
    businessHoursId: uuid('business_hours_id').notNull().references(() => businessHours.id),
    holidayCalendarId: uuid('holiday_calendar_id').notNull().references(() => holidayCalendars.id),
  },
  table => ({
    pk: primaryKey({ columns: [table.businessHoursId, table.holidayCalendarId] }),
  }),
);

// ---- Custom Reports & Analytics (Slice 13) ----

export const reports = pgTable(
  'reports',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    workspaceId: uuid('workspace_id').notNull().references(() => workspaces.id),
    name: text('name').notNull(),
    description: text('description'),
    metric: text('metric').notNull(),
    groupBy: text('group_by').array().default([]),
    filters: jsonb('filters').default({}),
    dateRange: jsonb('date_range'),
    visualization: text('visualization').notNull().default('bar'),
    formula: text('formula'),
    isTemplate: boolean('is_template').notNull().default(false),
    shareToken: varchar('share_token', { length: 64 }).unique(),
    createdBy: uuid('created_by').references(() => users.id),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
  },
  table => ({
    reportsWorkspaceIdx: index('reports_workspace_idx').on(table.workspaceId),
    reportsTemplateIdx: index('reports_template_idx').on(table.isTemplate),
  }),
);

export const dashboards = pgTable(
  'dashboards',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    workspaceId: uuid('workspace_id').notNull().references(() => workspaces.id),
    name: text('name').notNull(),
    description: text('description'),
    isDefault: boolean('is_default').notNull().default(false),
    layout: jsonb('layout').default({}),
    shareToken: varchar('share_token', { length: 64 }).unique(),
    createdBy: uuid('created_by').references(() => users.id),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
  },
  table => ({
    dashboardsWorkspaceIdx: index('dashboards_workspace_idx').on(table.workspaceId),
  }),
);

export const dashboardWidgets = pgTable(
  'dashboard_widgets',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    dashboardId: uuid('dashboard_id').notNull().references(() => dashboards.id, { onDelete: 'cascade' }),
    reportId: uuid('report_id').notNull().references(() => reports.id, { onDelete: 'cascade' }),
    gridX: integer('grid_x').notNull().default(0),
    gridY: integer('grid_y').notNull().default(0),
    gridW: integer('grid_w').notNull().default(4),
    gridH: integer('grid_h').notNull().default(3),
    overrides: jsonb('overrides').default({}),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  },
  table => ({
    dashboardWidgetsDashboardIdx: index('dashboard_widgets_dashboard_idx').on(table.dashboardId),
    dashboardWidgetsReportIdx: index('dashboard_widgets_report_idx').on(table.reportId),
  }),
);

export const reportSchedules = pgTable(
  'report_schedules',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    workspaceId: uuid('workspace_id').notNull().references(() => workspaces.id),
    reportId: uuid('report_id').notNull().references(() => reports.id, { onDelete: 'cascade' }),
    frequency: text('frequency').notNull().default('weekly'),
    dayOfWeek: integer('day_of_week'),
    dayOfMonth: integer('day_of_month'),
    hourUtc: integer('hour_utc').notNull().default(9),
    format: text('format').notNull().default('csv'),
    recipients: text('recipients').array().notNull().default([]),
    enabled: boolean('enabled').notNull().default(true),
    lastSentAt: timestamp('last_sent_at', { withTimezone: true }),
    nextRunAt: timestamp('next_run_at', { withTimezone: true }),
    createdBy: uuid('created_by').references(() => users.id),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
  },
  table => ({
    reportSchedulesWorkspaceIdx: index('report_schedules_workspace_idx').on(table.workspaceId),
    reportSchedulesNextRunIdx: index('report_schedules_next_run_idx').on(table.nextRunAt),
  }),
);

export const reportCache = pgTable(
  'report_cache',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    reportId: uuid('report_id').notNull().references(() => reports.id, { onDelete: 'cascade' }),
    filterHash: varchar('filter_hash', { length: 64 }).notNull(),
    resultData: jsonb('result_data').notNull(),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  },
  table => ({
    reportCacheLookupIdx: index('report_cache_lookup_idx').on(table.reportId, table.filterHash),
    reportCacheExpiryIdx: index('report_cache_expiry_idx').on(table.expiresAt),
  }),
);

export const metricSnapshots = pgTable(
  'metric_snapshots',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    workspaceId: uuid('workspace_id').notNull().references(() => workspaces.id),
    metricName: text('metric_name').notNull(),
    metricValue: numeric('metric_value', { precision: 20, scale: 4 }).notNull().default('0'),
    dimensions: jsonb('dimensions').default({}),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  },
  table => ({
    metricSnapshotsWorkspaceMetricIdx: index('metric_snapshots_workspace_metric_idx').on(
      table.workspaceId,
      table.metricName,
      table.createdAt,
    ),
    metricSnapshotsCreatedIdx: index('metric_snapshots_created_idx').on(table.createdAt),
  }),
);

// ---- KB Article Feedback ----

export const kbArticleFeedback = pgTable(
  'kb_article_feedback',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    workspaceId: uuid('workspace_id').notNull().references(() => workspaces.id),
    articleId: uuid('article_id').notNull().references(() => kbArticles.id, { onDelete: 'cascade' }),
    sessionId: text('session_id'),
    customerId: uuid('customer_id').references(() => customers.id),
    helpful: boolean('helpful').notNull(),
    comment: text('comment'),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  },
  table => ({
    kbArticleFeedbackArticleIdx: index('kb_article_feedback_article_idx').on(table.articleId),
    kbArticleFeedbackWorkspaceIdx: index('kb_article_feedback_workspace_idx').on(table.workspaceId),
  }),
);

// ---- KB Deflections ----

export const kbDeflections = pgTable(
  'kb_deflections',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    workspaceId: uuid('workspace_id').notNull().references(() => workspaces.id),
    articleId: uuid('article_id').references(() => kbArticles.id, { onDelete: 'set null' }),
    brandId: uuid('brand_id').references(() => brands.id),
    source: varchar('source', { length: 20 }).notNull().default('portal'),
    query: text('query').notNull(),
    customerId: uuid('customer_id').references(() => customers.id),
    sessionId: text('session_id'),
    deflected: boolean('deflected').notNull().default(false),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  },
  table => ({
    kbDeflectionsWorkspaceIdx: index('kb_deflections_workspace_idx').on(table.workspaceId, table.createdAt),
    kbDeflectionsArticleIdx: index('kb_deflections_article_idx').on(table.articleId),
  }),
);

// ---- KB Content Gaps ----

export const kbContentGaps = pgTable(
  'kb_content_gaps',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    workspaceId: uuid('workspace_id').notNull().references(() => workspaces.id),
    topic: text('topic').notNull(),
    ticketCount: integer('ticket_count').notNull().default(0),
    sampleTicketIds: text('sample_ticket_ids').array(),
    suggestedTitle: text('suggested_title'),
    suggestedOutline: text('suggested_outline'),
    status: varchar('status', { length: 20 }).notNull().default('open'),
    createdArticleId: uuid('created_article_id').references(() => kbArticles.id),
    brandId: uuid('brand_id').references(() => brands.id),
    locale: varchar('locale', { length: 10 }).default('en'),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
  },
  table => ({
    kbContentGapsWorkspaceIdx: index('kb_content_gaps_workspace_idx').on(table.workspaceId, table.status),
  }),
);

// ---- RBAC ----

export const permissions = pgTable(
  'permissions',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    key: text('key').notNull().unique(),
    category: text('category').notNull(),
    label: text('label').notNull(),
    description: text('description'),
    bitIndex: integer('bit_index').notNull().unique(),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  },
);

export const rolePermissions = pgTable(
  'role_permissions',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    role: text('role').notNull(),
    permissionKey: text('permission_key').notNull().references(() => permissions.key, { onDelete: 'cascade' }),
    workspaceId: uuid('workspace_id').references(() => workspaces.id),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  },
  table => ({
    rolePermissionsRoleIdx: index('role_permissions_role_idx').on(table.role),
    rolePermissionsWorkspaceIdx: index('role_permissions_workspace_idx').on(table.workspaceId),
  }),
);

export const groupMemberships = pgTable(
  'group_memberships',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    workspaceId: uuid('workspace_id').notNull().references(() => workspaces.id),
    userId: uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
    groupId: uuid('group_id').notNull().references(() => groups.id, { onDelete: 'cascade' }),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  },
  table => ({
    groupMembershipsUniqueIdx: uniqueIndex('group_memberships_unique_idx').on(table.workspaceId, table.userId, table.groupId),
    groupMembershipsGroupIdx: index('group_memberships_group_idx').on(table.groupId),
    groupMembershipsUserIdx: index('group_memberships_user_idx').on(table.userId),
  }),
);

export const ticketCollaborators = pgTable(
  'ticket_collaborators',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    workspaceId: uuid('workspace_id').notNull().references(() => workspaces.id),
    ticketId: uuid('ticket_id').notNull().references(() => tickets.id, { onDelete: 'cascade' }),
    userId: uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
    addedBy: uuid('added_by').references(() => users.id),
    canReply: boolean('can_reply').notNull().default(false),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  },
  table => ({
    ticketCollaboratorsUniqueIdx: uniqueIndex('ticket_collaborators_unique_idx').on(table.workspaceId, table.ticketId, table.userId),
    ticketCollaboratorsTicketIdx: index('ticket_collaborators_ticket_idx').on(table.ticketId),
    ticketCollaboratorsUserIdx: index('ticket_collaborators_user_idx').on(table.userId),
  }),
);

// ---- Custom Roles ----

export const customRoles = pgTable(
  'custom_roles',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    workspaceId: uuid('workspace_id').notNull().references(() => workspaces.id),
    name: text('name').notNull(),
    description: text('description'),
    baseRole: text('base_role').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
  },
  table => ({
    customRolesWorkspaceNameIdx: uniqueIndex('custom_roles_workspace_name_idx').on(table.workspaceId, table.name),
    customRolesWorkspaceIdx: index('custom_roles_workspace_idx').on(table.workspaceId),
  }),
);

export const customRolePermissions = pgTable(
  'custom_role_permissions',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    customRoleId: uuid('custom_role_id').notNull().references(() => customRoles.id, { onDelete: 'cascade' }),
    permissionKey: text('permission_key').notNull().references(() => permissions.key, { onDelete: 'cascade' }),
    granted: boolean('granted').notNull().default(true),
  },
  table => ({
    customRolePermissionsUniqueIdx: uniqueIndex('custom_role_permissions_unique_idx').on(table.customRoleId, table.permissionKey),
    customRolePermissionsRoleIdx: index('custom_role_permissions_role_idx').on(table.customRoleId),
  }),
);

// ---- AI Resolution ----

export const aiResolutionStatusEnum = pgEnum('ai_resolution_status', [
  'pending', 'auto_resolved', 'approved', 'rejected', 'edited', 'escalated', 'error',
]);

export const aiModeEnum = pgEnum('ai_mode', ['suggest', 'approve', 'auto']);

export const aiResolutions = pgTable(
  'ai_resolutions',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    workspaceId: uuid('workspace_id').notNull().references(() => workspaces.id),
    ticketId: text('ticket_id').notNull(),
    confidence: real('confidence').notNull(),
    suggestedReply: text('suggested_reply').notNull().default(''),
    reasoning: text('reasoning'),
    kbArticlesUsed: text('kb_articles_used').array().notNull().default([]),
    status: aiResolutionStatusEnum('status').notNull().default('pending'),
    finalReply: text('final_reply'),
    actionsTaken: jsonb('actions_taken'),
    escalationReason: text('escalation_reason'),
    errorMessage: text('error_message'),
    provider: text('provider'),
    model: text('model'),
    promptTokens: integer('prompt_tokens'),
    completionTokens: integer('completion_tokens'),
    costCents: real('cost_cents'),
    latencyMs: integer('latency_ms'),
    reviewedBy: text('reviewed_by'),
    reviewedAt: text('reviewed_at'),
    csatScore: smallint('csat_score'),
    csatComment: text('csat_comment'),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  },
  table => ({
    aiResolutionsTicketIdx: index('ai_resolutions_ticket_idx').on(table.ticketId),
    aiResolutionsWorkspaceStatusIdx: index('ai_resolutions_workspace_status_idx').on(table.workspaceId, table.status),
    aiResolutionsCreatedAtIdx: index('ai_resolutions_created_at_idx').on(table.createdAt),
  }),
);

export const aiAgentConfigs = pgTable(
  'ai_agent_configs',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    tenantId: uuid('tenant_id'),
    workspaceId: uuid('workspace_id').notNull().references(() => workspaces.id),
    enabled: boolean('enabled').notNull().default(false),
    mode: aiModeEnum('mode').notNull().default('suggest'),
    confidenceThreshold: real('confidence_threshold').notNull().default(0.7),
    provider: text('provider').notNull().default('claude'),
    model: text('model'),
    maxTokens: integer('max_tokens').notNull().default(1024),
    excludedTopics: text('excluded_topics').array(),
    kbContext: boolean('kb_context').notNull().default(true),
    piiDetection: boolean('pii_detection').notNull().default(true),
    maxAutoResolvesPerHour: integer('max_auto_resolves_per_hour').notNull().default(50),
    requireKbCitation: boolean('require_kb_citation').notNull().default(false),
    channels: text('channels').array(),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
  },
  table => ({
    aiAgentConfigsUniqueIdx: uniqueIndex('ai_agent_configs_unique_idx').on(table.workspaceId),
  }),
);

// ---- PII Detection & HIPAA Compliance (Plan 16) ----

export const piiTypeEnum = pgEnum('pii_type', [
  'ssn', 'credit_card', 'phone', 'email', 'address',
  'dob', 'medical_id', 'passport', 'drivers_license', 'custom',
]);

export const piiDetectionStatusEnum = pgEnum('pii_detection_status', [
  'pending', 'confirmed', 'dismissed', 'redacted', 'auto_redacted',
]);

export const piiScanStatusEnum = pgEnum('pii_scan_status', [
  'queued', 'running', 'completed', 'failed', 'cancelled',
]);

export const piiDetections = pgTable(
  'pii_detections',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    workspaceId: uuid('workspace_id').notNull().references(() => workspaces.id),
    entityType: text('entity_type').notNull(),
    entityId: uuid('entity_id').notNull(),
    fieldName: text('field_name').notNull(),
    piiType: piiTypeEnum('pii_type').notNull(),
    charOffset: integer('char_offset').notNull(),
    charLength: integer('char_length').notNull(),
    originalEncrypted: customType<{ data: Buffer; driverParam: Buffer }>({
      dataType() { return 'bytea'; },
    })('original_encrypted'),
    maskedValue: text('masked_value').notNull(),
    confidence: real('confidence').notNull(),
    detectionMethod: text('detection_method').notNull(),
    status: piiDetectionStatusEnum('status').notNull().default('pending'),
    reviewedBy: uuid('reviewed_by').references(() => users.id),
    reviewedAt: timestamp('reviewed_at', { withTimezone: true }),
    redactedAt: timestamp('redacted_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  },
  table => ({
    piiDetectionsWorkspaceStatusIdx: index('pii_detections_workspace_status_idx').on(table.workspaceId, table.status),
    piiDetectionsEntityIdx: index('pii_detections_entity_idx').on(table.entityType, table.entityId),
    piiDetectionsTypeIdx: index('pii_detections_type_idx').on(table.workspaceId, table.piiType),
  }),
);

export const piiRedactionLog = pgTable(
  'pii_redaction_log',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    workspaceId: uuid('workspace_id').notNull().references(() => workspaces.id),
    detectionId: uuid('detection_id').notNull().references(() => piiDetections.id),
    entityType: text('entity_type').notNull(),
    entityId: uuid('entity_id').notNull(),
    fieldName: text('field_name').notNull(),
    originalHash: text('original_hash').notNull(),
    maskedValue: text('masked_value').notNull(),
    redactedBy: uuid('redacted_by').notNull().references(() => users.id),
    reason: text('reason'),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  },
  table => ({
    piiRedactionLogWorkspaceIdx: index('pii_redaction_log_workspace_idx').on(table.workspaceId, table.createdAt),
    piiRedactionLogEntityIdx: index('pii_redaction_log_entity_idx').on(table.entityType, table.entityId),
  }),
);

export const piiAccessLog = pgTable(
  'pii_access_log',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    workspaceId: uuid('workspace_id').notNull().references(() => workspaces.id),
    userId: uuid('user_id').notNull().references(() => users.id),
    entityType: text('entity_type').notNull(),
    entityId: uuid('entity_id').notNull(),
    fieldName: text('field_name').notNull(),
    piiType: text('pii_type').notNull(),
    accessType: text('access_type').notNull(),
    ipAddress: inet('ip_address'),
    userAgent: text('user_agent'),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  },
  table => ({
    piiAccessLogWorkspaceIdx: index('pii_access_log_workspace_idx').on(table.workspaceId, table.createdAt),
    piiAccessLogUserIdx: index('pii_access_log_user_idx').on(table.userId, table.createdAt),
  }),
);

export const piiScanJobs = pgTable(
  'pii_scan_jobs',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    workspaceId: uuid('workspace_id').notNull().references(() => workspaces.id),
    startedBy: uuid('started_by').notNull().references(() => users.id),
    entityTypes: text('entity_types').array().notNull(),
    status: piiScanStatusEnum('status').notNull().default('queued'),
    totalRecords: integer('total_records').default(0),
    scannedRecords: integer('scanned_records').default(0),
    detectionsFound: integer('detections_found').default(0),
    error: text('error'),
    startedAt: timestamp('started_at', { withTimezone: true }),
    completedAt: timestamp('completed_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  },
  table => ({
    piiScanJobsWorkspaceIdx: index('pii_scan_jobs_workspace_idx').on(table.workspaceId, table.status),
  }),
);

export const piiSensitivityRules = pgTable(
  'pii_sensitivity_rules',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    workspaceId: uuid('workspace_id').notNull().references(() => workspaces.id),
    piiType: piiTypeEnum('pii_type').notNull(),
    enabled: boolean('enabled').notNull().default(true),
    autoRedact: boolean('auto_redact').notNull().default(false),
    customPattern: text('custom_pattern'),
    maskingStyle: text('masking_style').notNull().default('full'),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
  },
  table => ({
    piiSensitivityRulesUniqueIdx: uniqueIndex('pii_sensitivity_rules_unique_idx').on(table.workspaceId, table.piiType),
  }),
);

export const hipaaBaaRecords = pgTable(
  'hipaa_baa_records',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    workspaceId: uuid('workspace_id').notNull().references(() => workspaces.id),
    partnerName: text('partner_name').notNull(),
    partnerEmail: text('partner_email').notNull(),
    signedAt: timestamp('signed_at', { withTimezone: true }),
    expiresAt: timestamp('expires_at', { withTimezone: true }),
    documentUrl: text('document_url'),
    documentHash: text('document_hash'),
    status: text('status').notNull().default('pending'),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  },
  table => ({
    hipaaBaaWorkspaceIdx: index('hipaa_baa_workspace_idx').on(table.workspaceId, table.status),
  }),
);

// ---- Integration Expansion (Plan 20) ----

export const integrationCredentials = pgTable(
  'integration_credentials',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    workspaceId: uuid('workspace_id').notNull().references(() => workspaces.id),
    provider: text('provider').notNull(),
    authType: text('auth_type').notNull(),
    credentials: jsonb('credentials').notNull().default({}),
    scopes: text('scopes').array().default([]),
    expiresAt: timestamp('expires_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
  },
  table => ({
    integrationCredsWsProviderIdx: uniqueIndex('integration_creds_ws_provider_idx').on(
      table.workspaceId,
      table.provider,
    ),
  }),
);

export const ticketExternalLinks = pgTable(
  'ticket_external_links',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    workspaceId: uuid('workspace_id').notNull().references(() => workspaces.id),
    ticketId: uuid('ticket_id').notNull().references(() => tickets.id, { onDelete: 'cascade' }),
    provider: text('provider').notNull(),
    externalId: text('external_id').notNull(),
    externalUrl: text('external_url').notNull(),
    externalStatus: text('external_status'),
    externalTitle: text('external_title'),
    direction: text('direction').notNull().default('outbound'),
    metadata: jsonb('metadata').default({}),
    syncEnabled: boolean('sync_enabled').notNull().default(true),
    lastSyncedAt: timestamp('last_synced_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
  },
  table => ({
    ticketExternalLinksTicketIdx: index('ticket_external_links_ticket_idx').on(table.ticketId),
    ticketExternalLinksExternalIdx: uniqueIndex('ticket_external_links_external_idx').on(
      table.workspaceId,
      table.provider,
      table.externalId,
    ),
    ticketExternalLinksWorkspaceIdx: index('ticket_external_links_workspace_idx').on(table.workspaceId),
  }),
);

export const externalLinkComments = pgTable(
  'external_link_comments',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    linkId: uuid('link_id').notNull().references(() => ticketExternalLinks.id, { onDelete: 'cascade' }),
    workspaceId: uuid('workspace_id').references(() => workspaces.id),
    direction: text('direction').notNull(),
    localMessageId: uuid('local_message_id'),
    externalCommentId: text('external_comment_id'),
    body: text('body').notNull(),
    authorName: text('author_name'),
    syncedAt: timestamp('synced_at', { withTimezone: true }).defaultNow().notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  },
  table => ({
    externalLinkCommentsLinkIdx: index('external_link_comments_link_idx').on(table.linkId),
  }),
);

export const crmLinks = pgTable(
  'crm_links',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    workspaceId: uuid('workspace_id').notNull().references(() => workspaces.id),
    provider: text('provider').notNull(),
    entityType: text('entity_type').notNull(),
    entityId: uuid('entity_id').notNull(),
    crmObjectType: text('crm_object_type').notNull(),
    crmObjectId: text('crm_object_id').notNull(),
    crmObjectUrl: text('crm_object_url'),
    crmData: jsonb('crm_data').default({}),
    lastSyncedAt: timestamp('last_synced_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
  },
  table => ({
    crmLinksEntityIdx: index('crm_links_entity_idx').on(table.entityType, table.entityId),
    crmLinksExternalIdx: uniqueIndex('crm_links_external_idx').on(
      table.workspaceId,
      table.provider,
      table.crmObjectType,
      table.crmObjectId,
    ),
    crmLinksWorkspaceIdx: index('crm_links_workspace_idx').on(table.workspaceId),
  }),
);

export const customObjectTypes = pgTable(
  'custom_object_types',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    workspaceId: uuid('workspace_id').notNull().references(() => workspaces.id),
    key: text('key').notNull(),
    name: text('name').notNull(),
    namePlural: text('name_plural').notNull(),
    description: text('description'),
    icon: text('icon'),
    fields: jsonb('fields').notNull().default([]),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
  },
  table => ({
    customObjectTypesKeyIdx: uniqueIndex('custom_object_types_key_idx').on(
      table.workspaceId,
      table.key,
    ),
  }),
);

export const customObjectRecords = pgTable(
  'custom_object_records',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    workspaceId: uuid('workspace_id').notNull().references(() => workspaces.id),
    typeId: uuid('type_id').notNull().references(() => customObjectTypes.id, { onDelete: 'cascade' }),
    data: jsonb('data').notNull().default({}),
    createdBy: uuid('created_by').references(() => users.id),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
  },
  table => ({
    customObjectRecordsTypeIdx: index('custom_object_records_type_idx').on(table.typeId),
    customObjectRecordsWorkspaceIdx: index('custom_object_records_workspace_idx').on(table.workspaceId),
  }),
);

export const customObjectRelationships = pgTable(
  'custom_object_relationships',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    workspaceId: uuid('workspace_id').notNull().references(() => workspaces.id),
    sourceType: text('source_type').notNull(),
    sourceId: uuid('source_id').notNull(),
    targetType: text('target_type').notNull(),
    targetId: uuid('target_id').notNull(),
    relationshipType: text('relationship_type').notNull().default('related'),
    metadata: jsonb('metadata').default({}),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  },
  table => ({
    customObjectRelsSourceIdx: index('custom_object_rels_source_idx').on(table.sourceType, table.sourceId),
    customObjectRelsTargetIdx: index('custom_object_rels_target_idx').on(table.targetType, table.targetId),
    customObjectRelsDedupIdx: uniqueIndex('custom_object_rels_dedup_idx').on(
      table.sourceType,
      table.sourceId,
      table.targetType,
      table.targetId,
    ),
  }),
);

// ---- Campaign Orchestration Tables (Plan 19) ----

export const campaignSteps = pgTable(
  'campaign_steps',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    campaignId: uuid('campaign_id').notNull().references(() => campaigns.id, { onDelete: 'cascade' }),
    workspaceId: uuid('workspace_id').notNull().references(() => workspaces.id),
    stepType: campaignStepTypeEnum('step_type').notNull(),
    position: integer('position').notNull().default(0),
    name: text('name').notNull(),
    config: jsonb('config').notNull().default({}),
    delaySeconds: integer('delay_seconds'),
    conditionQuery: jsonb('condition_query'),
    nextStepId: uuid('next_step_id'),
    branchTrueStepId: uuid('branch_true_step_id'),
    branchFalseStepId: uuid('branch_false_step_id'),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
  },
  table => ({
    campaignStepsCampaignPosIdx: index('campaign_steps_campaign_pos_idx').on(table.campaignId, table.position),
  }),
);

export const campaignEnrollments = pgTable(
  'campaign_enrollments',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    campaignId: uuid('campaign_id').notNull().references(() => campaigns.id, { onDelete: 'cascade' }),
    workspaceId: uuid('workspace_id').notNull().references(() => workspaces.id),
    customerId: uuid('customer_id').notNull().references(() => customers.id),
    currentStepId: uuid('current_step_id'),
    status: text('status').notNull().default('active'),
    enrolledAt: timestamp('enrolled_at', { withTimezone: true }).defaultNow().notNull(),
    completedAt: timestamp('completed_at', { withTimezone: true }),
    nextExecutionAt: timestamp('next_execution_at', { withTimezone: true }),
    metadata: jsonb('metadata').notNull().default({}),
  },
  table => ({
    campaignEnrollmentsCampaignStatusIdx: index('campaign_enrollments_campaign_status_idx').on(table.campaignId, table.status),
    campaignEnrollmentsCustomerIdx: index('campaign_enrollments_customer_idx').on(table.customerId),
    campaignEnrollmentsNextExecIdx: index('campaign_enrollments_next_exec_idx').on(table.nextExecutionAt),
  }),
);

export const campaignStepEvents = pgTable(
  'campaign_step_events',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    enrollmentId: uuid('enrollment_id').notNull().references(() => campaignEnrollments.id, { onDelete: 'cascade' }),
    stepId: uuid('step_id').notNull().references(() => campaignSteps.id, { onDelete: 'cascade' }),
    workspaceId: uuid('workspace_id').notNull().references(() => workspaces.id),
    eventType: text('event_type').notNull(),
    metadata: jsonb('metadata').notNull().default({}),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  },
  table => ({
    campaignStepEventsStepTypeIdx: index('campaign_step_events_step_type_idx').on(table.stepId, table.eventType),
    campaignStepEventsEnrollmentIdx: index('campaign_step_events_enrollment_idx').on(table.enrollmentId),
  }),
);

export const productTours = pgTable(
  'product_tours',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    workspaceId: uuid('workspace_id').notNull().references(() => workspaces.id),
    name: text('name').notNull(),
    description: text('description'),
    targetUrlPattern: text('target_url_pattern').notNull().default('*'),
    segmentQuery: jsonb('segment_query').notNull().default({}),
    isActive: boolean('is_active').notNull().default(false),
    priority: integer('priority').notNull().default(0),
    createdBy: uuid('created_by').references(() => users.id),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
  },
  table => ({
    productToursWsActiveIdx: index('product_tours_ws_active_idx').on(table.workspaceId, table.isActive),
  }),
);

export const productTourSteps = pgTable(
  'product_tour_steps',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    tourId: uuid('tour_id').notNull().references(() => productTours.id, { onDelete: 'cascade' }),
    workspaceId: uuid('workspace_id').notNull().references(() => workspaces.id),
    position: integer('position').notNull().default(0),
    targetSelector: text('target_selector').notNull(),
    title: text('title').notNull(),
    body: text('body').notNull().default(''),
    placement: tourStepPositionEnum('placement').notNull().default('bottom'),
    highlightTarget: boolean('highlight_target').notNull().default(true),
    actionLabel: text('action_label').notNull().default('Next'),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  },
  table => ({
    productTourStepsTourPosIdx: index('product_tour_steps_tour_pos_idx').on(table.tourId, table.position),
  }),
);

export const productTourProgress = pgTable(
  'product_tour_progress',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    tourId: uuid('tour_id').notNull().references(() => productTours.id, { onDelete: 'cascade' }),
    workspaceId: uuid('workspace_id').notNull().references(() => workspaces.id),
    customerId: uuid('customer_id').notNull().references(() => customers.id),
    currentStep: integer('current_step').notNull().default(0),
    status: text('status').notNull().default('in_progress'),
    startedAt: timestamp('started_at', { withTimezone: true }).defaultNow().notNull(),
    completedAt: timestamp('completed_at', { withTimezone: true }),
  },
  table => ({
    productTourProgressTourCustomerIdx: uniqueIndex('product_tour_progress_tour_customer_idx').on(table.tourId, table.customerId),
  }),
);

export const inAppMessages = pgTable(
  'in_app_messages',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    workspaceId: uuid('workspace_id').notNull().references(() => workspaces.id),
    name: text('name').notNull(),
    messageType: inAppMessageTypeEnum('message_type').notNull().default('banner'),
    title: text('title').notNull(),
    body: text('body').notNull().default(''),
    ctaText: text('cta_text'),
    ctaUrl: text('cta_url'),
    targetUrlPattern: text('target_url_pattern').notNull().default('*'),
    segmentQuery: jsonb('segment_query').notNull().default({}),
    isActive: boolean('is_active').notNull().default(false),
    priority: integer('priority').notNull().default(0),
    startAt: timestamp('start_at', { withTimezone: true }),
    endAt: timestamp('end_at', { withTimezone: true }),
    maxImpressions: integer('max_impressions').notNull().default(0),
    createdBy: uuid('created_by').references(() => users.id),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
  },
  table => ({
    inAppMessagesWsActiveIdx: index('in_app_messages_ws_active_idx').on(table.workspaceId, table.isActive),
  }),
);

export const inAppMessageImpressions = pgTable(
  'in_app_message_impressions',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    messageId: uuid('message_id').notNull().references(() => inAppMessages.id, { onDelete: 'cascade' }),
    workspaceId: uuid('workspace_id').notNull().references(() => workspaces.id),
    customerId: uuid('customer_id').notNull().references(() => customers.id),
    action: text('action').notNull().default('displayed'),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  },
  table => ({
    inAppMsgImpressionsMsgCustIdx: index('in_app_msg_impressions_msg_cust_idx').on(table.messageId, table.customerId),
    inAppMsgImpressionsCustIdx: index('in_app_msg_impressions_cust_idx').on(table.customerId),
  }),
);
