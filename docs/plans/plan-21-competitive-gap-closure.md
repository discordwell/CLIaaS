# Plan 21: Competitive Gap Closure

> Turning critique into action — closing the six gaps between CLIaaS and competitor maturity.

## Pre-Plan Audit: What's Already Done

Session 118 and prior work already addressed many items the critique flagged:

| Critique Claim | Actual State | Remaining Gap |
|---|---|---|
| Plugin system is JSONL/demo-registry | 5 DB tables, marketplace store, sandbox, credentials, 8 MCP tools, 10 CLI commands, API routes, 3 first-party + 3 reference plugins | No browse/install UI, thin catalog, no third-party submission workflow |
| Voice is global JSONL singleton | Correct — still JSONL, no DB tables for voice | Need DB migration + dual-mode store |
| Sync is worker/polling driven | Webhook route exists for Zendesk/Intercom/Freshdesk/HubSpot with HMAC verification | Webhook is additive, not primary; polling still the default path |
| SCIM is in-memory | DB tables exist (scim_users, scim_groups, scim_group_members) + async RLS methods | API routes may still call sync JSONL methods |
| SSO providers are JSONL/global | DB table (sso_providers) + dual-mode store + async methods | API routes partially wired to async |
| SAML can be skipped with no cert | **Fixed** — throws error if no cert configured (line 277-280) | None |
| AutoQA worker not started | **Fixed** — registered in workers/index.ts, started via instrumentation.ts | None |
| Intercom conversations-as-tickets | **Fixed** — dual model: conversations + separate Tickets API (ic-ticket-*) | Source tagging could be clearer |
| HubSpot skips KB | **Fixed** — CMS Blog API + knowledge-base fallback (lines 438-495) | None |
| HubSpot skips conversations | **Partially fixed** — email thread export via associations | No Conversations API v3 integration |
| Zoho/HelpScout/Intercom skip rules | Zoho: correct (no export). HelpScout/Intercom: API doesn't expose rules. | Zoho API does have endpoints; Freshdesk has more |

---

## Workstream 1: App Marketplace & Ecosystem

**Current state**: Strong backend (5 DB tables, dual-mode store, sandbox executor, webhook runtime, AES-256-GCM credentials, execution logging, 8 MCP tools, marketplace API routes). Missing the **product layer**: no browse UI, thin first-party catalog, no submission review flow.

### Tasks

| # | Task | Files | Est |
|---|------|-------|-----|
| 1.1 | **Marketplace browse UI** — `/dashboard/marketplace` page: search, filter by category, featured listings, install counts, ratings. Card grid layout with install button. | New page + components | M |
| 1.2 | **Plugin management UI** — `/dashboard/plugins` page: installed plugins list, enable/disable toggles, config editor (from manifest configSchema → form), credential input, execution log viewer | New page + components | M |
| 1.3 | **Publisher submission flow** — `/dashboard/marketplace/publish` page: upload manifest, validation feedback, submit for review. Admin review queue at `/dashboard/admin/plugins` with approve/reject. | New pages + API | M |
| 1.4 | **Expand first-party catalog** — Add 5 more production-quality first-party plugins: SLA Escalator (auto-escalate on breach), CSAT Survey Trigger (post-resolution survey), Webhook Relay (fan-out to N endpoints), Custom Field Sync (cross-connector field mapping), AI Summary (auto-summarize long threads) | `src/lib/plugins/first-party/` | L |
| 1.5 | **Plugin event dispatch wiring** — Connect event dispatcher to `executePluginHook()` for all canonical events. Currently the hook execution path exists but may not be called from dispatcher for all event types. | `src/lib/events/dispatcher.ts` | S |
| 1.6 | **Plugin dependency resolution** — When installing a plugin that requires another, check + prompt. When uninstalling, warn about dependents. | `src/lib/plugins/store.ts` | S |

**Tests**: Marketplace listing CRUD, install/uninstall lifecycle, manifest validation, hook dispatch for each event type, dependency resolution, credential encryption round-trip.

---

## Workstream 2: Contact Center Maturity

**Current state**: Voice store is JSONL singleton with no DB tables. Routing engine is sophisticated (skill-based, capacity-aware, WFM-integrated). IVR exists (TwiML generator). Webhook sync exists for 4 connectors. Missing: voice DB, omnichannel admin UI, webhook as primary sync path.

