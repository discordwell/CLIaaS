-- Migration 0026: RLS Big-Bang — Workspace Scoping
-- Fixes broken policies, adds missing FORCE RLS, enables RLS on all workspace-scoped tables,
-- and denormalizes workspace_id into 8 child tables.

-- ============================================================
-- 2a. Fix broken policies (wrong setting name app.workspace_id → app.current_workspace_id)
-- ============================================================

-- From 0008: canned_responses, macros, agent_signatures
DROP POLICY IF EXISTS canned_responses_workspace_isolation ON canned_responses;
CREATE POLICY workspace_isolation ON canned_responses
  USING (workspace_id = current_setting('app.current_workspace_id', true)::uuid);

DROP POLICY IF EXISTS macros_workspace_isolation ON macros;
CREATE POLICY workspace_isolation ON macros
  USING (workspace_id = current_setting('app.current_workspace_id', true)::uuid);

DROP POLICY IF EXISTS agent_signatures_workspace_isolation ON agent_signatures;
CREATE POLICY workspace_isolation ON agent_signatures
  USING (workspace_id = current_setting('app.current_workspace_id', true)::uuid);

-- From 0009: ticket_merge_log, ticket_split_log
DROP POLICY IF EXISTS ticket_merge_log_workspace_isolation ON ticket_merge_log;
CREATE POLICY workspace_isolation ON ticket_merge_log
  USING (workspace_id = current_setting('app.current_workspace_id', true)::uuid);

DROP POLICY IF EXISTS ticket_split_log_workspace_isolation ON ticket_split_log;
CREATE POLICY workspace_isolation ON ticket_split_log
  USING (workspace_id = current_setting('app.current_workspace_id', true)::uuid);

-- From 0012: holiday_calendars
DROP POLICY IF EXISTS holiday_calendars_workspace_isolation ON holiday_calendars;
CREATE POLICY workspace_isolation ON holiday_calendars
  USING (workspace_id = current_setting('app.current_workspace_id', true)::uuid);

-- From 0017: group_memberships, ticket_collaborators
DROP POLICY IF EXISTS group_memberships_workspace_isolation ON group_memberships;
CREATE POLICY workspace_isolation ON group_memberships
  USING (workspace_id = current_setting('app.current_workspace_id', true)::uuid);

DROP POLICY IF EXISTS ticket_collaborators_workspace_isolation ON ticket_collaborators;
CREATE POLICY workspace_isolation ON ticket_collaborators
  USING (workspace_id = current_setting('app.current_workspace_id', true)::uuid);

-- From 0018: custom_roles
DROP POLICY IF EXISTS custom_roles_workspace_isolation ON custom_roles;
CREATE POLICY workspace_isolation ON custom_roles
  USING (workspace_id = current_setting('app.current_workspace_id', true)::uuid);

-- From 0023: integration_credentials, ticket_external_links, external_link_comments,
--            crm_links, custom_object_types, custom_object_records, custom_object_relationships
DROP POLICY IF EXISTS integration_credentials_workspace ON integration_credentials;
CREATE POLICY workspace_isolation ON integration_credentials
  USING (workspace_id = current_setting('app.current_workspace_id', true)::uuid);

DROP POLICY IF EXISTS ticket_external_links_workspace ON ticket_external_links;
CREATE POLICY workspace_isolation ON ticket_external_links
  USING (workspace_id = current_setting('app.current_workspace_id', true)::uuid);

DROP POLICY IF EXISTS external_link_comments_workspace ON external_link_comments;
CREATE POLICY workspace_isolation ON external_link_comments
  USING (workspace_id = current_setting('app.current_workspace_id', true)::uuid);

DROP POLICY IF EXISTS crm_links_workspace ON crm_links;
CREATE POLICY workspace_isolation ON crm_links
  USING (workspace_id = current_setting('app.current_workspace_id', true)::uuid);

DROP POLICY IF EXISTS custom_object_types_workspace ON custom_object_types;
CREATE POLICY workspace_isolation ON custom_object_types
  USING (workspace_id = current_setting('app.current_workspace_id', true)::uuid);

DROP POLICY IF EXISTS custom_object_records_workspace ON custom_object_records;
CREATE POLICY workspace_isolation ON custom_object_records
  USING (workspace_id = current_setting('app.current_workspace_id', true)::uuid);

DROP POLICY IF EXISTS custom_object_relationships_workspace ON custom_object_relationships;
CREATE POLICY workspace_isolation ON custom_object_relationships
  USING (workspace_id = current_setting('app.current_workspace_id', true)::uuid);


-- ============================================================
-- 2b. Fix missing `true` default parameter (from 0022)
-- ============================================================

DROP POLICY IF EXISTS campaign_steps_tenant ON campaign_steps;
CREATE POLICY workspace_isolation ON campaign_steps
  USING (workspace_id = current_setting('app.current_workspace_id', true)::uuid);

DROP POLICY IF EXISTS campaign_enrollments_tenant ON campaign_enrollments;
CREATE POLICY workspace_isolation ON campaign_enrollments
  USING (workspace_id = current_setting('app.current_workspace_id', true)::uuid);

DROP POLICY IF EXISTS campaign_step_events_tenant ON campaign_step_events;
CREATE POLICY workspace_isolation ON campaign_step_events
  USING (workspace_id = current_setting('app.current_workspace_id', true)::uuid);

DROP POLICY IF EXISTS product_tours_tenant ON product_tours;
CREATE POLICY workspace_isolation ON product_tours
  USING (workspace_id = current_setting('app.current_workspace_id', true)::uuid);

DROP POLICY IF EXISTS product_tour_steps_tenant ON product_tour_steps;
CREATE POLICY workspace_isolation ON product_tour_steps
  USING (workspace_id = current_setting('app.current_workspace_id', true)::uuid);

DROP POLICY IF EXISTS product_tour_progress_tenant ON product_tour_progress;
CREATE POLICY workspace_isolation ON product_tour_progress
  USING (workspace_id = current_setting('app.current_workspace_id', true)::uuid);

DROP POLICY IF EXISTS in_app_messages_tenant ON in_app_messages;
CREATE POLICY workspace_isolation ON in_app_messages
  USING (workspace_id = current_setting('app.current_workspace_id', true)::uuid);

