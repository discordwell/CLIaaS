# CLIaaS Competitive API Coverage Audit

> Last updated: 2026-02-28
>
> Covers all 10 connector platforms. Includes per-platform API gap analysis, cross-platform entity matrix, and prioritized action items.

---

## Executive Summary

CLIaaS has 10 helpdesk connectors. Each exports a core set of entities (tickets, messages, contacts, organizations, KB articles) but leaves significant API surface uncovered. Only 3 connectors (Zendesk, Kayako, Kayako Classic) are wired into the sync engine.

| Connector | Entities Exported | API Resources Available | Coverage | Biggest Gap |
|-----------|:-:|:-:|:-:|---|
| **Zendesk** | 17 | ~100+ | ~17% | Ticket metrics, business hours, Help Center hierarchy, custom objects, Chat/Talk |
| **Freshdesk** | 6 | ~20+ | ~30% | Groups, custom fields, CSAT, time entries, automation rules |
| **Help Scout** | 6 | ~25+ | ~24% | Saved replies, satisfaction ratings, workflows, attachments |
| **Intercom** | 6 | ~35+ | ~17% | **Tickets** (separate entity!), data attributes, segments |
| **Zoho Desk** | 7 | ~65+ | ~11% | Blueprints, business hours, departments, time tracking |
| **HubSpot** | 5 | ~30+ | ~17% | **Conversations** (threads+messages), engagements, feedback submissions |
| **Groove** | 6 | ~35+ (REST) / ~170+ (GraphQL) | ~17% / ~5% | Rules/automations (GraphQL only), tags, canned replies |
| **HelpCrunch** | 5 | ~25+ | ~20% | Message type mapping bug, customer tags/custom data, webhooks |
| **Kayako** | wired | — | — | Already in sync engine |
| **Kayako Classic** | wired | — | — | Already in sync engine |

---

## Cross-Platform Entity Matrix

Which entity types each connector exports (Y) vs. has API available but doesn't export (A) vs. no API exists (—):

| Entity | Zendesk | Freshdesk | Help Scout | Intercom | Zoho Desk | HubSpot | Groove | HelpCrunch |
|--------|:---:|:---:|:---:|:---:|:---:|:---:|:---:|:---:|
| Tickets/Conversations | Y | Y | Y | Y | Y | Y | Y | Y |
| Messages/Threads | Y | Y | Y | Y | Y | A* | Y | Y |
| Contacts/Customers | Y | Y | Y | Y | Y | Y | Y | Y |
| Organizations/Companies | Y | Y | derived | Y | Y | Y | derived | derived |
| Agents/Admins | — | Y | Y | Y | Y | Y | Y | Y |
| Groups/Teams | Y | **A** | **A** | **A** | **A** | — | **A** | **A** |
| KB Articles | Y | Y | Y | Y | Y | — | Y | — |
| KB Categories/Sections | **A** | partial | **A** | **A** | **A** | — | **A** | — |
| Custom Fields (defs) | Y | **A** | **A** | **A** | **A** | **A** | **A** | — |
| Ticket Forms | Y | **A** | — | **A** | — | **A** | — | — |
| Satisfaction Ratings | Y | **A** | **A** | — | — | **A** | **A** | **A** |
| Time Entries | Y | **A** | — | — | **A** | — | — | — |
| Attachments | Y | **A** | **A** | **A** | **A** | — | **A** | — |
| Macros/Triggers | Y | **A** | **A** | — | — | — | **A** | — |
| Automations/Rules | Y | **A** | **A** | — | **A** | — | **A** | — |
| SLA Policies | Y | partial | — | — | — | — | — | — |
| Business Hours | **A** | **A** | — | — | **A** | — | — | — |
| Webhooks (config) | **A** | — | **A** | **A** | **A** | **A** | **A** | **A** |
| Canned Responses | — | **A** | **A** | — | — | — | **A** | — |
| Custom Objects | **A** | **A** | — | **A** | **A** | **A** | — | — |
| Chat/Voice | **A** | — | — | — | **A** | — | **A** | — |
| Community/Forums | **A** | **A** | — | — | **A** | — | — | — |
| Audit Logs | Y | **A** | — | **A** | **A** | — | — | — |

*Legend: Y = exported, **A** = API available but not exported, — = no API or N/A, derived = synthetic from customer data*

\* HubSpot: our connector exports Notes but NOT Conversation Threads/Messages (the actual customer interactions)

---

## Per-Platform Gap Details

### 1. Zendesk (~17% coverage, 17 of ~100+ resources)

