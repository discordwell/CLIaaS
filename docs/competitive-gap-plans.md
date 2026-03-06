# Competitive Gap Planning Agents

20 planning agents, designed to run 5 at a time across 4 sessions.
Each agent should: read the relevant code, produce an implementation plan with DB schema changes, API routes, UI components, CLI commands, MCP tools, and effort estimate.

Shared context for ALL agents (paste at the top of each prompt):

```
You are planning a feature for CLIaaS, a CLI/MCP-first helpdesk platform.
Key files to understand the architecture:
- ARCHITECTURE.md (full system overview)
- src/db/schema.ts (73 Drizzle tables)
- src/lib/ (business logic)
- cli/ (CLI commands, connectors, MCP server)
- src/app/ (Next.js App Router pages)

DO NOT write any code. Read the relevant existing files, then produce:
1. Summary of what exists today (with file:line references)
2. Proposed DB schema changes (new tables/columns)
3. New API routes needed
4. New/modified UI pages/components
5. New CLI commands
6. New MCP tools
7. Migration/rollout plan
8. Effort estimate (S/M/L/XL)
```

---

## Batch 1 (Strategic Gaps)

### Agent 1: Autonomous AI Resolution Engine

```
FEATURE: Production-grade autonomous AI resolution

COMPETITIVE CONTEXT:
- Zendesk AI Agents resolve tickets autonomously ($1.50/resolution)
- Intercom Fin 3 can take actions (refunds, account changes) via Procedures
- Freshdesk Freddy AI Agent handles tickets end-to-end via chat and email
- CLIaaS today: ai-resolution worker is a no-op (src/lib/queue/workers/ai-resolution-worker.ts:22), agent defaults to disabled (src/lib/ai/agent.ts:52), stats are in-memory (src/lib/ai/agent.ts:62)

WHAT NEEDS TO EXIST:
1. Always-on AI resolution pipeline that actually resolves tickets (not no-op)
2. Action framework: AI can update ticket fields, send replies, close tickets, trigger webhooks
3. Configurable "Procedures" (natural-language multi-step instructions the AI follows)
4. Human-in-the-loop approval mode (existing approval-queue.ts) made production-ready
5. Per-resolution metering tied to billing (usage_metrics table exists)
6. Confidence threshold: auto-resolve above X%, route to human below
7. Resolution analytics: track rate, accuracy, customer satisfaction on AI-resolved tickets
8. Safety rails: PII detection, hallucination guards, escalation triggers
9. Multi-channel: AI resolves via email reply, chat message, or portal response

FILES TO READ:
- src/lib/ai/agent.ts (current AI agent skeleton)
- src/lib/ai/router.ts (AI routing logic)
- src/lib/ai/approval-queue.ts (existing approval system)
- src/lib/ai/roi-tracker.ts (ROI tracking)
- src/lib/queue/workers/ai-resolution-worker.ts (the no-op worker)
- src/lib/queue/dispatch.ts (queue dispatch)
- src/lib/events/dispatcher.ts (event pipeline)
- cli/providers/ (LLM provider interface)
- src/lib/billing/ (usage metering)

PRODUCE: Full implementation plan to make AI resolution production-grade.
```

### Agent 2: Real-time Omnichannel Routing Engine

```
FEATURE: Skill-based, capacity-aware, real-time omnichannel routing

COMPETITIVE CONTEXT:
- Zendesk: omnichannel routing with skills, capacity rules, 199 custom queues
- Intercom: auto-routing based on conversation attributes and team rules
- Freshdesk: Dispatch'r (creation rules), Observer (update rules), Supervisor (time-triggered), round-robin, skill-based, load-balanced, Omniroute
- HubSpot: routing by availability/hours
- CLIaaS today: routing is static config + in-memory load simulation (src/lib/ai/router.ts:47, :101); sync loop is interval polling (cli/sync/worker.ts); Slack ticket creation is demo-only text response

WHAT NEEDS TO EXIST:
1. Agent skills model: agents tagged with skills (language, product, tier)
2. Capacity rules: per-agent, per-channel limits (max 3 chats + 5 emails simultaneously)
3. Routing strategies: round-robin, load-balanced, skill-match, priority-weighted
4. Custom routing queues with priority ordering
5. Real-time agent availability (online/away/offline) via presence system
6. Business hours awareness (route to available timezone)
7. Overflow/fallback: if no skilled agent available within timeout, widen the pool
8. Routing analytics: assignment time, queue depth, agent utilization
9. Auto-assignment on ticket creation across all channels

FILES TO READ:
- src/lib/ai/router.ts (current routing logic)
- src/lib/realtime/presence.ts (presence system)
- src/lib/realtime/events.ts (SSE events)
- src/db/schema.ts (users, groups, tickets tables)
- src/lib/automation/actions.ts (automation actions including assignment)
- cli/sync/worker.ts (sync polling)
- src/app/api/channels/slack/commands/route.ts (Slack command handler)
- src/lib/channels/slack-intake.ts (Slack intake)

PRODUCE: Full implementation plan for production routing engine.
```