DROP POLICY IF EXISTS in_app_message_impressions_tenant ON in_app_message_impressions;
CREATE POLICY workspace_isolation ON in_app_message_impressions
  USING (workspace_id = current_setting('app.current_workspace_id', true)::uuid);


-- ============================================================
-- 2c. Add FORCE ROW LEVEL SECURITY to all tables that have ENABLE RLS
-- (No table from any migration has FORCE RLS — add it to all)
-- ============================================================

-- From 0008
ALTER TABLE canned_responses FORCE ROW LEVEL SECURITY;
ALTER TABLE macros FORCE ROW LEVEL SECURITY;
ALTER TABLE agent_signatures FORCE ROW LEVEL SECURITY;

-- From 0009
ALTER TABLE ticket_merge_log FORCE ROW LEVEL SECURITY;
ALTER TABLE ticket_split_log FORCE ROW LEVEL SECURITY;

-- From 0010
ALTER TABLE notifications FORCE ROW LEVEL SECURITY;
ALTER TABLE mentions FORCE ROW LEVEL SECURITY;

-- From 0012
ALTER TABLE holiday_calendars FORCE ROW LEVEL SECURITY;

-- From 0017
ALTER TABLE permissions FORCE ROW LEVEL SECURITY;
ALTER TABLE role_permissions FORCE ROW LEVEL SECURITY;
ALTER TABLE group_memberships FORCE ROW LEVEL SECURITY;
ALTER TABLE ticket_collaborators FORCE ROW LEVEL SECURITY;

-- From 0018
ALTER TABLE custom_roles FORCE ROW LEVEL SECURITY;
ALTER TABLE custom_role_permissions FORCE ROW LEVEL SECURITY;

-- From 0021
ALTER TABLE pii_detections FORCE ROW LEVEL SECURITY;
ALTER TABLE pii_redaction_log FORCE ROW LEVEL SECURITY;
ALTER TABLE pii_access_log FORCE ROW LEVEL SECURITY;
ALTER TABLE pii_scan_jobs FORCE ROW LEVEL SECURITY;
ALTER TABLE pii_sensitivity_rules FORCE ROW LEVEL SECURITY;
ALTER TABLE hipaa_baa_records FORCE ROW LEVEL SECURITY;

-- From 0022
ALTER TABLE campaign_steps FORCE ROW LEVEL SECURITY;
ALTER TABLE campaign_enrollments FORCE ROW LEVEL SECURITY;
ALTER TABLE campaign_step_events FORCE ROW LEVEL SECURITY;
ALTER TABLE product_tours FORCE ROW LEVEL SECURITY;
ALTER TABLE product_tour_steps FORCE ROW LEVEL SECURITY;
ALTER TABLE product_tour_progress FORCE ROW LEVEL SECURITY;
ALTER TABLE in_app_messages FORCE ROW LEVEL SECURITY;
ALTER TABLE in_app_message_impressions FORCE ROW LEVEL SECURITY;

-- From 0023
ALTER TABLE integration_credentials FORCE ROW LEVEL SECURITY;
ALTER TABLE ticket_external_links FORCE ROW LEVEL SECURITY;
ALTER TABLE external_link_comments FORCE ROW LEVEL SECURITY;
ALTER TABLE crm_links FORCE ROW LEVEL SECURITY;
ALTER TABLE custom_object_types FORCE ROW LEVEL SECURITY;
ALTER TABLE custom_object_records FORCE ROW LEVEL SECURITY;
ALTER TABLE custom_object_relationships FORCE ROW LEVEL SECURITY;


-- ============================================================
-- 2c-extra: Add missing policies for tables that have ENABLE RLS but no policy
-- ============================================================

-- notifications (from 0010 — has ENABLE RLS but no policy)
CREATE POLICY workspace_isolation ON notifications
  USING (workspace_id = current_setting('app.current_workspace_id', true)::uuid);

-- mentions (from 0010 — has ENABLE RLS but no policy)
CREATE POLICY workspace_isolation ON mentions
  USING (workspace_id = current_setting('app.current_workspace_id', true)::uuid);

-- role_permissions (from 0017 — has ENABLE RLS but no policy; uses workspace_id)
CREATE POLICY workspace_isolation ON role_permissions
  USING (workspace_id = current_setting('app.current_workspace_id', true)::uuid);


-- ============================================================
-- 2d. Add RLS to tables with workspace_id but zero RLS infrastructure
-- (ENABLE + FORCE + policy for each)
-- ============================================================

-- Core domain tables
ALTER TABLE tickets ENABLE ROW LEVEL SECURITY;
ALTER TABLE tickets FORCE ROW LEVEL SECURITY;
CREATE POLICY workspace_isolation ON tickets
  USING (workspace_id = current_setting('app.current_workspace_id', true)::uuid);

ALTER TABLE conversations ENABLE ROW LEVEL SECURITY;
ALTER TABLE conversations FORCE ROW LEVEL SECURITY;
CREATE POLICY workspace_isolation ON conversations
  USING (workspace_id = current_setting('app.current_workspace_id', true)::uuid);

ALTER TABLE messages ENABLE ROW LEVEL SECURITY;
ALTER TABLE messages FORCE ROW LEVEL SECURITY;
CREATE POLICY workspace_isolation ON messages
  USING (workspace_id = current_setting('app.current_workspace_id', true)::uuid);

ALTER TABLE attachments ENABLE ROW LEVEL SECURITY;
ALTER TABLE attachments FORCE ROW LEVEL SECURITY;
CREATE POLICY workspace_isolation ON attachments
  USING (workspace_id = current_setting('app.current_workspace_id', true)::uuid);

ALTER TABLE customers ENABLE ROW LEVEL SECURITY;
ALTER TABLE customers FORCE ROW LEVEL SECURITY;
CREATE POLICY workspace_isolation ON customers
  USING (workspace_id = current_setting('app.current_workspace_id', true)::uuid);

ALTER TABLE organizations ENABLE ROW LEVEL SECURITY;
ALTER TABLE organizations FORCE ROW LEVEL SECURITY;
CREATE POLICY workspace_isolation ON organizations
  USING (workspace_id = current_setting('app.current_workspace_id', true)::uuid);