### Tasks

| # | Task | Files | Est |
|---|------|-------|-----|
| 2.1 | **Voice DB schema** — `voice_calls`, `voice_agents`, `voice_queue_metrics` tables + migration. Include workspaceId, indexes on callSid/agentId/status. | `src/db/schema.ts`, new migration | S |
| 2.2 | **Voice store → dual-mode** — Add `tryDb()` primary path + `withRls()` async methods. Keep JSONL fallback. Remove global singleton pattern. | `src/lib/channels/voice-store.ts` | M |
| 2.3 | **Webhook-primary sync** — Add `connectorSyncMode` config per connector: `'webhook'` (default where supported), `'polling'` (fallback), `'hybrid'` (webhook + periodic full sync). Webhook route becomes the primary ingestion path; polling worker runs on interval only for connectors without webhook support or as reconciliation. | `src/lib/connector-service.ts`, webhook route, sync engine | M |
| 2.4 | **Webhook handlers for remaining connectors** — Add Zoho Desk and Help Scout webhook verification + normalization. (Zendesk, Intercom, Freshdesk, HubSpot already done.) | `webhook/route.ts` | M |
| 2.5 | **Omnichannel dashboard page** — `/dashboard/channels`: unified view of all channels (email, chat, voice, social) with status indicators, volume sparklines, active agents per channel, SLA metrics per channel. | New page | M |
| 2.6 | **Voice admin page** — `/dashboard/channels/voice`: IVR config editor (visual tree or form), agent phone assignments, queue management, call log viewer with playback/transcription links. | New page | L |

**Tests**: Voice DB CRUD, dual-mode fallback, webhook signature verification for Zoho/HelpScout, sync mode config, IVR config persistence.

---

## Workstream 3: Enterprise Identity & Provisioning

**Current state**: Strong. SCIM has DB tables + async RLS methods. SSO has DB table + dual-mode. SAML verification is mandatory. OIDC with JWKS verification. Missing: API route wiring to async methods, audit logging, admin UI, directory sync.

### Tasks

| # | Task | Files | Est |
|---|------|-------|-----|
| 3.1 | **SCIM API routes → async** — Audit all `/api/scim/v2/*` routes. Ensure they call `*Async(workspaceId)` methods (DB-backed with RLS), not sync JSONL methods. | SCIM API routes | S |
| 3.2 | **SSO provider routes → async** — Audit `/api/auth/sso/providers/*` routes. Ensure `getProvidersAsync()`, `createProviderAsync()`, etc. are called with workspaceId. | SSO API routes | S |
| 3.3 | **SCIM audit log** — New `scim_audit_log` table: action (user_created, user_updated, user_deactivated, group_created, group_member_added, etc.), actorId, targetId, details (JSONB), timestamp. Log from all SCIM store mutations. | New table + migration, `src/lib/scim/store.ts` | M |
| 3.4 | **SSO admin UI** — `/dashboard/settings/sso`: provider list with protocol badges, enable/disable toggles, add/edit forms (SAML: entityId, ssoUrl, cert upload; OIDC: clientId, secret, issuer, URLs), test connection button, domain hint config. | New page | M |
| 3.5 | **SCIM admin UI** — `/dashboard/settings/scim`: provisioned user list with sync status, group membership viewer, SCIM endpoint URL + token display (masked), audit log viewer with filtering. | New page | M |
| 3.6 | **JIT provisioning** — On SAML/OIDC callback, if user email not found in users table, auto-create with provider's `defaultRole` (or 'agent' fallback). Log as SCIM audit event. Configurable per provider (`autoProvision: boolean`). | SAML/OIDC callback routes, SSO config | S |

**Tests**: SCIM API → DB round-trip with RLS, SSO provider async CRUD, audit log entries for each action type, JIT provisioning with role assignment, auto-provision toggle.

---

## Workstream 4: AI Product Packaging

**Current state**: Very mature backend. Admin controls (channel policies, circuit breaker, audit trail, hourly usage), AutoQA worker running, AI agent with provider abstraction, chatbot with ai_response nodes, procedures engine. Missing: **all admin UI** — the backend is production-ready but invisible to admin users.

### Tasks