### Agent 3: Workflow Automation Engine

```
FEATURE: Persistent, complete workflow/process automation engine

COMPETITIVE CONTEXT:
- Freshdesk: Dispatch'r (creation), Observer (updates), Supervisor (time-triggered), scenario automations, approval workflows, webhooks from rules
- Zoho Desk: Blueprint (visual process automation with states and transitions)
- Intercom: visual no-code workflow builder with external data connectors
- HubSpot: ticket/workflow automation with branching logic
- CLIaaS today: rule store/audit is global in-memory (src/lib/automation/executor.ts:24, :47); execution comments say "for now" for notifications/webhooks (executor.ts:131); custom form PATCH not implemented

WHAT NEEDS TO EXIST:
1. Persistent rule storage in DB (not in-memory) with versioning
2. Three rule types: triggers (on-event), automations (time-based), macros (agent-initiated)
3. AND/OR compound conditions with nested groups
4. Complete action set: assign, tag, set field, send reply, send notification, webhook, escalate, close, add note, trigger another workflow
5. Execution audit trail: every rule fire logged with before/after state
6. Side effects chain: notifications and webhooks actually fire (fix "for now" comments)
7. Rule testing/preview: dry-run a rule against existing tickets
8. Approval workflows: request approval within ticket lifecycle
9. Visual workflow builder UI (drag-and-drop canvas)
10. Macro support: one-click multi-action scripts for agents

FILES TO READ:
- src/lib/automation/conditions.ts (condition evaluation)
- src/lib/automation/actions.ts (action execution)
- src/lib/automation/scheduler.ts (time-based scheduler)
- src/lib/automation/ticket-from-event.ts (event-to-ticket)
- src/lib/automation/__tests__/executor.test.ts
- src/lib/automation/__tests__/scheduler.test.ts
- src/lib/automation/__tests__/side-effects.test.ts
- src/app/rules/page.tsx (rules UI)
- src/app/workflows/page.tsx (workflows UI)
- src/db/schema.ts (rules, automation_rules tables)
- cli/mcp/tools/ (look for rule-related MCP tools)

PRODUCE: Full implementation plan for production workflow engine.
```

### Agent 4: Marketplace & Plugin Platform

```
FEATURE: App marketplace and plugin ecosystem

COMPETITIVE CONTEXT:
- Zendesk Marketplace: 1,500-1,900+ apps, ZAF (Zendesk Apps Framework), sidebar/background/modal apps
- Freshdesk Marketplace: 1,000+ apps, serverless app platform, frontend placeholders
- Intercom App Store: 350+ apps, Canvas Kit for custom UI, data connectors
- CLIaaS today: plugin registry is local JSONL/in-memory with demo defaults (src/lib/plugins.ts:45, :71)

WHAT NEEDS TO EXIST:
1. Plugin SDK: defined interface for building CLIaaS apps (hooks, UI slots, API access)
2. Sandboxed execution: plugins run in isolation (existing sandbox.ts may help)
3. Plugin manifest format: name, version, hooks, permissions, UI slots
4. Plugin registry in DB (not JSONL): install, enable, disable, uninstall per workspace
5. Hook system: plugins can hook into ticket.created, message.created, etc.
6. UI extension points: sidebar panels in ticket view, dashboard widgets, settings pages
7. OAuth for plugins: secure credential storage for third-party API access
8. Marketplace page: browse, search, install plugins
9. Plugin development workflow: local dev server, hot reload, testing
10. First-party plugins: Slack notifications, Jira sync, Salesforce sync as reference implementations

FILES TO READ:
- src/lib/plugins.ts (current plugin system)
- src/lib/events/dispatcher.ts (executePluginHook)
- src/lib/sandbox.ts (sandbox system)
- src/lib/sandbox-clone.ts (sandbox cloning)
- src/lib/sandbox-diff.ts (sandbox diffing)
- src/app/integrations/page.tsx (integrations UI)
- src/db/schema.ts (integrations table)
- cli/mcp/tools/ (check for plugin-related tools)

PRODUCE: Full implementation plan for marketplace platform.
```

### Agent 5: Workforce Management (WFM)

