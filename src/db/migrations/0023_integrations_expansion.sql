-- Migration 0023: Integrations Expansion
-- Adds Jira/Linear engineering links, CRM deep sync, custom objects with relationships

-- 1. Integration credentials (secure storage for non-helpdesk integrations)
CREATE TABLE IF NOT EXISTS integration_credentials (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id UUID NOT NULL REFERENCES workspaces(id),
  provider TEXT NOT NULL, -- 'jira' | 'linear' | 'salesforce' | 'hubspot-crm' | 'github'
  auth_type TEXT NOT NULL, -- 'api_token' | 'oauth2' | 'pat'
  credentials JSONB NOT NULL DEFAULT '{}', -- { token, refreshToken, baseUrl, email, etc. }
  scopes TEXT[] DEFAULT '{}',
  expires_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS integration_creds_ws_provider_idx ON integration_credentials(workspace_id, provider);

-- 2. Ticket external links (Jira, Linear, GitHub issues)
CREATE TABLE IF NOT EXISTS ticket_external_links (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id UUID NOT NULL REFERENCES workspaces(id),
  ticket_id UUID NOT NULL REFERENCES tickets(id) ON DELETE CASCADE,
  provider TEXT NOT NULL, -- 'jira' | 'linear' | 'github'
  external_id TEXT NOT NULL, -- e.g. 'PROJ-123' or linear UUID
  external_url TEXT NOT NULL,
  external_status TEXT,
  external_title TEXT,
  direction TEXT NOT NULL DEFAULT 'outbound', -- 'outbound' | 'inbound' | 'bidirectional'
  metadata JSONB DEFAULT '{}',
  sync_enabled BOOLEAN NOT NULL DEFAULT true,
  last_synced_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS ticket_external_links_ticket_idx ON ticket_external_links(ticket_id);
CREATE UNIQUE INDEX IF NOT EXISTS ticket_external_links_external_idx ON ticket_external_links(workspace_id, provider, external_id);
CREATE INDEX IF NOT EXISTS ticket_external_links_workspace_idx ON ticket_external_links(workspace_id);

-- 3. External link comments (synced between CLIaaS and Jira/Linear)
CREATE TABLE IF NOT EXISTS external_link_comments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  link_id UUID NOT NULL REFERENCES ticket_external_links(id) ON DELETE CASCADE,
  workspace_id UUID REFERENCES workspaces(id),
  direction TEXT NOT NULL, -- 'to_external' | 'from_external'
  local_message_id UUID,
  external_comment_id TEXT,
  body TEXT NOT NULL,
  author_name TEXT,
  synced_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS external_link_comments_link_idx ON external_link_comments(link_id);

-- 4. CRM links (customers/orgs linked to Salesforce/HubSpot records)
CREATE TABLE IF NOT EXISTS crm_links (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id UUID NOT NULL REFERENCES workspaces(id),
  provider TEXT NOT NULL, -- 'salesforce' | 'hubspot-crm'
  entity_type TEXT NOT NULL, -- 'customer' | 'organization'
  entity_id UUID NOT NULL,
  crm_object_type TEXT NOT NULL, -- 'contact' | 'account' | 'opportunity' | 'deal' | 'company'
  crm_object_id TEXT NOT NULL,
  crm_object_url TEXT,
  crm_data JSONB DEFAULT '{}',
  last_synced_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS crm_links_entity_idx ON crm_links(entity_type, entity_id);
CREATE UNIQUE INDEX IF NOT EXISTS crm_links_external_idx ON crm_links(workspace_id, provider, crm_object_type, crm_object_id);
CREATE INDEX IF NOT EXISTS crm_links_workspace_idx ON crm_links(workspace_id);

-- 5. Custom object type definitions
CREATE TABLE IF NOT EXISTS custom_object_types (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id UUID NOT NULL REFERENCES workspaces(id),
  key TEXT NOT NULL, -- machine-readable slug e.g. 'subscription'
  name TEXT NOT NULL, -- human-readable e.g. 'Subscription'
  name_plural TEXT NOT NULL, -- e.g. 'Subscriptions'
  description TEXT,
  icon TEXT, -- optional emoji or icon key
  fields JSONB NOT NULL DEFAULT '[]', -- array of { key, name, type, required, options?, defaultValue? }
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS custom_object_types_key_idx ON custom_object_types(workspace_id, key);

-- 6. Custom object records (instances)
CREATE TABLE IF NOT EXISTS custom_object_records (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id UUID NOT NULL REFERENCES workspaces(id),
  type_id UUID NOT NULL REFERENCES custom_object_types(id) ON DELETE CASCADE,
  data JSONB NOT NULL DEFAULT '{}', -- field values keyed by field.key
  created_by UUID REFERENCES users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS custom_object_records_type_idx ON custom_object_records(type_id);
CREATE INDEX IF NOT EXISTS custom_object_records_workspace_idx ON custom_object_records(workspace_id);

-- 7. Custom object relationships (polymorphic links)
CREATE TABLE IF NOT EXISTS custom_object_relationships (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id UUID NOT NULL REFERENCES workspaces(id),
  source_type TEXT NOT NULL, -- 'custom_object' | 'ticket' | 'customer' | 'organization'
  source_id UUID NOT NULL,
  target_type TEXT NOT NULL,
  target_id UUID NOT NULL,
  relationship_type TEXT NOT NULL DEFAULT 'related', -- 'related' | 'parent' | 'child' | 'belongs_to'
  metadata JSONB DEFAULT '{}',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS custom_object_rels_source_idx ON custom_object_relationships(source_type, source_id);
CREATE INDEX IF NOT EXISTS custom_object_rels_target_idx ON custom_object_relationships(target_type, target_id);
CREATE UNIQUE INDEX IF NOT EXISTS custom_object_rels_dedup_idx ON custom_object_relationships(source_type, source_id, target_type, target_id);

-- RLS policies (workspace scoping)
ALTER TABLE integration_credentials ENABLE ROW LEVEL SECURITY;
ALTER TABLE ticket_external_links ENABLE ROW LEVEL SECURITY;
ALTER TABLE external_link_comments ENABLE ROW LEVEL SECURITY;
ALTER TABLE crm_links ENABLE ROW LEVEL SECURITY;
ALTER TABLE custom_object_types ENABLE ROW LEVEL SECURITY;
ALTER TABLE custom_object_records ENABLE ROW LEVEL SECURITY;
ALTER TABLE custom_object_relationships ENABLE ROW LEVEL SECURITY;

CREATE POLICY integration_credentials_workspace ON integration_credentials USING (workspace_id = current_setting('app.workspace_id')::uuid);
CREATE POLICY ticket_external_links_workspace ON ticket_external_links USING (workspace_id = current_setting('app.workspace_id')::uuid);
CREATE POLICY external_link_comments_workspace ON external_link_comments USING (workspace_id = current_setting('app.workspace_id')::uuid);
CREATE POLICY crm_links_workspace ON crm_links USING (workspace_id = current_setting('app.workspace_id')::uuid);
CREATE POLICY custom_object_types_workspace ON custom_object_types USING (workspace_id = current_setting('app.workspace_id')::uuid);
CREATE POLICY custom_object_records_workspace ON custom_object_records USING (workspace_id = current_setting('app.workspace_id')::uuid);
CREATE POLICY custom_object_relationships_workspace ON custom_object_relationships USING (workspace_id = current_setting('app.workspace_id')::uuid);