| # | Task | Files | Est |
|---|------|-------|-----|
| 4.1 | **AI overview dashboard** — `/dashboard/ai`: resolution rate card, avg handle time saved, CSAT impact, active channels summary, circuit breaker status indicator, recent audit trail entries. Pulls from `/api/ai/admin?view=overview`. | New page | M |
| 4.2 | **AI setup wizard** — `/dashboard/ai/setup`: step 1 (pick provider + enter API key), step 2 (select channels), step 3 (set mode per channel: suggest/approve/auto), step 4 (confidence threshold + max auto-resolves), step 5 (test with sample ticket), step 6 (activate). Writes to `ai_config` + channel policies. | New page, multi-step | L |
| 4.3 | **Channel policy editor** — `/dashboard/ai/channels`: per-channel cards with mode selector, confidence slider, rate limit input, excluded topics chips, enable/disable toggle. Live-updates via `/api/ai/admin`. | New page | M |
| 4.4 | **AI performance page** — `/dashboard/ai/performance`: time-series charts (resolutions/day, confidence distribution, escalation rate), agent-vs-AI handle time comparison, token usage + cost tracking, filterable by date range + channel. | New page | M |
| 4.5 | **AutoQA results page** — `/dashboard/qa/auto`: QA score distribution chart, flagged conversations list with review links, per-agent score breakdown, coaching suggestion cards, config panel (sampling rate, provider, custom instructions). | New page | M |
| 4.6 | **AI procedures editor** — `/dashboard/ai/procedures`: create/edit procedure (rich text instructions), associate with topics/tags, test execution panel, enable/disable toggle. Wires into existing procedure engine. | New page | M |
| 4.7 | **Safety & circuit breaker page** — `/dashboard/ai/safety`: circuit breaker state with manual reset, PII detection config, audit trail table (filterable by action type, ticket, date), usage quota settings. | New page | S |

**Tests**: Dashboard data aggregation, wizard state persistence, channel policy CRUD via UI, performance chart data shape, AutoQA config round-trip.

---

## Workstream 5: Connector Entity Parity

**Current state**: Zendesk is gold-standard (macros, triggers, automations, SLAs, views, forms, brands, audit events, CSAT, time entries). HubSpot close (tickets, emails, notes, KB, workflows). Intercom good (conversations + tickets + articles). Gaps: Zoho has rule APIs we don't call, Freshdesk has automation APIs beyond SLA we don't call, several connectors legitimately lack rule APIs.

### Tasks

| # | Task | Files | Est |
|---|------|-------|-----|
| 5.1 | **Zoho Desk business rules** — Export workflow rules (`/api/v1/workflowRules`), assignment rules (`/api/v1/assignmentRules`), and SLA policies. Map to Rule type with source metadata. | `cli/connectors/zoho-desk.ts` | M |
| 5.2 | **Freshdesk automation rules** — Export dispatch rules (`/automations/ticket_rules`), observer rules, scenario automations. Currently only exports SLA policies. | `cli/connectors/freshdesk.ts` | M |
| 5.3 | **HubSpot Conversations API** — Integrate `/conversations/v3/conversations` for full threaded message history (distinct from ticket→email associations). Includes channel metadata, participant tracking. | `cli/connectors/hubspot.ts` | M |
| 5.4 | **Intercom source tagging** — Add `source: 'conversation' | 'ticket'` field to exported tickets so imports can preserve Intercom's dual model. Document that Intercom doesn't expose automation rules via API. | `cli/connectors/intercom.ts` | S |
| 5.5 | **Connector capability matrix API** — Extend `ConnectorCapabilities` to include entity-level detail: `{ rules: boolean, kb: boolean, conversations: boolean, customFields: boolean, views: boolean }`. Expose via `/api/connectors/capabilities` and `connector_capabilities` MCP tool. | `src/lib/connector-service.ts` | S |
| 5.6 | **Help Scout / Groove / HelpCrunch rule documentation** — Update connector output to clearly state "This platform does not expose automation rules via API" (vs. "not implemented") so users understand the limitation is upstream. Already partially done. | Connector files | S |
| 5.7 | **Connector parity test suite** — Integration tests that verify exported entity shapes, required fields, ID format conventions, count accuracy against mock API responses for each connector. | New test files | M |

**Tests**: Zoho rule export shape, Freshdesk automation export, HubSpot conversation thread ordering, capability matrix completeness, per-connector entity shape validation.

---

## Workstream 6: Advanced WFM