```
FEATURE: Workforce management — forecasting, scheduling, shift planning

COMPETITIVE CONTEXT:
- Zendesk WFM ($35/agent/month): AI-powered forecasting, automatic scheduling, real-time adherence, intraday management, time-off management, multi-channel scheduling
- Salesforce Workforce Engagement: similar forecasting and scheduling
- CLIaaS today: routing is static config + in-memory load simulation (src/lib/ai/router.ts:47, :101); QA auto-review generates random scores (qa auto route)

WHAT NEEDS TO EXIST:
1. Agent schedules: define shifts, breaks, off-hours per agent
2. Schedule templates: reusable weekly patterns
3. Business hours integration: schedules respect business hour configs
4. Volume forecasting: predict ticket volume by channel, hour, day using historical data
5. Staffing recommendations: "you need N agents at 2pm on Tuesdays"
6. Real-time adherence: track agent status vs scheduled activity
7. Time-off management: PTO requests and approval
8. Schedule conflict detection
9. WFM dashboard: schedule view, adherence metrics, forecast vs actual
10. Agent utilization metrics: occupancy, handle time, idle time

FILES TO READ:
- src/lib/ai/router.ts (current routing/load logic)
- src/lib/realtime/presence.ts (agent presence)
- src/db/schema.ts (users, time_entries tables)
- src/lib/queue/stats.ts (queue statistics)
- src/app/analytics/ (analytics pages)
- cli/commands/time.ts (time tracking CLI)

PRODUCE: Full implementation plan for WFM system.
```

---

## Batch 2 (Connector Parity + Agent Productivity)

### Agent 6: Connector Write-Depth Parity

```
FEATURE: Fix connector write-depth gaps across all upstream adapters

COMPETITIVE CONTEXT:
- Competitors obviously have full write access to their own platforms
- CLIaaS positions itself as a hub that syncs bidirectionally with source helpdesks
- Current gaps: HubSpot adapter lacks update/reply (cli/sync/upstream-adapters/hubspot.ts:15), Kayako/Kayako Classic return null adapter (cli/sync/upstream-adapters/index.ts), HelpCrunch create uses placeholder customerId 0 (cli/sync/upstream-adapters/helpcrunch.ts:47)
- Most connectors do full re-export instead of incremental sync (only Zendesk has cursor)

WHAT NEEDS TO EXIST:
1. HubSpot: implement updateTicket and postReply using HubSpot Conversations API
2. Kayako Modern: implement upstream adapter (create, update, reply)
3. Kayako Classic: implement upstream adapter or document as unsupported
4. HelpCrunch: fix customerId resolution (lookup by email before falling back)
5. Incremental sync for Freshdesk, Intercom, Help Scout, Zoho, Groove, HelpCrunch
6. Sync health monitoring: detect stale cursors, failed syncs, data drift
7. Connector capability matrix: machine-readable feature flags per connector
8. Integration tests: at minimum, mock-based smoke tests per adapter

FILES TO READ:
- cli/sync/upstream-adapter.ts (adapter interface)
- cli/sync/upstream-adapters/ (all adapter implementations)
- cli/sync/upstream.ts (upstream push engine)
- cli/sync/engine.ts (sync engine)
- cli/connectors/ (all 10 connectors: zendesk.ts, freshdesk.ts, intercom.ts, helpscout.ts, zoho-desk.ts, hubspot.ts, groove.ts, helpcrunch.ts, kayako.ts, kayako-classic.ts)
- cli/sync/auth.ts (credential resolution)
- ARCHITECTURE.md (upstream sync section)

PRODUCE: Full plan to achieve write-depth parity across all connectors.
```

### Agent 7: Canned Responses, Macros & Signatures

```
FEATURE: Saved reply templates, one-click macro actions, agent email signatures

COMPETITIVE CONTEXT:
- Every single competitor has canned responses (Zendesk, Freshdesk, Intercom, Help Scout all have saved replies/macros)
- Zendesk macros: one-click to set fields + add reply + assign + tag simultaneously
- Freshdesk scenario automations: same concept
- Help Scout saved replies: template with merge variables
- CLIaaS today: no canned response system exists

WHAT NEEDS TO EXIST:
1. Canned responses table: title, body (with merge variables like {{customer.name}}, {{ticket.id}}), category, scope (personal/shared), created_by
2. Macros table: name, actions[] (set_field, add_tag, assign, set_status, add_reply), scope
3. Agent signatures table: per-agent or per-brand HTML signatures
4. API: CRUD for canned responses, macros, signatures
5. UI: canned response picker in ticket reply composer (search + insert)
6. UI: macro button in ticket detail (one-click apply)
7. UI: signature management in agent settings
8. CLI: commands for managing canned responses
9. MCP tools: search_canned_responses, apply_macro
10. Merge variable resolution engine: {{customer.*}}, {{ticket.*}}, {{agent.*}}

FILES TO READ:
- src/db/schema.ts (check for any existing canned/macro tables)
- src/app/tickets/[id]/page.tsx (ticket detail UI)
- src/app/settings/page.tsx (settings page)
- cli/commands/ (existing command patterns)
- cli/mcp/tools/ (existing tool patterns)
- src/lib/channels/email-store.ts (email sending)

PRODUCE: Full implementation plan for canned responses, macros, and signatures.
```

### Agent 8: Agent Collision Detection