ALTER TABLE groups ENABLE ROW LEVEL SECURITY;
ALTER TABLE groups FORCE ROW LEVEL SECURITY;
CREATE POLICY workspace_isolation ON groups
  USING (workspace_id = current_setting('app.current_workspace_id', true)::uuid);

ALTER TABLE inboxes ENABLE ROW LEVEL SECURITY;
ALTER TABLE inboxes FORCE ROW LEVEL SECURITY;
CREATE POLICY workspace_isolation ON inboxes
  USING (workspace_id = current_setting('app.current_workspace_id', true)::uuid);

ALTER TABLE ticket_forms ENABLE ROW LEVEL SECURITY;
ALTER TABLE ticket_forms FORCE ROW LEVEL SECURITY;
CREATE POLICY workspace_isolation ON ticket_forms
  USING (workspace_id = current_setting('app.current_workspace_id', true)::uuid);

ALTER TABLE brands ENABLE ROW LEVEL SECURITY;
ALTER TABLE brands FORCE ROW LEVEL SECURITY;
CREATE POLICY workspace_isolation ON brands
  USING (workspace_id = current_setting('app.current_workspace_id', true)::uuid);

ALTER TABLE tags ENABLE ROW LEVEL SECURITY;
ALTER TABLE tags FORCE ROW LEVEL SECURITY;
CREATE POLICY workspace_isolation ON tags
  USING (workspace_id = current_setting('app.current_workspace_id', true)::uuid);

ALTER TABLE ticket_tags ENABLE ROW LEVEL SECURITY;
ALTER TABLE ticket_tags FORCE ROW LEVEL SECURITY;
CREATE POLICY workspace_isolation ON ticket_tags
  USING (workspace_id = current_setting('app.current_workspace_id', true)::uuid);

ALTER TABLE custom_fields ENABLE ROW LEVEL SECURITY;
ALTER TABLE custom_fields FORCE ROW LEVEL SECURITY;
CREATE POLICY workspace_isolation ON custom_fields
  USING (workspace_id = current_setting('app.current_workspace_id', true)::uuid);

ALTER TABLE custom_field_values ENABLE ROW LEVEL SECURITY;
ALTER TABLE custom_field_values FORCE ROW LEVEL SECURITY;
CREATE POLICY workspace_isolation ON custom_field_values
  USING (workspace_id = current_setting('app.current_workspace_id', true)::uuid);

ALTER TABLE rules ENABLE ROW LEVEL SECURITY;
ALTER TABLE rules FORCE ROW LEVEL SECURITY;
CREATE POLICY workspace_isolation ON rules
  USING (workspace_id = current_setting('app.current_workspace_id', true)::uuid);

ALTER TABLE rule_executions ENABLE ROW LEVEL SECURITY;
ALTER TABLE rule_executions FORCE ROW LEVEL SECURITY;
CREATE POLICY workspace_isolation ON rule_executions
  USING (workspace_id = current_setting('app.current_workspace_id', true)::uuid);

ALTER TABLE sla_policies ENABLE ROW LEVEL SECURITY;
ALTER TABLE sla_policies FORCE ROW LEVEL SECURITY;
CREATE POLICY workspace_isolation ON sla_policies
  USING (workspace_id = current_setting('app.current_workspace_id', true)::uuid);

ALTER TABLE sla_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE sla_events FORCE ROW LEVEL SECURITY;
CREATE POLICY workspace_isolation ON sla_events
  USING (workspace_id = current_setting('app.current_workspace_id', true)::uuid);

ALTER TABLE views ENABLE ROW LEVEL SECURITY;
ALTER TABLE views FORCE ROW LEVEL SECURITY;
CREATE POLICY workspace_isolation ON views
  USING (workspace_id = current_setting('app.current_workspace_id', true)::uuid);

ALTER TABLE csat_ratings ENABLE ROW LEVEL SECURITY;
ALTER TABLE csat_ratings FORCE ROW LEVEL SECURITY;
CREATE POLICY workspace_isolation ON csat_ratings
  USING (workspace_id = current_setting('app.current_workspace_id', true)::uuid);

ALTER TABLE time_entries ENABLE ROW LEVEL SECURITY;
ALTER TABLE time_entries FORCE ROW LEVEL SECURITY;
CREATE POLICY workspace_isolation ON time_entries
  USING (workspace_id = current_setting('app.current_workspace_id', true)::uuid);

-- KB tables
ALTER TABLE kb_collections ENABLE ROW LEVEL SECURITY;
ALTER TABLE kb_collections FORCE ROW LEVEL SECURITY;
CREATE POLICY workspace_isolation ON kb_collections
  USING (workspace_id = current_setting('app.current_workspace_id', true)::uuid);

ALTER TABLE kb_categories ENABLE ROW LEVEL SECURITY;
ALTER TABLE kb_categories FORCE ROW LEVEL SECURITY;
CREATE POLICY workspace_isolation ON kb_categories
  USING (workspace_id = current_setting('app.current_workspace_id', true)::uuid);

ALTER TABLE kb_articles ENABLE ROW LEVEL SECURITY;
ALTER TABLE kb_articles FORCE ROW LEVEL SECURITY;
CREATE POLICY workspace_isolation ON kb_articles
  USING (workspace_id = current_setting('app.current_workspace_id', true)::uuid);

ALTER TABLE kb_revisions ENABLE ROW LEVEL SECURITY;
ALTER TABLE kb_revisions FORCE ROW LEVEL SECURITY;
CREATE POLICY workspace_isolation ON kb_revisions
  USING (workspace_id = current_setting('app.current_workspace_id', true)::uuid);

ALTER TABLE kb_article_feedback ENABLE ROW LEVEL SECURITY;
ALTER TABLE kb_article_feedback FORCE ROW LEVEL SECURITY;
CREATE POLICY workspace_isolation ON kb_article_feedback
  USING (workspace_id = current_setting('app.current_workspace_id', true)::uuid);

ALTER TABLE kb_deflections ENABLE ROW LEVEL SECURITY;
ALTER TABLE kb_deflections FORCE ROW LEVEL SECURITY;
CREATE POLICY workspace_isolation ON kb_deflections
  USING (workspace_id = current_setting('app.current_workspace_id', true)::uuid);