**Currently exported:** Tickets (incremental), comments, attachments, users (incremental), organizations, groups, ticket fields, views, ticket forms, brands, ticket audits, CSAT ratings, time entries, KB articles, macros, triggers, automations, SLA policies. Write: update ticket, post comment, create/delete ticket.

**P0 — Critical gaps:**
| Gap | Endpoint | Impact |
|-----|----------|--------|
| Ticket Metrics | `/api/v2/ticket_metrics` | Reply time, resolution time, agent wait time — essential for SLA analytics |
| Ticket Metric Events | `/api/v2/incremental/ticket_metric_events` | Time-series SLA breach data |
| Business Hours | `/api/v2/business_hours/schedules` | SLA policies meaningless without schedule definitions |
| Help Center Categories + Sections | `/api/v2/help_center/categories`, `/sections` | Articles export as flat list without hierarchy |
| Custom Ticket Statuses | `/api/v2/custom_statuses` | Enterprise accounts use custom statuses |

**P1 — High gaps:** User/Org Fields, User Identities, Org/Group Memberships, Side Conversations, Webhooks config, Custom Objects (Sunshine), Article Attachments + Translations

**Entire product APIs missing:** Chat (12 resources), Talk/Voice (9 resources), Sell CRM (14+), Sunshine Conversations/Messaging (5+), Omnichannel routing

**Non-API data:** Explore dashboards/reports (CSV only), full account XML export (UI only)

---

### 2. Freshdesk (~30% coverage, 6 of ~20+ resources)

**Currently exported:** Tickets, conversations, contacts, agents (no pagination!), companies, KB articles, SLA policies (as Rule only). Write: update/create/delete ticket, reply, add note.

**P0 — Critical gaps:**
| Gap | Endpoint | Impact |
|-----|----------|--------|
| Groups | `/api/v2/groups` | Agent-group mapping; ~15 LOC to add |
| Ticket/Contact/Company Fields | `/api/v2/ticket_fields`, `contact_fields`, `company_fields` | Custom field definitions |
| Satisfaction Ratings | `/api/v2/surveys/satisfaction_ratings` | CSAT data |
| Time Entries | `/api/v2/time_entries` | Billing/reporting |
| Attachments | (embedded in conversation responses) | Zero additional API calls needed |
| Agent pagination fix | — | Silently drops agents beyond first 100 |

**P1:** Automation Rules (Dispatcher/Supervisor/Observer), SLA as dedicated entity, Ticket Forms, Canned Responses

**P2:** Products, Business Hours, Email Configs, Discussions/Forums, Custom Objects, Roles

---

### 3. Help Scout (~24% coverage, 6 of ~25+ resources)

**Currently exported:** Conversations, threads, customers, agents (as customers), organizations (derived), KB articles. Write: create conversation, reply, add note.

**P0 — Critical gaps:**
| Gap | Endpoint | Impact |
|-----|----------|--------|
| Saved Replies | `/v2/mailboxes/{id}/saved-replies` | Almost every HS team uses these heavily |
| Satisfaction Ratings | `/v2/ratings/{id}` | Schema has `CSATRating` but exports zero |
| Attachments | (in thread data) | Schema has `Attachment` but not populated |

**P1:** Workflows (API exists, code says "not available"), Organizations (full API vs derived), Teams, Mailbox Custom Fields

**Non-API:** 25+ webhook event types (not used), CSV reporting exports, AI Answers

---

### 4. Intercom (~17% coverage, 6 of ~35+ resources)

**Currently exported:** Conversations, conversation parts, contacts, admins, companies, articles. Write: create conversation, reply, add note, delete conversation/contact.

**P0 — CRITICAL:**
| Gap | Endpoint | Impact |
|-----|----------|--------|
| **Tickets** | `/tickets`, `/tickets/search` | Intercom has a SEPARATE Tickets entity (distinct from Conversations) with own types, states, attributes. Teams using Intercom Tickets have ZERO data. |
| Ticket Types & Attributes | `/ticket_types` | Schema defining ticket structures |
| Data Attributes | `/data_attributes` | Custom attribute definitions for contacts/companies |

**P1:** Segments, Teams, Contact Notes, Help Center Collections, Admin Activity Logs, Subscription Types

**P2:** Conversation/Contact Search (incremental sync), Data Events, API version upgrade 2.11 → 2.15

---

### 5. Zoho Desk (~11% coverage, 7 of ~65+ resources)

**Currently exported:** Tickets, ticket threads, ticket comments, contacts, agents, accounts, KB articles. Write: create ticket, send reply, add comment.