```
FEATURE: Real-time collision detection when multiple agents view/edit a ticket

COMPETITIVE CONTEXT:
- Zendesk: shows who is viewing + who is typing on same ticket
- Freshdesk: eye icon (viewing) + pen icon (typing reply)
- Help Scout: real-time collision indicators, prevents duplicate replies
- CLIaaS today: SSE infrastructure exists (src/lib/realtime/events.ts) but no collision detection

WHAT NEEDS TO EXIST:
1. Presence tracking per ticket: when agent opens ticket detail, broadcast to other viewers
2. Typing indicator: when agent starts composing reply, broadcast "Agent X is typing"
3. UI indicators: show avatars/names of other agents viewing the ticket
4. Warning on submit: if another agent submitted a reply while you were composing, show warning
5. Auto-expire: presence removed after 30s of inactivity or page navigation
6. SSE events: ticket:agent_viewing, ticket:agent_typing, ticket:agent_left
7. Server-side: in-memory presence map (ticket_id -> Set<agent_id, timestamp>)
8. Graceful degradation: works without Redis, optionally uses Redis pubsub for multi-instance

FILES TO READ:
- src/lib/realtime/events.ts (SSE event system)
- src/lib/realtime/presence.ts (existing presence system)
- src/app/tickets/[id]/page.tsx (ticket detail page)
- src/lib/push.ts (push notification system)
- src/app/api/ (look for SSE endpoints)

PRODUCE: Full implementation plan for collision detection.
```

### Agent 9: Internal Notes & Side Conversations

```
FEATURE: Private agent-only notes within tickets and side conversations with external parties

COMPETITIVE CONTEXT:
- Zendesk: internal notes (private comments) + side conversations (email/Slack/Teams threads within a ticket, even child tickets)
- Freshdesk: private notes + Team Huddle (internal discussion threads) + Freshconnect (external collaborators)
- Help Scout: private notes with @mentions
- CLIaaS today: messages table exists but unclear if internal/private flag is implemented

WHAT NEEDS TO EXIST:
1. Internal notes: messages with is_internal=true, hidden from customer portal/email
2. @mentions in notes: notify specific agents
3. Side conversations: sub-threads within a ticket that can be sent via email to external parties (vendors, partners)
4. Side conversation replies thread back into the ticket
5. UI: toggle between "Reply" and "Note" in ticket composer
6. UI: side conversation panel showing all sub-threads
7. Portal filtering: internal notes never shown in customer portal
8. Email filtering: internal notes never sent in email notifications
9. API: create note, create side conversation, reply to side conversation
10. MCP tools: ticket_note (may exist), side_conversation_create

FILES TO READ:
- src/db/schema.ts (messages, conversations tables — check for is_internal column)
- src/app/tickets/[id]/page.tsx (ticket detail)
- src/app/portal/tickets/[id]/page.tsx (portal ticket view)
- cli/mcp/tools/ (check for ticket_note tool)
- src/lib/channels/email-store.ts (email notifications)
- src/lib/events/dispatcher.ts (event handling)

PRODUCE: Full implementation plan for internal notes and side conversations.
```

### Agent 10: Ticket Merge & Split

```
FEATURE: Merge duplicate tickets and split multi-issue tickets

COMPETITIVE CONTEXT:
- Zendesk: merge tickets (combine into one, others become followers)
- Freshdesk: merge + split + linked/tracker tickets
- Help Scout: merge conversations
- CLIaaS today: no merge or split functionality

WHAT NEEDS TO EXIST:
1. Merge: select 2+ tickets, pick primary, move all messages/notes to primary, close secondaries with "merged into #X" note
2. Merge preserves: all messages chronologically, all attachments, all tags (union), customer associations
3. Merge audit: record which tickets were merged, by whom, when
4. Split: select messages within a ticket, create new ticket from those messages
5. Split preserves: original message order, attachments, customer association
6. Split creates: back-reference in both tickets ("split from #X" / "split to #Y")
7. API: POST /api/tickets/merge, POST /api/tickets/:id/split
8. UI: merge button in ticket list (multi-select), split button in ticket detail
9. CLI: cliaas tickets merge --ids 1,2,3 --primary 1
10. MCP tool: ticket_merge, ticket_split
11. Undo consideration: soft-merge with ability to unmerge within time window

FILES TO READ:
- src/db/schema.ts (tickets, messages, conversations tables)
- src/app/tickets/page.tsx (ticket list)
- src/app/tickets/[id]/page.tsx (ticket detail)
- src/lib/jsonl-store.ts (JSONL mode operations)
- cli/commands/tickets.ts (ticket CLI commands)
- cli/mcp/tools/ (ticket-related MCP tools)
- src/lib/customers/customer-store.ts (customer merge exists — reference pattern)

PRODUCE: Full implementation plan for ticket merge and split.
```

---

## Batch 3 (Workspace & Time Features)

### Agent 11: Custom Views, Saved Filters & Tags