ALTER TABLE kb_content_gaps ENABLE ROW LEVEL SECURITY;
ALTER TABLE kb_content_gaps FORCE ROW LEVEL SECURITY;
CREATE POLICY workspace_isolation ON kb_content_gaps
  USING (workspace_id = current_setting('app.current_workspace_id', true)::uuid);

-- Integration / sync tables
ALTER TABLE integrations ENABLE ROW LEVEL SECURITY;
ALTER TABLE integrations FORCE ROW LEVEL SECURITY;
CREATE POLICY workspace_isolation ON integrations
  USING (workspace_id = current_setting('app.current_workspace_id', true)::uuid);

ALTER TABLE external_objects ENABLE ROW LEVEL SECURITY;
ALTER TABLE external_objects FORCE ROW LEVEL SECURITY;
CREATE POLICY workspace_isolation ON external_objects
  USING (workspace_id = current_setting('app.current_workspace_id', true)::uuid);

ALTER TABLE sync_cursors ENABLE ROW LEVEL SECURITY;
ALTER TABLE sync_cursors FORCE ROW LEVEL SECURITY;
CREATE POLICY workspace_isolation ON sync_cursors
  USING (workspace_id = current_setting('app.current_workspace_id', true)::uuid);

ALTER TABLE import_jobs ENABLE ROW LEVEL SECURITY;
ALTER TABLE import_jobs FORCE ROW LEVEL SECURITY;
CREATE POLICY workspace_isolation ON import_jobs
  USING (workspace_id = current_setting('app.current_workspace_id', true)::uuid);

ALTER TABLE export_jobs ENABLE ROW LEVEL SECURITY;
ALTER TABLE export_jobs FORCE ROW LEVEL SECURITY;
CREATE POLICY workspace_isolation ON export_jobs
  USING (workspace_id = current_setting('app.current_workspace_id', true)::uuid);

ALTER TABLE raw_records ENABLE ROW LEVEL SECURITY;
ALTER TABLE raw_records FORCE ROW LEVEL SECURITY;
CREATE POLICY workspace_isolation ON raw_records
  USING (workspace_id = current_setting('app.current_workspace_id', true)::uuid);

-- Audit / SSO
ALTER TABLE audit_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE audit_events FORCE ROW LEVEL SECURITY;
CREATE POLICY workspace_isolation ON audit_events
  USING (workspace_id = current_setting('app.current_workspace_id', true)::uuid);

ALTER TABLE audit_entries ENABLE ROW LEVEL SECURITY;
ALTER TABLE audit_entries FORCE ROW LEVEL SECURITY;
CREATE POLICY workspace_isolation ON audit_entries
  USING (workspace_id = current_setting('app.current_workspace_id', true)::uuid);

ALTER TABLE sso_providers ENABLE ROW LEVEL SECURITY;
ALTER TABLE sso_providers FORCE ROW LEVEL SECURITY;
CREATE POLICY workspace_isolation ON sso_providers
  USING (workspace_id = current_setting('app.current_workspace_id', true)::uuid);

-- API keys
ALTER TABLE api_keys ENABLE ROW LEVEL SECURITY;
ALTER TABLE api_keys FORCE ROW LEVEL SECURITY;
CREATE POLICY workspace_isolation ON api_keys
  USING (workspace_id = current_setting('app.current_workspace_id', true)::uuid);

-- Sync tables
ALTER TABLE sync_outbox ENABLE ROW LEVEL SECURITY;
ALTER TABLE sync_outbox FORCE ROW LEVEL SECURITY;
CREATE POLICY workspace_isolation ON sync_outbox
  USING (workspace_id = current_setting('app.current_workspace_id', true)::uuid);

ALTER TABLE sync_conflicts ENABLE ROW LEVEL SECURITY;
ALTER TABLE sync_conflicts FORCE ROW LEVEL SECURITY;
CREATE POLICY workspace_isolation ON sync_conflicts
  USING (workspace_id = current_setting('app.current_workspace_id', true)::uuid);

ALTER TABLE sync_health ENABLE ROW LEVEL SECURITY;
ALTER TABLE sync_health FORCE ROW LEVEL SECURITY;
CREATE POLICY workspace_isolation ON sync_health
  USING (workspace_id = current_setting('app.current_workspace_id', true)::uuid);

ALTER TABLE upstream_outbox ENABLE ROW LEVEL SECURITY;
ALTER TABLE upstream_outbox FORCE ROW LEVEL SECURITY;
CREATE POLICY workspace_isolation ON upstream_outbox
  USING (workspace_id = current_setting('app.current_workspace_id', true)::uuid);

-- Survey tables
ALTER TABLE survey_responses ENABLE ROW LEVEL SECURITY;
ALTER TABLE survey_responses FORCE ROW LEVEL SECURITY;
CREATE POLICY workspace_isolation ON survey_responses
  USING (workspace_id = current_setting('app.current_workspace_id', true)::uuid);

ALTER TABLE survey_configs ENABLE ROW LEVEL SECURITY;
ALTER TABLE survey_configs FORCE ROW LEVEL SECURITY;
CREATE POLICY workspace_isolation ON survey_configs
  USING (workspace_id = current_setting('app.current_workspace_id', true)::uuid);

-- Ticket events
ALTER TABLE ticket_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE ticket_events FORCE ROW LEVEL SECURITY;
CREATE POLICY workspace_isolation ON ticket_events
  USING (workspace_id = current_setting('app.current_workspace_id', true)::uuid);

-- Chatbot tables
ALTER TABLE chatbots ENABLE ROW LEVEL SECURITY;
ALTER TABLE chatbots FORCE ROW LEVEL SECURITY;
CREATE POLICY workspace_isolation ON chatbots
  USING (workspace_id = current_setting('app.current_workspace_id', true)::uuid);

ALTER TABLE chatbot_sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE chatbot_sessions FORCE ROW LEVEL SECURITY;
CREATE POLICY workspace_isolation ON chatbot_sessions
  USING (workspace_id = current_setting('app.current_workspace_id', true)::uuid);

-- Workflow table
ALTER TABLE workflows ENABLE ROW LEVEL SECURITY;
ALTER TABLE workflows FORCE ROW LEVEL SECURITY;
CREATE POLICY workspace_isolation ON workflows
  USING (workspace_id = current_setting('app.current_workspace_id', true)::uuid);