**Current state**: Solid foundation — scheduling (templates + per-agent), EMA forecasting with confidence intervals, staffing gap analysis, real-time adherence, utilization/occupancy, time-off workflow, business hours (timezone-aware), holiday presets (US/UK/CA/AU). Missing: optimization, intraday, shift swaps, QA integration, dashboard UI.

### Tasks

| # | Task | Files | Est |
|---|------|-------|-----|
| 6.1 | **Schedule optimizer** — Given forecast + agent availability + skills + time-off + constraints (max consecutive hours, min rest between shifts), produce optimal shift assignments using greedy heuristic with constraint satisfaction. Not full LP solver — pragmatic approach. | New `src/lib/wfm/optimizer.ts` | L |
| 6.2 | **Intraday management** — `reforecast(workspaceId)`: compare actual volume (last 2 hours) vs. forecast, adjust remaining-day predictions using drift factor. Return revised staffing recommendations with `urgency` flag when gap > 2 agents. | New `src/lib/wfm/intraday.ts` | M |
| 6.3 | **Shift swap & trade** — New `shift_swaps` table: requester, offerer, shift details, status (pending/approved/denied/expired). Constraint validation: both agents must be skill-eligible, no overlap with existing shifts/time-off. Manager approval flow. | New table + migration + store + API | M |
| 6.4 | **QA-weighted scheduling** — Factor recent QA scores into optimizer: low-QA agents get shorter shifts or coaching blocks (15-min training activity). High-QA agents eligible for premium/peak shifts. | Extend optimizer, wire QA store | S |
| 6.5 | **WFM dashboard page** — `/dashboard/wfm`: intraday view (forecast vs actual line chart), staffing heatmap (hour × day), adherence timeline, shift swap request queue, time-off calendar view, key metrics (avg occupancy, adherence %). | New page | L |
| 6.6 | **Auto-schedule generation** — Given a template + agent roster + forecast, auto-generate weekly schedules. Admin reviews and publishes. Uses optimizer from 6.1. | Extend `src/lib/wfm/schedules.ts` | M |

**Tests**: Optimizer constraint satisfaction (no overlapping shifts, rest periods respected), intraday reforecast accuracy vs actual, shift swap validation (skill-eligible, no conflicts), QA score integration.

---

## Execution Phases

```
Phase A — Foundation (backend hardening):
  3.1, 3.2       SCIM/SSO API → async wiring
  2.1, 2.2       Voice DB schema + dual-mode store
  1.5            Plugin event dispatch wiring
  5.4, 5.5, 5.6  Connector tagging + capabilities + docs

Phase B — Core features (new functionality):
  5.1, 5.2, 5.3  Zoho rules, Freshdesk rules, HubSpot conversations
  2.3, 2.4       Webhook-primary sync + remaining handlers
  3.3, 3.6       SCIM audit log + JIT provisioning
  6.1, 6.2       Schedule optimizer + intraday
  1.4, 1.6       Expand plugin catalog + dependencies

Phase C — Product layer (admin UIs):
  4.1, 4.2, 4.3  AI overview + setup wizard + channel policies
  4.4, 4.5, 4.6, 4.7  AI performance + AutoQA + procedures + safety
  1.1, 1.2, 1.3  Marketplace browse + plugin mgmt + publisher flow
  3.4, 3.5       SSO + SCIM admin UIs
  2.5, 2.6       Omnichannel dashboard + voice admin
  6.3, 6.5, 6.6  Shift swaps + WFM dashboard + auto-schedule

Phase D — Polish:
  5.7, 6.4       Connector parity tests + QA-weighted scheduling
  1.6            Plugin dependency resolution
```

## Summary

**38 tasks** across 6 workstreams. Priority order by competitive impact:

1. **Connector entity parity** (WS5) — "biggest product gap" per critique; 7 tasks
2. **AI product packaging** (WS4) — backend is done, just needs UI; 7 tasks, high ROI
3. **Marketplace ecosystem** (WS1) — backend is done, needs product layer; 6 tasks
4. **Contact center maturity** (WS2) — voice DB + webhook-primary; 6 tasks
5. **Enterprise identity** (WS3) — mostly wiring + UI; 6 tasks
6. **Advanced WFM** (WS6) — new capabilities; 6 tasks, longest lead time

Phase A is the fastest to complete (backend wiring, small scope). Phase C is the largest (all UI work). Phase B contains the most technically complex tasks.