```
FEATURE: Agent-configurable ticket queue views, saved filters, and complete tags system

COMPETITIVE CONTEXT:
- Zendesk: views (personal + shared, up to 12 in sidebar), custom filtered ticket lists
- Freshdesk: custom ticket views with saved filters
- Help Scout: saved views with customizable filters
- CLIaaS today: views table exists in DB schema but no UI; tags table exists but no tagging UI

WHAT NEEDS TO EXIST:
1. Views: saved filter configurations (conditions on status, priority, assignee, tags, custom fields, date ranges)
2. Personal views (per-agent) and shared views (per-workspace)
3. View ordering: drag-and-drop sidebar ordering
4. View counts: show ticket count per view in sidebar
5. Default views: "My Open Tickets", "Unassigned", "All Open", "Recently Updated"
6. Tags: tag CRUD, tag autocomplete in ticket detail, bulk tag operations
7. Tag-based filtering in views
8. API: CRUD for views, tag management
9. UI: sidebar with view list, tag picker in ticket detail, view builder page
10. MCP tools: view_list, view_create, tag_add, tag_remove

FILES TO READ:
- src/db/schema.ts (views, tags, ticket_tags tables)
- src/app/dashboard/page.tsx (current ticket queue)
- src/app/tickets/page.tsx (ticket list)
- src/app/tickets/[id]/page.tsx (ticket detail)
- src/components/ (shared components — check for sidebar, filters)
- cli/commands/tickets.ts (ticket list/search)

PRODUCE: Full implementation plan for views, filters, and tags.
```

### Agent 12: Business Hours & Schedules

```
FEATURE: Configurable business hours, timezone support, holiday calendars

COMPETITIVE CONTEXT:
- Zendesk: multiple business schedules + holiday lists, SLA calculated against business hours
- Freshdesk: multiple business hour sets per group/region, holiday calendars, SLA integration
- CLIaaS today: SLA exists but no business hours concept — SLAs likely calculate against calendar time

WHAT NEEDS TO EXIST:
1. Business hours table: name, timezone, daily schedule (Mon-Sun open/close times), holiday list
2. Multiple schedules: different hours per group/region/brand
3. Holiday calendar: named holidays with dates, associated with schedules
4. SLA integration: calculate SLA elapsed time only during business hours
5. Routing integration: route to agents whose schedule is currently active
6. API: CRUD for business hours, holidays
7. UI: business hours configuration page (weekly grid editor)
8. Timezone handling: display times in agent's local timezone, calculate in schedule's timezone
9. "Next business day" calculation utility
10. CLI: business-hours commands

FILES TO READ:
- src/db/schema.ts (sla_policies, sla_events tables)
- src/lib/sla.ts (SLA calculation logic — if exists)
- src/app/sla/page.tsx (SLA management page)
- cli/commands/ (SLA-related commands)
- src/lib/automation/scheduler.ts (time-based automation)

PRODUCE: Full implementation plan for business hours system.
```

### Agent 13: Custom Reports & Analytics

```
FEATURE: Custom report builder, scheduled report exports, real-time live dashboard

COMPETITIVE CONTEXT:
- Zendesk Explore: custom reports from scratch, custom dashboards, real-time dashboards, scheduled delivery, calculated metrics, 100+ chart types
- Freshdesk: custom reports/dashboards (Pro+), scheduled exports, drill-down
- Intercom: 12 curated templates, custom reports (Advanced+), real-time dashboard
- Help Scout: pre-built only, no custom report builder
- CLIaaS today: analytics page exists but unclear depth; no custom report builder; no scheduled exports

WHAT NEEDS TO EXIST:
1. Report builder: select metrics (ticket count, avg response time, CSAT, resolution time), group by (agent, group, channel, priority, tag, time period), filter by (date range, status, etc.)
2. Visualization types: line chart, bar chart, pie chart, table, number card
3. Custom dashboards: arrange multiple report widgets on a canvas
4. Pre-built reports: ticket volume, agent performance, SLA compliance, CSAT trends, channel breakdown, AI resolution rate
5. Scheduled exports: email PDF/CSV reports on daily/weekly/monthly schedule
6. Real-time dashboard: live ticket queue depth, agent availability, current wait times, active conversations
7. Data drill-down: click a chart point to see underlying tickets
8. Report sharing: shareable links, embed in external pages
9. API: report CRUD, report execution, export endpoints
10. Dashboard SSE: real-time metric updates

FILES TO READ:
- src/app/analytics/page.tsx (current analytics page)
- src/db/schema.ts (all tables — understand available data)
- src/lib/queue/stats.ts (queue statistics)
- src/lib/realtime/events.ts (SSE system)
- src/lib/metrics.ts (Prometheus metrics)
- cli/commands/ (check for stats/analytics commands)
- src/app/api/ (check for analytics/reporting endpoints)

PRODUCE: Full implementation plan for reports, dashboards, and scheduled exports.
```

