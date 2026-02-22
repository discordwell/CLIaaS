import {
  pgTable,
  pgEnum,
  uuid,
  text,
  varchar,
  integer,
  boolean,
  jsonb,
  timestamp,
  primaryKey,
  uniqueIndex,
  index,
} from 'drizzle-orm/pg-core';

export const providerEnum = pgEnum('provider', [
  'zendesk',
  'kayako',
  'kayako-classic',
  'helpcrunch',
  'freshdesk',
  'groove',
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

export const channelTypeEnum = pgEnum('channel_type', [
  'email',
  'chat',
  'api',
  'sms',
  'phone',
  'web',
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

export const tenants = pgTable('tenants', {
  id: uuid('id').defaultRandom().primaryKey(),
  name: text('name').notNull(),
  plan: text('plan').notNull().default('free'),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
});

export const tenantsNameIdx = uniqueIndex('tenants_name_idx').on(tenants.name);

export const workspaces = pgTable('workspaces', {
  id: uuid('id').defaultRandom().primaryKey(),
  tenantId: uuid('tenant_id').notNull().references(() => tenants.id),
  name: text('name').notNull(),
  timezone: text('timezone').notNull().default('UTC'),
  defaultInboxId: uuid('default_inbox_id'),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
});

export const workspaceTenantNameIdx = uniqueIndex('workspaces_tenant_name_idx').on(
  workspaces.tenantId,
  workspaces.name,
);

export const users = pgTable('users', {
  id: uuid('id').defaultRandom().primaryKey(),
  workspaceId: uuid('workspace_id').notNull().references(() => workspaces.id),
  email: varchar('email', { length: 320 }),
  name: text('name').notNull(),
  role: userRoleEnum('role').notNull().default('agent'),
  status: userStatusEnum('status').notNull().default('active'),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
});

export const usersWorkspaceEmailIdx = uniqueIndex('users_workspace_email_idx').on(
  users.workspaceId,
  users.email,
);

export const organizations = pgTable('organizations', {
  id: uuid('id').defaultRandom().primaryKey(),
  workspaceId: uuid('workspace_id').notNull().references(() => workspaces.id),
  name: text('name').notNull(),
  domains: text('domains').array().notNull().default([]),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
});

export const organizationsWorkspaceNameIdx = uniqueIndex('orgs_workspace_name_idx').on(
  organizations.workspaceId,
  organizations.name,
);

export const customers = pgTable('customers', {
  id: uuid('id').defaultRandom().primaryKey(),
  workspaceId: uuid('workspace_id').notNull().references(() => workspaces.id),
  externalRef: text('external_ref'),
  name: text('name').notNull(),
  email: varchar('email', { length: 320 }),
  phone: text('phone'),
  orgId: uuid('org_id').references(() => organizations.id),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
});

export const customersWorkspaceEmailIdx = index('customers_workspace_email_idx').on(
  customers.workspaceId,
  customers.email,
);

export const groups = pgTable('groups', {
  id: uuid('id').defaultRandom().primaryKey(),
  workspaceId: uuid('workspace_id').notNull().references(() => workspaces.id),
  name: text('name').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
});

export const inboxes = pgTable('inboxes', {
  id: uuid('id').defaultRandom().primaryKey(),
  workspaceId: uuid('workspace_id').notNull().references(() => workspaces.id),
  name: text('name').notNull(),
  channelType: channelTypeEnum('channel_type').notNull().default('email'),
  address: text('address'),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
});

export const tickets = pgTable('tickets', {
  id: uuid('id').defaultRandom().primaryKey(),
  workspaceId: uuid('workspace_id').notNull().references(() => workspaces.id),
  requesterId: uuid('requester_id').references(() => customers.id),
  assigneeId: uuid('assignee_id').references(() => users.id),
  groupId: uuid('group_id').references(() => groups.id),
  inboxId: uuid('inbox_id').references(() => inboxes.id),
  subject: text('subject').notNull(),
  status: ticketStatusEnum('status').notNull().default('open'),
  priority: ticketPriorityEnum('priority').notNull().default('normal'),
  source: providerEnum('source').default('zendesk'),
  customFields: jsonb('custom_fields'),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
  closedAt: timestamp('closed_at', { withTimezone: true }),
});

export const ticketsWorkspaceStatusIdx = index('tickets_workspace_status_idx').on(
  tickets.workspaceId,
  tickets.status,
);

export const conversations = pgTable('conversations', {
  id: uuid('id').defaultRandom().primaryKey(),
  ticketId: uuid('ticket_id').notNull().references(() => tickets.id),
  channelType: channelTypeEnum('channel_type').notNull().default('email'),
  startedAt: timestamp('started_at', { withTimezone: true }).defaultNow().notNull(),
  lastActivityAt: timestamp('last_activity_at', { withTimezone: true }).defaultNow().notNull(),
});

export const conversationsTicketIdx = uniqueIndex('conversations_ticket_idx').on(
  conversations.ticketId,
);

export const messages = pgTable('messages', {
  id: uuid('id').defaultRandom().primaryKey(),
  conversationId: uuid('conversation_id').notNull().references(() => conversations.id),
  authorType: messageAuthorEnum('author_type').notNull().default('customer'),
  authorId: uuid('author_id'),
  body: text('body').notNull(),
  bodyHtml: text('body_html'),
  visibility: messageVisibilityEnum('visibility').notNull().default('public'),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
});

export const messagesConversationIdx = index('messages_conversation_idx').on(
  messages.conversationId,
  messages.createdAt,
);

export const attachments = pgTable('attachments', {
  id: uuid('id').defaultRandom().primaryKey(),
  messageId: uuid('message_id').notNull().references(() => messages.id),
  filename: text('filename').notNull(),
  size: integer('size').notNull().default(0),
  contentType: text('content_type'),
  storageKey: text('storage_key'),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
});

export const tags = pgTable('tags', {
  id: uuid('id').defaultRandom().primaryKey(),
  workspaceId: uuid('workspace_id').notNull().references(() => workspaces.id),
  name: text('name').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
});

export const tagsWorkspaceNameIdx = uniqueIndex('tags_workspace_name_idx').on(
  tags.workspaceId,
  tags.name,
);

export const ticketTags = pgTable(
  'ticket_tags',
  {
    ticketId: uuid('ticket_id').notNull().references(() => tickets.id),
    tagId: uuid('tag_id').notNull().references(() => tags.id),
  },
  table => ({
    pk: primaryKey({ columns: [table.ticketId, table.tagId] }),
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
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
});

export const customFieldValues = pgTable(
  'custom_field_values',
  {
    objectType: text('object_type').notNull(),
    objectId: uuid('object_id').notNull(),
    fieldId: uuid('field_id').notNull().references(() => customFields.id),
    value: jsonb('value'),
  },
  table => ({
    pk: primaryKey({ columns: [table.objectType, table.objectId, table.fieldId] }),
  }),
);

export const rules = pgTable('rules', {
  id: uuid('id').defaultRandom().primaryKey(),
  workspaceId: uuid('workspace_id').notNull().references(() => workspaces.id),
  type: ruleTypeEnum('type').notNull(),
  name: text('name').notNull(),
  enabled: boolean('enabled').notNull().default(true),
  conditions: jsonb('conditions'),
  actions: jsonb('actions'),
  source: providerEnum('source').default('zendesk'),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
});

export const slaPolicies = pgTable('sla_policies', {
  id: uuid('id').defaultRandom().primaryKey(),
  workspaceId: uuid('workspace_id').notNull().references(() => workspaces.id),
  name: text('name').notNull(),
  enabled: boolean('enabled').notNull().default(true),
  targets: jsonb('targets'),
  schedules: jsonb('schedules'),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
});

export const slaEvents = pgTable('sla_events', {
  id: uuid('id').defaultRandom().primaryKey(),
  ticketId: uuid('ticket_id').notNull().references(() => tickets.id),
  policyId: uuid('policy_id').notNull().references(() => slaPolicies.id),
  metric: text('metric').notNull(),
  dueAt: timestamp('due_at', { withTimezone: true }).notNull(),
  breachedAt: timestamp('breached_at', { withTimezone: true }),
});

export const views = pgTable('views', {
  id: uuid('id').defaultRandom().primaryKey(),
  workspaceId: uuid('workspace_id').notNull().references(() => workspaces.id),
  name: text('name').notNull(),
  query: jsonb('query').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
});

export const csatRatings = pgTable('csat_ratings', {
  id: uuid('id').defaultRandom().primaryKey(),
  ticketId: uuid('ticket_id').notNull().references(() => tickets.id),
  rating: integer('rating').notNull(),
  comment: text('comment'),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
});

export const timeEntries = pgTable('time_entries', {
  id: uuid('id').defaultRandom().primaryKey(),
  ticketId: uuid('ticket_id').notNull().references(() => tickets.id),
  userId: uuid('user_id').references(() => users.id),
  minutes: integer('minutes').notNull().default(0),
  note: text('note'),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
});

export const kbCollections = pgTable('kb_collections', {
  id: uuid('id').defaultRandom().primaryKey(),
  workspaceId: uuid('workspace_id').notNull().references(() => workspaces.id),
  name: text('name').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
});

export const kbCategories = pgTable('kb_categories', {
  id: uuid('id').defaultRandom().primaryKey(),
  collectionId: uuid('collection_id').references(() => kbCollections.id),
  name: text('name').notNull(),
  parentId: uuid('parent_id'),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
});

export const kbArticles = pgTable('kb_articles', {
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
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
});

export const kbRevisions = pgTable('kb_revisions', {
  id: uuid('id').defaultRandom().primaryKey(),
  articleId: uuid('article_id').notNull().references(() => kbArticles.id),
  body: text('body').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
});

export const integrations = pgTable('integrations', {
  id: uuid('id').defaultRandom().primaryKey(),
  workspaceId: uuid('workspace_id').notNull().references(() => workspaces.id),
  provider: providerEnum('provider').notNull(),
  status: integrationStatusEnum('status').notNull().default('active'),
  credentialsRef: text('credentials_ref'),
  metadata: jsonb('metadata'),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
});

export const integrationsWorkspaceProviderIdx = uniqueIndex('integrations_workspace_provider_idx').on(
  integrations.workspaceId,
  integrations.provider,
);

export const externalObjects = pgTable('external_objects', {
  id: uuid('id').defaultRandom().primaryKey(),
  integrationId: uuid('integration_id').notNull().references(() => integrations.id),
  objectType: text('object_type').notNull(),
  externalId: text('external_id').notNull(),
  internalId: uuid('internal_id').notNull(),
  checksum: text('checksum'),
  lastSeenAt: timestamp('last_seen_at', { withTimezone: true }).defaultNow().notNull(),
});

export const externalObjectsUniqueIdx = uniqueIndex('external_objects_unique_idx').on(
  externalObjects.integrationId,
  externalObjects.objectType,
  externalObjects.externalId,
);

export const syncCursors = pgTable('sync_cursors', {
  id: uuid('id').defaultRandom().primaryKey(),
  integrationId: uuid('integration_id').notNull().references(() => integrations.id),
  objectType: text('object_type').notNull(),
  cursor: text('cursor').notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
});

export const syncCursorsUniqueIdx = uniqueIndex('sync_cursors_unique_idx').on(
  syncCursors.integrationId,
  syncCursors.objectType,
);

export const importJobs = pgTable('import_jobs', {
  id: uuid('id').defaultRandom().primaryKey(),
  integrationId: uuid('integration_id').notNull().references(() => integrations.id),
  status: jobStatusEnum('status').notNull().default('queued'),
  startedAt: timestamp('started_at', { withTimezone: true }),
  finishedAt: timestamp('finished_at', { withTimezone: true }),
  error: text('error'),
});

export const exportJobs = pgTable('export_jobs', {
  id: uuid('id').defaultRandom().primaryKey(),
  integrationId: uuid('integration_id').notNull().references(() => integrations.id),
  status: jobStatusEnum('status').notNull().default('queued'),
  startedAt: timestamp('started_at', { withTimezone: true }),
  finishedAt: timestamp('finished_at', { withTimezone: true }),
  error: text('error'),
});

export const rawRecords = pgTable('raw_records', {
  id: uuid('id').defaultRandom().primaryKey(),
  integrationId: uuid('integration_id').notNull().references(() => integrations.id),
  objectType: text('object_type').notNull(),
  externalId: text('external_id'),
  payload: jsonb('payload').notNull(),
  receivedAt: timestamp('received_at', { withTimezone: true }).defaultNow().notNull(),
});

export const rawRecordsUniqueIdx = uniqueIndex('raw_records_unique_idx').on(
  rawRecords.integrationId,
  rawRecords.objectType,
  rawRecords.externalId,
);

export const auditEvents = pgTable('audit_events', {
  id: uuid('id').defaultRandom().primaryKey(),
  workspaceId: uuid('workspace_id').notNull().references(() => workspaces.id),
  actorType: text('actor_type').notNull(),
  actorId: uuid('actor_id'),
  action: text('action').notNull(),
  objectType: text('object_type').notNull(),
  objectId: uuid('object_id'),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  diff: jsonb('diff'),
});