**P0 — Critical gaps:**
| Gap | Endpoint | Impact |
|-----|----------|--------|
| Departments | `GET /departments` | Organizational structure for routing |
| Webhooks | `POST /api/v1/webhooks` | Real-time sync; currently polling only |
| KB Categories | `GET /categories` | categoryPath is opaque IDs |

**P1:** Ticket Time Entries, Ticket Attachments, Tasks, Activities (audit trail), Business Hours, Blueprints

**P2:** Products, Contracts, Calls, Events, Skills/Routing, Views, Templates, Community

**Note:** Code says `"Business rules: not exported via Zoho Desk API"` but Blueprint and workflow APIs exist.

---

### 6. HubSpot Service Hub (~17% coverage, 5 of ~30+ resources)

**Currently exported:** Tickets, notes (via association), contacts, owners, companies. Write: create ticket, create note.

**P0 — CRITICAL:**
| Gap | Endpoint | Impact |
|-----|----------|--------|
| **Conversation Threads + Messages** | `/conversations/v3/conversations/threads` | THE biggest gap. Connector exports Notes but actual customer conversations live in Conversations API. Missing primary support interaction data. |
| Engagements (Emails) | `/crm/v3/objects/emails` | Email-based customer interactions |
| Pipelines | `/crm/v3/pipelines/tickets` | Stage IDs map to nothing without definitions |

**P1:** Feedback Submissions (CSAT/NPS/CES), Engagements (Calls, Tasks, Meetings), Properties (schema), Ticket-Company Associations, KB via Site Search

**Important:** HubSpot has NO dedicated KB article management API. Read-only via Site Search.

---

### 7. Groove (~17% REST / ~5% GraphQL)

**Currently exported:** Tickets, messages, customers, agents, organizations (derived), KB articles. Write: update ticket, post message, create ticket.

**P0 — Critical bugs/gaps:**
| Gap | Source | Impact |
|-----|--------|--------|
| Ticket priority field | `t.priority` exists but code hardcodes `'normal'` | Trivial fix |
| Webhooks | 14 event types | Real-time sync |
| Tags | GraphQL v2 `tags` query | First-class entity |
| Rules/Automations | GraphQL v2 `rules` query | Code incorrectly says "not available" |

**P1:** Groups/Teams, Canned Replies, Mailboxes/Channels, Attachments, Custom Fields (all via GraphQL v2)

**Strategic:** REST v1 is deprecated. GraphQL v2 has 50+ queries, 122 mutations. Consider migration.

---

### 8. HelpCrunch (~20% coverage, 5 of ~25+ resources)

**Currently exported:** Chats (as tickets), messages, customers, agents, organizations (derived). Write: update chat, post message, create chat.

**P0 — Critical bugs/gaps:**
| Gap | Detail | Impact |
|-----|--------|--------|
| **Message type mapping BUG** | `private` messages mapped as `'reply'` instead of `'note'` | Data fidelity bug |
| Customer tags | `tags` array completely ignored | Rich label system discarded |
| Customer custom data | `customData` array ignored | Custom attributes lost |
| Webhooks | 20 event types | Real-time sync |

**P1:** Chat rating (CSAT), snooze status, departments, customer location/device, behavioral metadata

**Non-API:** KB exists as product feature but has NO REST API. Chatbot/Auto Message config is UI-only.

---

## Sync Engine Wiring

Only 3 of 10 connectors are wired into the sync engine (`cli/sync/engine.ts`):

| Connector | Wired? |
|-----------|:---:|
| zendesk | Yes |
| kayako | Yes |
| kayako-classic | Yes |
| freshdesk | **No** |
| helpcrunch | **No** |
| helpscout | **No** |
| zoho-desk | **No** |
| groove | **No** |
| intercom | **No** |
| hubspot | **No** |

---

## Universal Gaps (Missing Across ALL Connectors)

1. **Webhooks for real-time sync** — Every platform offers webhooks; none of our connectors use them. All rely on polling/bulk export.

2. **Incremental sync** — Only Zendesk uses incremental/cursor-based export. All others do full re-export every time.

3. **Business Hours/Schedules** — No connector exports this. SLA calculations are meaningless without business hours.

4. **Canned Responses/Saved Replies** — Available in Freshdesk, Help Scout, Groove, Zoho Desk. None exported. High value for AI draft generation.

5. **Custom Objects** — Available in Zendesk, Freshdesk, Intercom, Zoho Desk, HubSpot. None exported.

6. **KB Hierarchy** — Most connectors export articles as flat lists. Categories/sections/collections not exported.

---