### Agent 14: KB Enhancements (Multi-language, Themes, Multi-brand, Answer Bot)

```
FEATURE: Multilingual KB, branded help center themes, multi-brand support, answer bot/KB deflection

COMPETITIVE CONTEXT:
- Zendesk: 40+ languages, up to 300 help centers, full CSS/JS theming, Answer Bot, generative search, content cues
- Freshdesk: multilingual articles, multi-product portals, branded portals, auto-suggest articles, internal KB
- Intercom: multilingual (Advanced+), Knowledge Hub, Fin surfaces articles in chat
- Help Scout: no multilingual, no themes (only CSS), Beacon suggests articles
- CLIaaS today: KB exists (collections, categories, articles, revisions) but no multi-language, no theming, no answer bot deflection

WHAT NEEDS TO EXIST:
1. Article translations: locale field on articles, one article per language variant linked by parent_id
2. Language detection: auto-detect customer language, show matching KB
3. Help center theming: CSS/template customization per brand
4. Multi-brand: multiple help centers with different branding, each scoped to a brand
5. Answer Bot / KB Deflection: when customer starts typing a ticket, suggest relevant articles BEFORE submission
6. In-chat article suggestions: during live chat, surface relevant articles
7. Content cues: AI identifies gaps in KB coverage based on unanswered ticket topics
8. Article SEO: meta titles, descriptions, canonical URLs, sitemap generation
9. Internal KB: agent-only articles not visible to customers
10. Article feedback: helpful/not helpful ratings with analytics

FILES TO READ:
- src/db/schema.ts (kb_collections, kb_categories, kb_articles, kb_revisions, brands tables)
- src/app/kb/page.tsx (KB management page)
- src/app/portal/kb/page.tsx (customer-facing KB)
- src/app/portal/page.tsx (portal main page)
- cli/commands/ (KB-related commands)
- cli/rag/ (RAG system — chunker, embedding, retriever)
- cli/mcp/tools/ (kb_search, kb_suggest tools)

PRODUCE: Full implementation plan for KB enhancements.
```

### Agent 15: Light Agents & Enhanced RBAC

```
FEATURE: Limited-permission agent roles, collaborator access, granular RBAC

COMPETITIVE CONTEXT:
- Zendesk: light agents (view + private comments, Growth+), custom roles (Enterprise+), contextual workspaces
- Freshdesk: custom agent roles with granular permissions (Enterprise), Freshconnect for external collaborators
- Help Scout: light users (Plus/Pro), Owner/Admin/User roles
- Intercom: custom roles and permissions
- CLIaaS today: basic auth exists but role system unclear; no light agent concept

WHAT NEEDS TO EXIST:
1. Role definitions: owner, admin, agent, light_agent, collaborator (custom roles later)
2. Light agents: can view tickets, add internal notes, but cannot reply to customers or change ticket status
3. Collaborators: external users who can view specific tickets (e.g., for vendor escalation)
4. Permission matrix: per-role access to pages, actions, API endpoints
5. Custom roles (stretch): define arbitrary permission sets
6. Role assignment: per-user, inheritable from group
7. UI: role management in admin settings, role indicator in user list
8. API middleware: permission checking on all 148 API routes
9. Seat-based billing impact: light agents may be free or discounted

FILES TO READ:
- src/db/schema.ts (users table — check for role column)
- src/lib/auth/ (all auth files)
- src/lib/security/ (rate-limiter, access-review, headers)
- src/lib/api-keys.ts (API key permissions)
- src/app/settings/page.tsx (settings)
- ARCHITECTURE.md (auth section, known tech debt about 88% unprotected routes)

PRODUCE: Full implementation plan for RBAC and light agents.
```

---

## Batch 4 (AI, Security, Advanced Features)

### Agent 16: Data Masking, PII Redaction & HIPAA

```
FEATURE: Auto-detect and mask sensitive data, HIPAA compliance path

COMPETITIVE CONTEXT:
- Zendesk ADPP ($50/agent/month): access logs, BYOK encryption, data retention, data masking, redaction suggestions, auto-redaction
- Freshdesk: HIPAA configuration, data masking for SSN/credit cards
- Help Scout: automatic redaction (GA April 2026)
- Intercom: HIPAA on Expert plan with BAA
- Freddy AI Trust: PII detection/anonymization, jailbreak protection
- CLIaaS today: GDPR export/delete exists, retention policies exist, but no PII detection or data masking

WHAT NEEDS TO EXIST:
1. PII detection engine: regex + AI-based detection of SSN, credit cards, phone numbers, emails, addresses in messages
2. Auto-redaction: replace detected PII with masked values ([REDACTED-SSN]) in stored messages
3. Redaction suggestions: flag detected PII for agent review before auto-masking
4. Data masking by role: light agents see masked data, full agents see original
5. Audit log for PII access: who viewed unmasked data, when
6. HIPAA readiness: BAA template, encrypted custom fields, access controls checklist
7. Configurable sensitivity: per-workspace rules for what gets detected/redacted
8. Retroactive scan: scan existing messages for PII
9. API: PII scan endpoint, redaction management
10. CLI: cliaas compliance pii-scan, cliaas compliance redact

FILES TO READ:
- src/lib/compliance/ (soc2.ts, audit-report.ts, gdpr-db.ts, retention-scheduler.ts)
- src/db/schema.ts (gdpr_deletion_requests, retention_policies tables)
- src/lib/security/ (all security files)
- src/app/compliance/page.tsx (compliance dashboard)
- docs/pentest-checklist.md (if exists)

PRODUCE: Full implementation plan for PII/data masking and HIPAA compliance path.
```