-- GDPR / retention
ALTER TABLE gdpr_deletion_requests ENABLE ROW LEVEL SECURITY;
ALTER TABLE gdpr_deletion_requests FORCE ROW LEVEL SECURITY;
CREATE POLICY workspace_isolation ON gdpr_deletion_requests
  USING (workspace_id = current_setting('app.current_workspace_id', true)::uuid);

ALTER TABLE retention_policies ENABLE ROW LEVEL SECURITY;
ALTER TABLE retention_policies FORCE ROW LEVEL SECURITY;
CREATE POLICY workspace_isolation ON retention_policies
  USING (workspace_id = current_setting('app.current_workspace_id', true)::uuid);

-- Customer tables
ALTER TABLE customer_activities ENABLE ROW LEVEL SECURITY;
ALTER TABLE customer_activities FORCE ROW LEVEL SECURITY;
CREATE POLICY workspace_isolation ON customer_activities
  USING (workspace_id = current_setting('app.current_workspace_id', true)::uuid);

ALTER TABLE customer_notes ENABLE ROW LEVEL SECURITY;
ALTER TABLE customer_notes FORCE ROW LEVEL SECURITY;
CREATE POLICY workspace_isolation ON customer_notes
  USING (workspace_id = current_setting('app.current_workspace_id', true)::uuid);

ALTER TABLE customer_segments ENABLE ROW LEVEL SECURITY;
ALTER TABLE customer_segments FORCE ROW LEVEL SECURITY;
CREATE POLICY workspace_isolation ON customer_segments
  USING (workspace_id = current_setting('app.current_workspace_id', true)::uuid);

ALTER TABLE customer_merge_log ENABLE ROW LEVEL SECURITY;
ALTER TABLE customer_merge_log FORCE ROW LEVEL SECURITY;
CREATE POLICY workspace_isolation ON customer_merge_log
  USING (workspace_id = current_setting('app.current_workspace_id', true)::uuid);

ALTER TABLE customer_health_scores ENABLE ROW LEVEL SECURITY;
ALTER TABLE customer_health_scores FORCE ROW LEVEL SECURITY;
CREATE POLICY workspace_isolation ON customer_health_scores
  USING (workspace_id = current_setting('app.current_workspace_id', true)::uuid);

-- Forum tables
ALTER TABLE forum_categories ENABLE ROW LEVEL SECURITY;
ALTER TABLE forum_categories FORCE ROW LEVEL SECURITY;
CREATE POLICY workspace_isolation ON forum_categories
  USING (workspace_id = current_setting('app.current_workspace_id', true)::uuid);

ALTER TABLE forum_threads ENABLE ROW LEVEL SECURITY;
ALTER TABLE forum_threads FORCE ROW LEVEL SECURITY;
CREATE POLICY workspace_isolation ON forum_threads
  USING (workspace_id = current_setting('app.current_workspace_id', true)::uuid);

ALTER TABLE forum_replies ENABLE ROW LEVEL SECURITY;
ALTER TABLE forum_replies FORCE ROW LEVEL SECURITY;
CREATE POLICY workspace_isolation ON forum_replies
  USING (workspace_id = current_setting('app.current_workspace_id', true)::uuid);

-- QA tables
ALTER TABLE qa_scorecards ENABLE ROW LEVEL SECURITY;
ALTER TABLE qa_scorecards FORCE ROW LEVEL SECURITY;
CREATE POLICY workspace_isolation ON qa_scorecards
  USING (workspace_id = current_setting('app.current_workspace_id', true)::uuid);

ALTER TABLE qa_reviews ENABLE ROW LEVEL SECURITY;
ALTER TABLE qa_reviews FORCE ROW LEVEL SECURITY;
CREATE POLICY workspace_isolation ON qa_reviews
  USING (workspace_id = current_setting('app.current_workspace_id', true)::uuid);

ALTER TABLE autoqa_configs ENABLE ROW LEVEL SECURITY;
ALTER TABLE autoqa_configs FORCE ROW LEVEL SECURITY;
CREATE POLICY workspace_isolation ON autoqa_configs
  USING (workspace_id = current_setting('app.current_workspace_id', true)::uuid);

ALTER TABLE qa_flags ENABLE ROW LEVEL SECURITY;
ALTER TABLE qa_flags FORCE ROW LEVEL SECURITY;
CREATE POLICY workspace_isolation ON qa_flags
  USING (workspace_id = current_setting('app.current_workspace_id', true)::uuid);

ALTER TABLE qa_coaching_assignments ENABLE ROW LEVEL SECURITY;
ALTER TABLE qa_coaching_assignments FORCE ROW LEVEL SECURITY;
CREATE POLICY workspace_isolation ON qa_coaching_assignments
  USING (workspace_id = current_setting('app.current_workspace_id', true)::uuid);

ALTER TABLE csat_predictions ENABLE ROW LEVEL SECURITY;
ALTER TABLE csat_predictions FORCE ROW LEVEL SECURITY;
CREATE POLICY workspace_isolation ON csat_predictions
  USING (workspace_id = current_setting('app.current_workspace_id', true)::uuid);

ALTER TABLE qa_calibration_sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE qa_calibration_sessions FORCE ROW LEVEL SECURITY;
CREATE POLICY workspace_isolation ON qa_calibration_sessions
  USING (workspace_id = current_setting('app.current_workspace_id', true)::uuid);

-- Campaign tables
ALTER TABLE campaigns ENABLE ROW LEVEL SECURITY;
ALTER TABLE campaigns FORCE ROW LEVEL SECURITY;
CREATE POLICY workspace_isolation ON campaigns
  USING (workspace_id = current_setting('app.current_workspace_id', true)::uuid);

ALTER TABLE campaign_recipients ENABLE ROW LEVEL SECURITY;
ALTER TABLE campaign_recipients FORCE ROW LEVEL SECURITY;
CREATE POLICY workspace_isolation ON campaign_recipients
  USING (workspace_id = current_setting('app.current_workspace_id', true)::uuid);

