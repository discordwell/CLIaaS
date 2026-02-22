# SaaS Data Model + Integration Plan (CLIaaS)

Date: February 22, 2026

## Goals

- Support one-time import and ongoing sync for Zendesk, Freshdesk, HelpCrunch, Groove, Kayako Cloud, Kayako Classic.
- Preserve compatibility for export back to providers where possible.
- Enable full SaaS-grade functionality replication, not just data display.
- Keep a clear, auditable mapping from provider objects to canonical records.

## Phased Plan

1. Canonical contract
- Expand canonical types for agents, customers, orgs, groups, inboxes, custom fields, SLAs, rules, views, CSAT, time entries, attachments, audit events.
- Define provider capability matrix to gate import and export by feature.

2. One-time import
- Use CLI connector exporters as the extraction layer.
- Normalize and upsert into canonical tables.
- Persist raw provider payloads for lossless export and audit.
- Emit a parity report per provider account.

3. Ongoing sync
- Store cursors per provider and object type.
- Run incremental sync jobs on schedule.
- Conflict rules favor CLIaaS-originated changes unless provider has newer activity.

4. Functionality replication
- Rules engine for macros, triggers, automations.
- SLA engine with targets and breach tracking.
- Unified ticket and conversation model for email and chat.

5. Export and rollback
- Export compatible data back to provider APIs.
- Offer neutral JSONL and CSV export packages for portability.

6. Observability
- Import and export job logs.
- Error ledger and retry history.
- Daily parity checks during dual-run.

## Canonical Data Model (Postgres)

Core tenancy
- tenants
- workspaces
- users

Identity and customers
- customers
- organizations
- groups

Inbox and conversation
- inboxes
- tickets
- conversations
- messages
- attachments

Tagging and custom data
- tags
- ticket_tags
- custom_fields
- custom_field_values

Automation and SLA
- rules
- sla_policies
- sla_events

Views and reporting
- views
- csat_ratings
- time_entries

Knowledge base
- kb_collections
- kb_categories
- kb_articles
- kb_revisions

Integration and sync
- integrations
- external_objects
- sync_cursors
- import_jobs
- export_jobs
- raw_records

Audit
- audit_events

## Table Sketch (Key Columns)

tenants
- id
- name
- plan
- created_at

workspaces
- id
- tenant_id
- name
- timezone
- default_inbox_id

users
- id
- workspace_id
- email
- name
- role
- status

customers
- id
- workspace_id
- external_ref
- name
- email
- phone
- org_id

organizations
- id
- workspace_id
- name
- domains

groups
- id
- workspace_id
- name

inboxes
- id
- workspace_id
- name
- channel_type
- address

tickets
- id
- workspace_id
- requester_id
- assignee_id
- group_id
- inbox_id
- subject
- status
- priority
- sla_policy_id
- created_at
- updated_at
- closed_at

conversations
- id
- ticket_id
- channel_type
- started_at
- last_activity_at

messages
- id
- conversation_id
- author_type
- author_id
- body
- body_html
- visibility
- created_at

attachments
- id
- message_id
- filename
- size
- content_type
- storage_key

tags
- id
- workspace_id
- name

ticket_tags
- ticket_id
- tag_id

custom_fields
- id
- workspace_id
- object_type
- name
- field_type
- options
- required

custom_field_values
- object_type
- object_id
- field_id
- value

rules
- id
- workspace_id
- type
- name
- enabled
- conditions_json
- actions_json

sla_policies
- id
- workspace_id
- name
- targets_json
- schedules_json

sla_events
- id
- ticket_id
- policy_id
- metric
- due_at
- breached_at

views
- id
- workspace_id
- name
- query_json

csat_ratings
- id
- ticket_id
- rating
- comment
- created_at

time_entries
- id
- ticket_id
- user_id
- minutes
- note
- created_at

kb_collections
- id
- workspace_id
- name

kb_categories
- id
- collection_id
- name
- parent_id

kb_articles
- id
- category_id
- title
- body
- status
- author_id
- updated_at

kb_revisions
- id
- article_id
- body
- created_at

integrations
- id
- workspace_id
- provider
- status
- credentials_ref
- created_at

external_objects
- id
- integration_id
- object_type
- external_id
- internal_id
- checksum
- last_seen_at

sync_cursors
- id
- integration_id
- object_type
- cursor
- updated_at

import_jobs
- id
- integration_id
- status
- started_at
- finished_at
- error

export_jobs
- id
- integration_id
- status
- started_at
- finished_at
- error

raw_records
- id
- integration_id
- object_type
- external_id
- payload_jsonb

audit_events
- id
- workspace_id
- actor_type
- actor_id
- action
- object_type
- object_id
- created_at
- diff_json

## Provider Compatibility Notes

- Keep raw provider payloads in raw_records for lossless export and audit.
- external_objects maintains stable mapping between provider IDs and canonical IDs.
- sync_cursors provides incremental sync without full re-import.
- Export is limited to the provider capability matrix per object and field.

## Prisma vs Drizzle (Tradeoffs)

Prisma pros
- Strong type safety, good migration workflow, excellent developer experience.
- Built-in schema and client generation.
- Handles relations and nested writes cleanly.

Prisma cons
- Heavier runtime and larger query overhead for high-throughput ingest.
- Less control over SQL tuning and certain Postgres features.
- Migrations can be opinionated and slower at scale.

Drizzle pros
- Lightweight runtime and excellent SQL-level control.
- Great for performance, bulk ingest, and custom SQL.
- Migration tooling is simple and transparent.

Drizzle cons
- Slightly more manual schema and query work.
- Fewer batteries included for complex relation workflows.
- Smaller ecosystem for admin tooling compared to Prisma.

## Recommendation

- For fast iteration and team velocity, start with Prisma.
- If ingest performance and SQL control become bottlenecks, consider moving the ingestion pipeline to Drizzle or raw SQL while keeping Prisma for app queries.