### Agent 17: AutoQA & AI Predictions

```
FEATURE: AI auto-scoring of all conversations, satisfaction prediction, customer health scores

COMPETITIVE CONTEXT:
- Zendesk QA ($35/agent/month): AutoQA scores 100% of conversations, spotlight categories, coaching, BPO monitoring, calibration
- Zendesk: satisfaction prediction on tickets
- Intercom: AI insights, Fin analytics
- Freshdesk Freddy: sentiment analysis, canned response suggestions
- CLIaaS today: QA exists but manual; auto-review endpoint generates random scores for demo (qa auto route); no satisfaction prediction or health scores

WHAT NEEDS TO EXIST:
1. AutoQA pipeline: AI reviews every resolved conversation and scores on configurable criteria (tone, accuracy, completeness, grammar, empathy)
2. Scorecard templates: customizable evaluation rubrics
3. Score persistence: store AI scores alongside manual QA reviews
4. Agent performance dashboard: per-agent quality trends, top/bottom performers
5. Satisfaction prediction: predict CSAT score before survey is sent (based on conversation tone, resolution time, topic)
6. Customer health score: aggregate metric per customer (ticket frequency, sentiment trend, CSAT history, churn risk)
7. Spotlight/flags: AI flags conversations needing attention (negative sentiment, compliance risk, escalation patterns)
8. Coaching workflow: manager assigns flagged conversations for agent review
9. Calibration: compare AI scores vs manual scores to tune the model
10. Analytics: QA trends over time, correlation with CSAT

FILES TO READ:
- src/lib/ai/qa.ts (existing AI QA)
- src/lib/qa/ or src/lib/ (QA store — qa-store if exists)
- src/app/qa/page.tsx (QA dashboard)
- src/app/api/ (QA auto route)
- src/db/schema.ts (qa_scorecards, qa_reviews tables)
- src/lib/ai/agent.ts (AI capabilities)
- cli/commands/qa.ts (QA CLI)
- cli/mcp/tools/ (qa-related MCP tools)

PRODUCE: Full implementation plan for AutoQA, satisfaction prediction, and health scores.
```

### Agent 18: Visual Chatbot Flow Builder

```
FEATURE: No-code drag-and-drop chatbot flow builder

COMPETITIVE CONTEXT:
- Zendesk: bot builder with visual flow editor
- Freshdesk: visual no-code chatbot builder with dialog flows
- Intercom: custom bots with conversational flows, Fin AI agent
- CLIaaS today: chatbots page exists (src/app/chatbots/page.tsx) but unclear if there's a visual builder; existing chatbot MCP tools exist

WHAT NEEDS TO EXIST:
1. Flow data model: nodes (message, question, condition, action, AI response, article suggestion, handoff) + edges (connections between nodes)
2. Visual canvas: drag-and-drop flow builder (React Flow or similar)
3. Node types: send message, ask question (free text, buttons, dropdown), check condition (customer attribute, message content), perform action (create ticket, set field, tag), AI response (RAG-powered), suggest article, transfer to agent
4. Flow execution engine: stateful conversation walker that tracks position in flow
5. Multi-channel deployment: same flow works in chat widget, portal, messaging channels
6. Testing: preview/test a flow in a sandbox chat window
7. Analytics: per-flow completion rate, drop-off points, handoff rate, resolution rate
8. Flow versioning: publish/draft, rollback
9. API: flow CRUD, flow execution
10. Integration with AI: nodes can invoke LLM for dynamic responses using RAG

FILES TO READ:
- src/app/chatbots/page.tsx (chatbot page)
- src/app/chat/page.tsx (chat page)
- src/app/chat/embed/page.tsx (embeddable chat)
- src/lib/channels/ (chat-related files)
- cli/mcp/tools/ (chatbot-related MCP tools)
- src/db/schema.ts (check for chatbot/flow tables)

PRODUCE: Full implementation plan for visual chatbot flow builder.
```

### Agent 19: Campaign Orchestration & Product Tours