-- Channel config tables
ALTER TABLE telegram_bot_configs ENABLE ROW LEVEL SECURITY;
ALTER TABLE telegram_bot_configs FORCE ROW LEVEL SECURITY;
CREATE POLICY workspace_isolation ON telegram_bot_configs
  USING (workspace_id = current_setting('app.current_workspace_id', true)::uuid);

ALTER TABLE slack_channel_mappings ENABLE ROW LEVEL SECURITY;
ALTER TABLE slack_channel_mappings FORCE ROW LEVEL SECURITY;
CREATE POLICY workspace_isolation ON slack_channel_mappings
  USING (workspace_id = current_setting('app.current_workspace_id', true)::uuid);

ALTER TABLE teams_channel_mappings ENABLE ROW LEVEL SECURITY;
ALTER TABLE teams_channel_mappings FORCE ROW LEVEL SECURITY;
CREATE POLICY workspace_isolation ON teams_channel_mappings
  USING (workspace_id = current_setting('app.current_workspace_id', true)::uuid);

-- Plugin tables
ALTER TABLE plugin_installations ENABLE ROW LEVEL SECURITY;
ALTER TABLE plugin_installations FORCE ROW LEVEL SECURITY;
CREATE POLICY workspace_isolation ON plugin_installations
  USING (workspace_id = current_setting('app.current_workspace_id', true)::uuid);

ALTER TABLE plugin_hook_registrations ENABLE ROW LEVEL SECURITY;
ALTER TABLE plugin_hook_registrations FORCE ROW LEVEL SECURITY;
CREATE POLICY workspace_isolation ON plugin_hook_registrations
  USING (workspace_id = current_setting('app.current_workspace_id', true)::uuid);

ALTER TABLE plugin_execution_logs ENABLE ROW LEVEL SECURITY;
ALTER TABLE plugin_execution_logs FORCE ROW LEVEL SECURITY;
CREATE POLICY workspace_isolation ON plugin_execution_logs
  USING (workspace_id = current_setting('app.current_workspace_id', true)::uuid);

ALTER TABLE plugin_reviews ENABLE ROW LEVEL SECURITY;
ALTER TABLE plugin_reviews FORCE ROW LEVEL SECURITY;
CREATE POLICY workspace_isolation ON plugin_reviews
  USING (workspace_id = current_setting('app.current_workspace_id', true)::uuid);

-- WFM tables
ALTER TABLE schedule_templates ENABLE ROW LEVEL SECURITY;
ALTER TABLE schedule_templates FORCE ROW LEVEL SECURITY;
CREATE POLICY workspace_isolation ON schedule_templates
  USING (workspace_id = current_setting('app.current_workspace_id', true)::uuid);

ALTER TABLE agent_schedules ENABLE ROW LEVEL SECURITY;
ALTER TABLE agent_schedules FORCE ROW LEVEL SECURITY;
CREATE POLICY workspace_isolation ON agent_schedules
  USING (workspace_id = current_setting('app.current_workspace_id', true)::uuid);

ALTER TABLE time_off_requests ENABLE ROW LEVEL SECURITY;
ALTER TABLE time_off_requests FORCE ROW LEVEL SECURITY;
CREATE POLICY workspace_isolation ON time_off_requests
  USING (workspace_id = current_setting('app.current_workspace_id', true)::uuid);

ALTER TABLE agent_status_log ENABLE ROW LEVEL SECURITY;
ALTER TABLE agent_status_log FORCE ROW LEVEL SECURITY;
CREATE POLICY workspace_isolation ON agent_status_log
  USING (workspace_id = current_setting('app.current_workspace_id', true)::uuid);

ALTER TABLE volume_snapshots ENABLE ROW LEVEL SECURITY;
ALTER TABLE volume_snapshots FORCE ROW LEVEL SECURITY;
CREATE POLICY workspace_isolation ON volume_snapshots
  USING (workspace_id = current_setting('app.current_workspace_id', true)::uuid);

ALTER TABLE business_hours ENABLE ROW LEVEL SECURITY;
ALTER TABLE business_hours FORCE ROW LEVEL SECURITY;
CREATE POLICY workspace_isolation ON business_hours
  USING (workspace_id = current_setting('app.current_workspace_id', true)::uuid);

-- Routing tables
ALTER TABLE agent_skills ENABLE ROW LEVEL SECURITY;
ALTER TABLE agent_skills FORCE ROW LEVEL SECURITY;
CREATE POLICY workspace_isolation ON agent_skills
  USING (workspace_id = current_setting('app.current_workspace_id', true)::uuid);

ALTER TABLE agent_capacity_rules ENABLE ROW LEVEL SECURITY;
ALTER TABLE agent_capacity_rules FORCE ROW LEVEL SECURITY;
CREATE POLICY workspace_isolation ON agent_capacity_rules
  USING (workspace_id = current_setting('app.current_workspace_id', true)::uuid);

ALTER TABLE routing_queues ENABLE ROW LEVEL SECURITY;
ALTER TABLE routing_queues FORCE ROW LEVEL SECURITY;
CREATE POLICY workspace_isolation ON routing_queues
  USING (workspace_id = current_setting('app.current_workspace_id', true)::uuid);

ALTER TABLE routing_rules ENABLE ROW LEVEL SECURITY;
ALTER TABLE routing_rules FORCE ROW LEVEL SECURITY;
CREATE POLICY workspace_isolation ON routing_rules
  USING (workspace_id = current_setting('app.current_workspace_id', true)::uuid);

ALTER TABLE routing_log ENABLE ROW LEVEL SECURITY;
ALTER TABLE routing_log FORCE ROW LEVEL SECURITY;
CREATE POLICY workspace_isolation ON routing_log
  USING (workspace_id = current_setting('app.current_workspace_id', true)::uuid);

-- Reports / analytics
ALTER TABLE reports ENABLE ROW LEVEL SECURITY;
ALTER TABLE reports FORCE ROW LEVEL SECURITY;
CREATE POLICY workspace_isolation ON reports
  USING (workspace_id = current_setting('app.current_workspace_id', true)::uuid);

ALTER TABLE dashboards ENABLE ROW LEVEL SECURITY;
ALTER TABLE dashboards FORCE ROW LEVEL SECURITY;
CREATE POLICY workspace_isolation ON dashboards
  USING (workspace_id = current_setting('app.current_workspace_id', true)::uuid);