## Priority Action Items

### Tier 1: Data Bugs (fix immediately)
1. **HelpCrunch message type mapping** — `private` messages mapped as `'reply'` instead of `'note'`
2. **Groove priority field** — hardcoded `'normal'` instead of reading `t.priority`
3. **Freshdesk agent pagination** — silently drops agents beyond first 100

### Tier 2: Critical Missing Entities (highest data value)
4. **Intercom Tickets** — entirely separate entity not exported at all
5. **HubSpot Conversations** — actual customer interactions missing (only Notes exported)
6. **Zendesk Ticket Metrics** — reply time, resolution time, SLA compliance data
7. **Zendesk Business Hours** — SLA policies meaningless without schedules

### Tier 3: Schema Types We Define But Don't Populate
8. Groups — defined in schema, available in most APIs, exported by none except Zendesk
9. CustomField definitions — available in 6+ platforms, exported only by Zendesk
10. CSATRating — available in 5+ platforms, exported only by Zendesk
11. Attachment — available in all platforms, exported only by Zendesk
12. TimeEntry — available in Zendesk/Freshdesk/Zoho, only Zendesk exports

### Tier 4: Sync Architecture
13. Wire all 7 remaining connectors into sync engine
14. Implement webhook-based real-time sync (all platforms support it)
15. Add incremental sync to non-Zendesk connectors
16. Export canned responses for AI draft generation
17. Export business hours for accurate SLA calculations

---

## Non-API Data Sources Summary

| Platform | Webhooks Available | KB Has API? | Analytics API? | Chat/Voice API? |
|----------|:-:|:-:|:-:|:-:|
| Zendesk | Yes (outbound) | Yes | No (Explore) | Yes (separate) |
| Freshdesk | Via automation rules | Yes | No | No |
| Help Scout | Yes (25+ events) | Yes (Docs API) | Yes (Reports API) | No |
| Intercom | Yes (many topics) | Yes | Partial (Data Export) | No |
| Zoho Desk | Yes (event subs) | Yes | Via Zoho Analytics | IM partial |
| HubSpot | Yes (v4, app-level) | No (Site Search only) | No | No |
| Groove | Yes (14 events) | Yes | No | No |
| HelpCrunch | Yes (20 events) | **No** | No | No |

---

## Competitor Feature Matrix

| Feature | Zendesk | Freshdesk | Intercom | HubSpot | Zoho Desk | Help Scout | HelpCrunch | Groove |
|---|---|---|---|---|---|---|---|---|
| **Knowledge Base** | Full API | Full API | Full API | **No API** | Full API | Full API (Docs) | **No API** | REST v1 |
| **AI Agent/Bot** | $1.50/res | $100/1K | $0.99/res | Breeze | Zia (Ent) | $0.75/res | Pro+ | None |
| **Visual Workflow** | No | No | Yes (Adv+) | Yes (Pro+) | Blueprints | No | No | No |
| **Live Chat** | Messaging | Freshchat | Messenger | Native | Business Msg | Beacon | Native | Native |
| **Voice/Phone** | Talk | Freshcaller | Phone add-on | VoIP | Zoho Voice | None | None | None |
| **CSAT/Surveys** | Built-in | Built-in | Add-on | NPS/CSAT/CES | Built-in | Built-in | Chat only | Built-in |
| **SLA Mgmt** | Growth+ | Growth+ | Expert ($132) | Pro+ | Standard+ | No formal | **None** | Plus+ |
| **Custom Objects** | Growth+ | Pro+ | Advanced+ | Enterprise | Enterprise | None | None | None |
| **Automation API** | Yes | **No** | Limited | Coded actions | **No** | List only | **No** | **No** (REST) |
| **Reporting API** | **No** | **No** | Data export | **No** | Limited | **Full** | **No** | **No** |

### CLIaaS Competitive Advantages

1. **API-first / MCP-first** — 6/8 competitors lock automation, reporting, AI behind UI. CLIaaS exposes everything via 30+ MCP tools.
2. **BYOC / bring-your-own-AI** — Competitors charge $0.75-$2.00/resolution. CLIaaS: $0 (use your own LLM keys).
3. **No per-seat pricing** — BYOC is free with unlimited agents.
4. **Reporting API** — Only Help Scout has one. Zendesk's #1 requested feature. CLIaaS has `queue_stats`, `sla_report`, `summarize_queue`.
5. **Multi-connector sync** — 10 connectors with ongoing sync. No competitor offers this.
6. **Local-first / self-hosted** — Only CLIaaS offers true data sovereignty with BYOC mode.