```
FEATURE: Multi-step campaign builder, in-app product tours, targeted messages

COMPETITIVE CONTEXT:
- Intercom Series: visual multi-step campaign builder across email, push, chat, product tours, mobile carousels — behavior-based branching
- Intercom Product Tours ($199/month): step-by-step guided walkthroughs with modals and pointers
- Intercom Messages: targeted in-app messages based on user behavior/attributes
- CLIaaS today: campaigns exist (basic create + send) but no multi-step orchestration or visual builder; no product tours; no targeted in-app messages

WHAT NEEDS TO EXIST:
1. Campaign orchestration: multi-step sequences with delays, conditions, branching
2. Visual campaign builder: drag-and-drop canvas for designing sequences
3. Step types: send email, send in-app message, wait (delay), check condition (opened email? visited page?), branch (yes/no paths)
4. Audience targeting: segment customers by attributes, behavior, tags, ticket history
5. Campaign analytics: open rates, click rates, conversion rates, per-step funnel
6. Product tours: lightweight step-by-step overlays in the customer portal or agent UI
7. Tour builder: define steps (target element, message, position), save as reusable tour
8. Targeted messages: show contextual messages in portal/widget based on page, time, customer segment
9. Message types: banner, modal, tooltip, slide-in
10. Frequency controls: don't show the same message twice, rate limit per customer

FILES TO READ:
- src/app/campaigns/page.tsx (campaign page)
- src/lib/campaigns/ or src/lib/ (campaign store)
- src/db/schema.ts (campaigns, campaign_recipients tables)
- src/lib/ai/proactive.ts (proactive AI)
- src/app/portal/ (portal pages — where tours/messages would appear)
- cli/commands/campaigns.ts (campaign CLI)
- cli/mcp/tools/ (campaign MCP tools)

PRODUCE: Full implementation plan for campaign orchestration, product tours, and targeted messages.
```

### Agent 20: Integrations (Jira/Linear, CRM, Custom Objects)

```
FEATURE: Jira/Linear engineering escalation, deep CRM sync, user-definable custom objects

COMPETITIVE CONTEXT:
- Zendesk: Jira integration (bidirectional), Salesforce integration (native), custom objects with relationships, Sunshine platform
- Freshdesk: Jira, Salesforce, HubSpot native integrations; custom objects API
- Intercom: Salesforce, HubSpot, Jira, Stripe integrations; data connectors in workflows
- Pylon: 17+ integrations including Linear, Jira, GitHub, Salesforce, HubSpot, Snowflake
- CLIaaS today: HubSpot connector exists for ticket sync but no deep CRM sync; no Jira/Linear; no custom objects

WHAT NEEDS TO EXIST:

Jira/Linear Integration:
1. Link tickets to Jira issues / Linear issues
2. Create Jira/Linear issue from ticket (with context)
3. Bidirectional status sync (Jira resolved -> CLIaaS ticket updated)
4. Comment sync: notes in CLIaaS appear as Jira comments and vice versa
5. UI: "Link to Jira" / "Create Linear Issue" buttons in ticket detail

CRM Integration:
6. Salesforce sync: contacts, accounts, opportunities linked to customers
7. HubSpot sync: contacts, companies, deals linked to customers
8. Customer sidebar: show CRM data (deal stage, revenue, owner) alongside tickets
9. Bidirectional: customer updates in CLIaaS push to CRM

Custom Objects:
10. Schema builder: define custom object types (name, fields, relationships)
11. Object instances: CRUD on custom object records
12. Relationships: link custom objects to tickets, customers, or each other
13. API: full CRUD for custom object definitions and instances
14. UI: custom objects management page, object records in ticket sidebar
15. MCP tools: custom_object_create, custom_object_search

FILES TO READ:
- src/db/schema.ts (integrations, external_objects tables, custom_fields)
- src/lib/connector-registry.ts (connector registry)
- cli/connectors/hubspot.ts (HubSpot connector)
- src/app/integrations/page.tsx (integrations page)
- src/app/customers/[id]/page.tsx (customer detail — where CRM data would show)
- src/app/tickets/[id]/page.tsx (ticket detail — where Jira link would show)
- cli/mcp/tools/ (integration-related tools)
- src/lib/custom-fields.ts (custom fields system)

PRODUCE: Full implementation plan for Jira/Linear, CRM, and custom objects.
```

---

## How to Run

Launch 5 agents per session. Paste the shared context block at the top of each prompt, then the agent-specific block.

**Session 1:** Agents 1-5 (Strategic Gaps)
**Session 2:** Agents 6-10 (Connector Parity + Agent Productivity)
**Session 3:** Agents 11-15 (Workspace + Time Features)
**Session 4:** Agents 16-20 (AI, Security, Advanced Features)

Each agent should write its plan to `docs/plans/plan-NN-name.md`. After all 20 complete, a synthesis agent should read all plans and produce a prioritized implementation roadmap.