ALTER TABLE report_schedules ENABLE ROW LEVEL SECURITY;
ALTER TABLE report_schedules FORCE ROW LEVEL SECURITY;
CREATE POLICY workspace_isolation ON report_schedules
  USING (workspace_id = current_setting('app.current_workspace_id', true)::uuid);

ALTER TABLE metric_snapshots ENABLE ROW LEVEL SECURITY;
ALTER TABLE metric_snapshots FORCE ROW LEVEL SECURITY;
CREATE POLICY workspace_isolation ON metric_snapshots
  USING (workspace_id = current_setting('app.current_workspace_id', true)::uuid);

-- AI tables
ALTER TABLE ai_resolutions ENABLE ROW LEVEL SECURITY;
ALTER TABLE ai_resolutions FORCE ROW LEVEL SECURITY;
CREATE POLICY workspace_isolation ON ai_resolutions
  USING (workspace_id = current_setting('app.current_workspace_id', true)::uuid);

ALTER TABLE ai_agent_configs ENABLE ROW LEVEL SECURITY;
ALTER TABLE ai_agent_configs FORCE ROW LEVEL SECURITY;
CREATE POLICY workspace_isolation ON ai_agent_configs
  USING (workspace_id = current_setting('app.current_workspace_id', true)::uuid);

ALTER TABLE ai_procedures ENABLE ROW LEVEL SECURITY;
ALTER TABLE ai_procedures FORCE ROW LEVEL SECURITY;
CREATE POLICY workspace_isolation ON ai_procedures
  USING (workspace_id = current_setting('app.current_workspace_id', true)::uuid);

-- Rule versions / automation
ALTER TABLE rule_versions ENABLE ROW LEVEL SECURITY;
ALTER TABLE rule_versions FORCE ROW LEVEL SECURITY;
CREATE POLICY workspace_isolation ON rule_versions
  USING (workspace_id = current_setting('app.current_workspace_id', true)::uuid);

-- RAG tables (workspace_id present, no FK — RAG DB may be separate)
ALTER TABLE rag_chunks ENABLE ROW LEVEL SECURITY;
ALTER TABLE rag_chunks FORCE ROW LEVEL SECURITY;
CREATE POLICY workspace_isolation ON rag_chunks
  USING (workspace_id = current_setting('app.current_workspace_id', true)::uuid);

ALTER TABLE rag_import_jobs ENABLE ROW LEVEL SECURITY;
ALTER TABLE rag_import_jobs FORCE ROW LEVEL SECURITY;
CREATE POLICY workspace_isolation ON rag_import_jobs
  USING (workspace_id = current_setting('app.current_workspace_id', true)::uuid);


-- ============================================================
-- 2e. Denormalize workspace_id into 8 child tables
-- Pattern: ADD COLUMN nullable → UPDATE from parent → SET NOT NULL → INDEX → ENABLE/FORCE RLS → POLICY
-- ============================================================

-- chatbot_versions (parent: chatbots via chatbot_id)
ALTER TABLE chatbot_versions ADD COLUMN workspace_id uuid;
UPDATE chatbot_versions SET workspace_id = c.workspace_id
  FROM chatbots c WHERE chatbot_versions.chatbot_id = c.id;
ALTER TABLE chatbot_versions ALTER COLUMN workspace_id SET NOT NULL;
ALTER TABLE chatbot_versions ADD CONSTRAINT chatbot_versions_workspace_fk
  FOREIGN KEY (workspace_id) REFERENCES workspaces(id);
CREATE INDEX chatbot_versions_workspace_idx ON chatbot_versions(workspace_id);
ALTER TABLE chatbot_versions ENABLE ROW LEVEL SECURITY;
ALTER TABLE chatbot_versions FORCE ROW LEVEL SECURITY;
CREATE POLICY workspace_isolation ON chatbot_versions
  USING (workspace_id = current_setting('app.current_workspace_id', true)::uuid);

-- chatbot_analytics (parent: chatbots via chatbot_id)
ALTER TABLE chatbot_analytics ADD COLUMN workspace_id uuid;
UPDATE chatbot_analytics SET workspace_id = c.workspace_id
  FROM chatbots c WHERE chatbot_analytics.chatbot_id = c.id;
ALTER TABLE chatbot_analytics ALTER COLUMN workspace_id SET NOT NULL;
ALTER TABLE chatbot_analytics ADD CONSTRAINT chatbot_analytics_workspace_fk
  FOREIGN KEY (workspace_id) REFERENCES workspaces(id);
CREATE INDEX chatbot_analytics_workspace_idx ON chatbot_analytics(workspace_id);
ALTER TABLE chatbot_analytics ENABLE ROW LEVEL SECURITY;
ALTER TABLE chatbot_analytics FORCE ROW LEVEL SECURITY;
CREATE POLICY workspace_isolation ON chatbot_analytics
  USING (workspace_id = current_setting('app.current_workspace_id', true)::uuid);

-- schedule_shifts (parent: agent_schedules via schedule_id)
ALTER TABLE schedule_shifts ADD COLUMN workspace_id uuid;
UPDATE schedule_shifts SET workspace_id = s.workspace_id
  FROM agent_schedules s WHERE schedule_shifts.schedule_id = s.id;
ALTER TABLE schedule_shifts ALTER COLUMN workspace_id SET NOT NULL;
ALTER TABLE schedule_shifts ADD CONSTRAINT schedule_shifts_workspace_fk
  FOREIGN KEY (workspace_id) REFERENCES workspaces(id);
CREATE INDEX schedule_shifts_workspace_idx ON schedule_shifts(workspace_id);
ALTER TABLE schedule_shifts ENABLE ROW LEVEL SECURITY;
ALTER TABLE schedule_shifts FORCE ROW LEVEL SECURITY;
CREATE POLICY workspace_isolation ON schedule_shifts
  USING (workspace_id = current_setting('app.current_workspace_id', true)::uuid);

-- holiday_entries (parent: holiday_calendars via calendar_id)
ALTER TABLE holiday_entries ADD COLUMN workspace_id uuid;
UPDATE holiday_entries SET workspace_id = h.workspace_id
  FROM holiday_calendars h WHERE holiday_entries.calendar_id = h.id;
