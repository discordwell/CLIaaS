# Plan 20: Integrations — Jira/Linear, CRM Sync, Custom Objects

## Phase 1: Foundation
- [x] 1.1 Migration `0023_integrations_expansion.sql` (7 new tables + RLS)
- [x] 1.2 Drizzle schema additions in `schema.ts`
- [x] 1.3 JSONL fallback stores (`src/lib/integrations/link-store.ts`, `src/lib/custom-objects.ts`)
- [x] 1.4 Feature gates (`engineering_integrations`, `crm_integrations`, `custom_objects`)
- [x] 1.5 Status mapper module (`src/lib/integrations/status-mapper.ts`)

## Phase 2: Jira/Linear Integration
- [x] 2.1 Jira REST v3 client (`src/lib/integrations/jira-client.ts`)
- [x] 2.2 Linear GraphQL client (`src/lib/integrations/linear-client.ts`)
- [x] 2.3 Engineering sync engine (`src/lib/integrations/engineering-sync.ts`)
- [x] 2.4 Webhook receivers (`/api/webhooks/jira`, `/api/webhooks/linear`)
- [x] 2.5 API routes: configure + external links CRUD
- [x] 2.6 CLI commands (`jira`, `linear`)
- [x] 2.7 MCP tools (`engineering.ts` — 7 tools)
- [x] 2.8 Ticket detail UI: engineering links section + modals

## Phase 3: CRM Integration
- [x] 3.1 Salesforce REST client (`src/lib/integrations/salesforce-client.ts`)
- [x] 3.2 HubSpot CRM client extensions (`src/lib/integrations/hubspot-crm-client.ts`)
- [x] 3.3 CRM sync engine (`src/lib/integrations/crm-sync.ts`)
- [x] 3.4 API routes: CRM configure + links CRUD
- [x] 3.5 CLI commands (`crm`)
- [x] 3.6 MCP tools (`crm.ts` — 4 tools)
- [x] 3.7 Customer detail UI: CRM sidebar

## Phase 4: Custom Objects
- [x] 4.1 Custom objects API routes (types + records + relationships)
- [x] 4.2 CLI commands (`objects`)
- [x] 4.3 MCP tools (`custom-objects.ts` — 8 tools)
- [x] 4.4 UI: Custom objects management pages
- [x] 4.5 UI: RelatedObjectsPanel in ticket/customer detail

## Phase 5: Polish & Testing
- [x] 5.1 Integration tests (17 tests passing)
- [x] 5.2 Integrations hub UI: "Engineering & CRM" tab
- [x] 5.3 Update ARCHITECTURE.md
- [x] 5.4 Code review (running)
