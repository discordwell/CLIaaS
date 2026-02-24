import {
  pgTable,
  pgEnum,
  uuid,
  text,
  varchar,
  integer,
  bigint,
  boolean,
  jsonb,
  timestamp,
  primaryKey,
  uniqueIndex,
  index,
  inet,
  customType,
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
    plan: text('plan').notNull().default('free'),
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
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
  },
  table => ({
    brandsWorkspaceNameIdx: uniqueIndex('brands_workspace_name_idx').on(
      table.workspaceId,
      table.name,
    ),
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
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
    closedAt: timestamp('closed_at', { withTimezone: true }),
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
  }),
);

export const conversations = pgTable(
  'conversations',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    ticketId: uuid('ticket_id').notNull().references(() => tickets.id),
    workspaceId: uuid('workspace_id').references(() => workspaces.id),
    channelType: channelTypeEnum('channel_type').notNull().default('email'),
    startedAt: timestamp('started_at', { withTimezone: true }).defaultNow().notNull(),
    lastActivityAt: timestamp('last_activity_at', { withTimezone: true }).defaultNow().notNull(),
  },
  table => ({
    conversationsTicketIdx: uniqueIndex('conversations_ticket_idx').on(table.ticketId),
    conversationsWorkspaceIdx: index('conversations_workspace_idx').on(table.workspaceId),
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
    visibility: messageVisibilityEnum('visibility').notNull().default('public'),
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

export const tags = pgTable(
  'tags',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    workspaceId: uuid('workspace_id').notNull().references(() => workspaces.id),
    name: text('name').notNull(),
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
  priority: ticketPriorityEnum('priority'),
  responseTime: integer('response_time'),
  resolutionTime: integer('resolution_time'),
  enabled: boolean('enabled').notNull().default(true),
  targets: jsonb('targets'),
  schedules: jsonb('schedules'),
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
  name: text('name').notNull(),
  query: jsonb('query').notNull(),
  active: boolean('active').notNull().default(true),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
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
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  },
  table => ({
    kbCategoriesWorkspaceIdx: index('kb_categories_workspace_idx').on(table.workspaceId),
  }),
);

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

// ---- Automation Rules ----

export const automationRules = pgTable(
  'automation_rules',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    workspaceId: uuid('workspace_id').notNull().references(() => workspaces.id),
    name: text('name').notNull(),
    description: text('description'),
    conditions: jsonb('conditions'),
    actions: jsonb('actions'),
    enabled: boolean('enabled').notNull().default(true),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
  },
  table => ({
    automationRulesWorkspaceIdx: index('automation_rules_workspace_idx').on(
      table.workspaceId,
    ),
    automationRulesEnabledIdx: index('automation_rules_enabled_idx').on(
      table.workspaceId,
      table.enabled,
    ),
  }),
);

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
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
  },
  table => ({
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