ALTER TABLE holiday_entries ALTER COLUMN workspace_id SET NOT NULL;
ALTER TABLE holiday_entries ADD CONSTRAINT holiday_entries_workspace_fk
  FOREIGN KEY (workspace_id) REFERENCES workspaces(id);
CREATE INDEX holiday_entries_workspace_idx ON holiday_entries(workspace_id);
ALTER TABLE holiday_entries ENABLE ROW LEVEL SECURITY;
ALTER TABLE holiday_entries FORCE ROW LEVEL SECURITY;
CREATE POLICY workspace_isolation ON holiday_entries
  USING (workspace_id = current_setting('app.current_workspace_id', true)::uuid);

-- dashboard_widgets (parent: dashboards via dashboard_id)
ALTER TABLE dashboard_widgets ADD COLUMN workspace_id uuid;
UPDATE dashboard_widgets SET workspace_id = d.workspace_id
  FROM dashboards d WHERE dashboard_widgets.dashboard_id = d.id;
ALTER TABLE dashboard_widgets ALTER COLUMN workspace_id SET NOT NULL;
ALTER TABLE dashboard_widgets ADD CONSTRAINT dashboard_widgets_workspace_fk
  FOREIGN KEY (workspace_id) REFERENCES workspaces(id);
CREATE INDEX dashboard_widgets_workspace_idx ON dashboard_widgets(workspace_id);
ALTER TABLE dashboard_widgets ENABLE ROW LEVEL SECURITY;
ALTER TABLE dashboard_widgets FORCE ROW LEVEL SECURITY;
CREATE POLICY workspace_isolation ON dashboard_widgets
  USING (workspace_id = current_setting('app.current_workspace_id', true)::uuid);

-- report_cache (parent: reports via report_id)
ALTER TABLE report_cache ADD COLUMN workspace_id uuid;
UPDATE report_cache SET workspace_id = r.workspace_id
  FROM reports r WHERE report_cache.report_id = r.id;
ALTER TABLE report_cache ALTER COLUMN workspace_id SET NOT NULL;
ALTER TABLE report_cache ADD CONSTRAINT report_cache_workspace_fk
  FOREIGN KEY (workspace_id) REFERENCES workspaces(id);
CREATE INDEX report_cache_workspace_idx ON report_cache(workspace_id);
ALTER TABLE report_cache ENABLE ROW LEVEL SECURITY;
ALTER TABLE report_cache FORCE ROW LEVEL SECURITY;
CREATE POLICY workspace_isolation ON report_cache
  USING (workspace_id = current_setting('app.current_workspace_id', true)::uuid);

-- qa_calibration_entries (parent: qa_calibration_sessions via session_id)
ALTER TABLE qa_calibration_entries ADD COLUMN workspace_id uuid;
UPDATE qa_calibration_entries SET workspace_id = s.workspace_id
  FROM qa_calibration_sessions s WHERE qa_calibration_entries.session_id = s.id;
ALTER TABLE qa_calibration_entries ALTER COLUMN workspace_id SET NOT NULL;
ALTER TABLE qa_calibration_entries ADD CONSTRAINT qa_calibration_entries_workspace_fk
  FOREIGN KEY (workspace_id) REFERENCES workspaces(id);
CREATE INDEX qa_calibration_entries_workspace_idx ON qa_calibration_entries(workspace_id);
ALTER TABLE qa_calibration_entries ENABLE ROW LEVEL SECURITY;
ALTER TABLE qa_calibration_entries FORCE ROW LEVEL SECURITY;
CREATE POLICY workspace_isolation ON qa_calibration_entries
  USING (workspace_id = current_setting('app.current_workspace_id', true)::uuid);

-- custom_role_permissions (parent: custom_roles via custom_role_id)
ALTER TABLE custom_role_permissions ADD COLUMN workspace_id uuid;
UPDATE custom_role_permissions SET workspace_id = r.workspace_id
  FROM custom_roles r WHERE custom_role_permissions.custom_role_id = r.id;
ALTER TABLE custom_role_permissions ALTER COLUMN workspace_id SET NOT NULL;
ALTER TABLE custom_role_permissions ADD CONSTRAINT custom_role_permissions_workspace_fk
  FOREIGN KEY (workspace_id) REFERENCES workspaces(id);
CREATE INDEX custom_role_permissions_workspace_idx ON custom_role_permissions(workspace_id);
-- custom_role_permissions already has ENABLE RLS from 0018, and FORCE from 2c above
CREATE POLICY workspace_isolation ON custom_role_permissions
  USING (workspace_id = current_setting('app.current_workspace_id', true)::uuid);


-- ============================================================
-- Tenant-level tables: users gets workspace-scoped policy too
-- (users have workspace_id in addition to tenant_id)
-- ============================================================

ALTER TABLE users ENABLE ROW LEVEL SECURITY;
ALTER TABLE users FORCE ROW LEVEL SECURITY;
CREATE POLICY workspace_isolation ON users
  USING (workspace_id = current_setting('app.current_workspace_id', true)::uuid);

-- Tenant-level tables with tenant_id policies
ALTER TABLE tenants ENABLE ROW LEVEL SECURITY;
ALTER TABLE tenants FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON tenants
  USING (id = current_setting('app.current_tenant_id', true)::uuid);

ALTER TABLE workspaces ENABLE ROW LEVEL SECURITY;
ALTER TABLE workspaces FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON workspaces
  USING (tenant_id = current_setting('app.current_tenant_id', true)::uuid);

ALTER TABLE usage_metrics ENABLE ROW LEVEL SECURITY;
ALTER TABLE usage_metrics FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON usage_metrics
  USING (tenant_id = current_setting('app.current_tenant_id', true)::uuid);

ALTER TABLE billing_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE billing_events FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON billing_events
  USING (tenant_id = current_setting('app.current_tenant_id', true)::uuid);


-- ============================================================
-- Additional workspace-scoped tables not yet covered
-- ============================================================

-- business_hours_holiday_links — join table, scope via business_hours parent
-- No workspace_id column, but both parents are workspace-scoped.
-- Skip for now — queries will be filtered by joining to scoped parents.

-- user_mfa — user-level, not workspace-scoped. Skip.
-- marketplace_listings — global catalog. Skip.
-- permissions — already has read-only policy. Skip.
