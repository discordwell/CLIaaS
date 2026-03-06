# CLIaaS Implementation Roadmap

**Generated:** 2026-03-06
**Scope:** 20 competitive gap plans prioritized into implementation waves

---

## 1. Summary Table

| Plan | Title | Effort | Key Dependencies | Summary |
|------|-------|--------|-----------------|---------|
| 01 | Autonomous AI Resolution Engine | L | RAG retriever, channel senders | Wire the no-op AI resolution worker to actually call the LLM, send replies, persist results, and track ROI |
| 02 | Omnichannel Routing Engine | L | Plan 12 (business hours), Plan 05 (WFM) | Replace hardcoded in-memory routing with DB-driven skills, capacity, queues, rules, and agent availability |
| 03 | Workflow Automation Engine | L | None | Fix critical gaps: persistent audit trail, actual webhook/notification dispatch, rule versioning, macros |
| 04 | Marketplace & Plugin Platform | XL | None | Move plugins from JSONL to DB, add sandboxed execution, OAuth, UI extension points, marketplace browse |
| 05 | Workforce Management | L | Plan 02 (routing), Plan 12 (business hours) | Agent schedules, shifts, forecasting, adherence tracking, utilization metrics, time-off management |
| 06 | Connector Write-Depth | L | None | Complete write adapters for all 10 connectors, add incremental sync to 6, add sync health monitoring |
| 07 | Canned Responses & Macros | M | None | Canned response templates with merge variables, one-click macros, agent signatures |
| 08 | Agent Collision Detection | M | None | Wire existing unused CollisionDetector component, add SSE-driven presence, submit-time collision prevention |
| 09 | Internal Notes & Side Conversations | L | None | Enhanced notes with @mentions/notifications, side conversations with email threading |
| 10 | Ticket Merge & Split | L | None | Merge duplicate tickets, split conversations, undo capability, merge/split history |
| 11 | Custom Views, Filters & Tags | L | None | Saved views with sidebar, tag management UI, view query execution, bulk tag operations |
| 12 | Business Hours & Timezones | M | None | Business hours schedules, holiday calendars, SLA calculation against business hours, timezone support |
| 13 | Custom Reports & Analytics | XL | None | Report builder, custom dashboards, scheduled exports, real-time live dashboard, drill-down |
| 14 | KB Enhancements | XL | RAG system | Multilingual articles, branded help centers, answer bot deflection, article feedback, content gap analysis |
| 15 | RBAC & Light Agents | L | None | Permission-based access control, light_agent/collaborator roles, group memberships, ticket collaborators |
| 16 | PII Masking & HIPAA | L | Plan 15 (RBAC for role-based masking) | PII detection engine, auto-redaction, sensitivity rules, HIPAA compliance controls, access audit |
| 17 | AutoQA & Predictions | XL | Plan 01 (AI pipeline) | Replace random QA scores with real LLM analysis, satisfaction prediction, customer health scores, coaching |
| 18 | Visual Chatbot Builder | XL | None | Drag-and-drop flow canvas with React Flow, 5 new node types, versioning, per-node analytics |
| 19 | Campaign Orchestration | XL | None | Multi-step campaign sequences, product tours, targeted in-app messages, segment evaluation engine |
| 20 | Integrations: CRM & Custom Objects | XL | None | Jira/Linear issue linking, Salesforce/HubSpot CRM sync, custom object schema builder with relationships |

---

## 2. Dependency Graph

```
Plan 12 (Business Hours) -----> Plan 02 (Routing) -----> Plan 05 (WFM)
                           \                          /
                            `--> Plan 05 (WFM) ------'

Plan 15 (RBAC) -----> Plan 16 (PII Masking) [role-based masking needs permissions]

Plan 01 (AI Resolution) -----> Plan 17 (AutoQA) [AutoQA piggybacks on AI pipeline]

Plan 03 (Workflow Engine) <---> Plan 02 (Routing) [share compound condition evaluator]

Plan 07 (Canned/Macros) overlaps Plan 03 (Workflows) [both define macro tables]

Plan 04 (Marketplace) soft-depends-on Plan 20 (Integrations) [Jira/Linear could be plugins]

Plan 11 (Views/Tags) unblocks Plan 13 (Reports) [tag management needed for report grouping]

Plan 09 (Notes/Side Convos) shares schema with Plan 08 (Collision) [both touch presence/messaging]

Plan 14 (KB Enhancements) enhances Plan 01 (AI Resolution) [answer bot uses RAG]
Plan 14 (KB Enhancements) enhances Plan 18 (Chatbot Builder) [article suggestion node]
```

### Overlap Clusters

| Cluster | Plans | Shared Infrastructure |
|---------|-------|----------------------|
| AI Pipeline | 01, 17, 14 | LLM providers, RAG retriever, BullMQ workers, AI config tables |
| Routing & Scheduling | 02, 05, 12 | Agent skills/capacity on users table, business_hours table, availability tracking |
| Automation | 03, 07 | Macro execution engine, action types, rules table consolidation |
| Real-time | 08, 09 | SSE events, presence tracker, notification system |
| Compliance & Security | 15, 16 | Permission model, role enforcement, audit logging |
| Content & Self-Service | 14, 18 | KB articles, RAG search, chatbot article suggestion nodes |
| External Systems | 06, 20 | Connector pattern, upstream adapters, sync health, webhook processing |
| Analytics | 11, 13, 17 | Tag management, report metrics, QA score data |

---

## 3. Prioritized Implementation Order

### Scoring Criteria

Each plan was evaluated on four axes (1-5 scale):

| Plan | Impact | Competitive Urgency | Effort Efficiency | Dependency Value | Total |
|------|--------|--------------------|--------------------|-----------------|-------|
| 07 | 5 | 5 | 5 | 2 | 17 |
| 08 | 4 | 4 | 5 | 2 | 15 |
| 12 | 4 | 4 | 4 | 5 | 17 |
| 03 | 5 | 3 | 4 | 4 | 16 |
| 11 | 4 | 4 | 3 | 3 | 14 |
| 06 | 4 | 3 | 3 | 3 | 13 |
| 15 | 4 | 3 | 3 | 5 | 15 |
| 01 | 5 | 5 | 3 | 4 | 17 |
| 09 | 4 | 4 | 3 | 2 | 13 |
| 10 | 3 | 3 | 4 | 2 | 12 |
| 02 | 4 | 4 | 2 | 4 | 14 |
| 16 | 3 | 3 | 3 | 2 | 11 |
| 17 | 5 | 5 | 2 | 2 | 14 |
| 14 | 4 | 4 | 2 | 3 | 13 |
| 05 | 3 | 3 | 2 | 2 | 10 |
| 13 | 4 | 4 | 1 | 2 | 11 |
| 18 | 4 | 4 | 1 | 2 | 11 |
| 20 | 4 | 4 | 1 | 2 | 11 |
| 19 | 3 | 4 | 1 | 2 | 10 |
| 04 | 3 | 2 | 1 | 2 | 8 |

---

## 4. Wave Breakdown

### Wave 1: Core Agent Productivity (Weeks 1-4)
**Theme:** Quick wins that make agents immediately more productive. Zero external dependencies.

| Plan | Effort | Key Deliverables |
|------|--------|-----------------|
| 07 - Canned Responses & Macros | M (8-13 days) | Canned response picker, one-click macros, agent signatures, merge variables |
| 08 - Agent Collision Detection | M (14-21 hours) | Real-time "who is viewing/typing", submit-time collision prevention, SSE presence |
| 12 - Business Hours & Timezones | M (8-12 days) | Business hours schedules, holiday calendars, SLA against business hours |

**Total estimated effort:** ~5-6 weeks (single developer)

**Why this wave:**
- Plans 07 and 08 are the two smallest-effort plans that close glaring competitive gaps (every competitor has canned responses and collision detection).
- Plan 12 has no dependencies but unblocks Plans 02 and 05 in later waves.
- All three are additive with zero breaking changes.
- After this wave, agents have canned responses, collision prevention, and business-hours-aware SLAs.

**Shared schema migration:** Combine into a single migration file:
- `canned_responses`, `macros`, `agent_signatures` tables (Plan 07)
- `ticket_collision_logs` table (Plan 08)
- `business_hours_schedules`, `business_hours_intervals`, `holiday_calendars`, `holidays`, `business_hours_schedule_holidays` tables (Plan 12)
- ALTER `users` ADD `timezone` (shared by Plans 05, 12)
- ALTER `groups` ADD `business_hours_schedule_id` (Plan 12)
- ALTER `sla_policies` ADD `business_hours_schedule_id` (Plan 12)

---

### Wave 2: Automation & Infrastructure (Weeks 5-10)
**Theme:** Fix critical infrastructure gaps and build the automation foundation.

| Plan | Effort | Key Deliverables |
|------|--------|-----------------|
| 03 - Workflow Automation Engine | L (12-20 days) | Persistent audit trail, webhook/notification dispatch, rule versioning, macro engine |
| 15 - RBAC & Light Agents | L (9-13 days) | Permission model, light_agent/collaborator roles, group memberships |
| 11 - Custom Views, Filters & Tags | L (12 days) | Saved views sidebar, tag CRUD, view query execution, bulk operations |
| 06 - Connector Write-Depth | L (50-69 hours) | All 10 connectors with write adapters, incremental sync for 6, sync health monitoring |

**Total estimated effort:** ~8-10 weeks (single developer)

**Why this wave:**
- Plan 03 fixes "for now" stubs that have been accumulating technical debt -- the automation system logs but never sends notifications or webhooks.
- Plan 15 (RBAC) is a prerequisite for Plan 16 (PII masking) and provides the permission infrastructure every enterprise customer expects.
- Plan 11 is a core helpdesk feature (saved views, tags) that every competitor ships. It also unblocks Plan 13 (reports need tag grouping).
- Plan 06 completes the connector story -- all 10 connectors gain full bidirectional sync.
- Consolidating the `automation_rules` -> `rules` table migration (Plan 03) with the views/tags schema changes (Plan 11) reduces migration churn.

**Shared schema migration:**
- `rule_executions`, `rule_versions` tables (Plan 03)
- Consolidate `automation_rules` into `rules` (Plan 03)
- `permissions`, `role_permissions`, `custom_roles`, `group_memberships`, `ticket_collaborators` tables (Plan 15)
- ALTER `views` ADD columns (Plan 11)
- ALTER `tags` ADD `color`, `description` (Plan 11)
- `connector_capabilities`, `sync_health` tables (Plan 06)

---

### Wave 3: AI & Intelligence (Weeks 11-18)
**Theme:** Activate the AI pipeline and build intelligence features that differentiate CLIaaS.

| Plan | Effort | Key Deliverables |
|------|--------|-----------------|
| 01 - AI Resolution Engine | L (3-4 weeks) | Working AI resolution worker, multi-channel reply, approval workflow, procedures engine |
| 02 - Omnichannel Routing | L (3-4 weeks) | DB-driven routing with skills, queues, rules, agent availability, routing analytics |
| 17 - AutoQA (Phase 1-2 only) | L (4 weeks) | Real LLM-based QA scoring, satisfaction prediction, spotlight flags |

**Total estimated effort:** ~10-12 weeks (single developer)

**Why this wave:**
- Plan 01 is the single highest-impact feature -- autonomous AI resolution is the core CLIaaS differentiator. It was deferred to Wave 3 because it needs the permission model (Wave 2) and business hours (Wave 1) to be in place.
- Plan 02 depends on business hours (Wave 1) and benefits from RBAC (Wave 2). It also provides the agent skills/capacity data that Plan 05 needs.
- Plan 17 Phase 1-2 (AutoQA + predictions) piggybacks on the AI pipeline built in Plan 01. Ship the core AutoQA and prediction engines; defer coaching and calibration to a later wave.
- These three plans share LLM provider infrastructure, BullMQ worker patterns, and the `ai_*` schema namespace.

**Shared schema migration:**
- `ai_resolutions`, `ai_procedures`, `ai_agent_configs` tables (Plan 01)
- `agent_skills`, `agent_capacity`, `group_memberships` (if not created in Wave 2), `routing_queues`, `routing_rules`, `routing_log` tables (Plan 02)
- ALTER `users` ADD `availability`, `last_seen_at` (Plan 02)
- ALTER `tickets` ADD `routed_at`, `routed_via`, `queue_id`, `predicted_csat`, `autoqa_score` (Plans 02, 17)
- `autoqa_configs`, `qa_flags`, `csat_predictions` tables (Plan 17)
- ALTER `qa_reviews` ADD `agent_id`, `ai_model`, `ai_latency_ms`, `suggestions` (Plan 17)

---

### Wave 4: Content & Self-Service (Weeks 19-26)
**Theme:** Enable customer self-service and close content management gaps.

| Plan | Effort | Key Deliverables |
|------|--------|-----------------|
| 09 - Internal Notes & Side Conversations | L (4 weeks) | @mentions, notifications, side conversations with email threading |
| 10 - Ticket Merge & Split | L (6-8 days) | Merge duplicate tickets, split conversations, undo merge |
| 14 - KB Enhancements (Phase 1-3) | L (4 weeks) | Multilingual KB, branded help centers, answer bot deflection |
| 16 - PII Masking | L (4-5 weeks) | PII detection, auto-redaction, sensitivity rules, HIPAA readiness |

**Total estimated effort:** ~12-14 weeks (single developer)

**Why this wave:**
- Plan 09 (notes/side conversations) and Plan 10 (merge/split) are core ticket management features that every competitor has. Grouping them minimizes schema changes to the `conversations` and `messages` tables.
- Plan 14 Phase 1-3 (KB enhancements) delivers multilingual KB and answer bot -- high competitive value especially when combined with Plan 01's AI resolution.
- Plan 16 (PII masking) depends on Plan 15 (RBAC) from Wave 2 for role-based data masking enforcement. It is grouped here because it shares the compliance namespace.

**Shared schema migration:**
- ALTER `conversations` (drop unique, add columns) (Plan 09)
- `mentions`, `notifications` tables (Plan 09)
- `ticket_merge_log`, `ticket_split_log` tables (Plan 10)
- ALTER `tickets` ADD `merged_into_ticket_id`, `split_from_ticket_id` (Plan 10)
- ALTER `kb_articles`, `kb_categories`, `kb_collections`, `brands`, `rag_chunks` (Plan 14)
- `kb_article_feedback`, `kb_deflections`, `kb_content_gaps` tables (Plan 14)
- `pii_detections`, `pii_sensitivity_rules`, `pii_access_log`, `pii_scan_jobs`, `hipaa_baa_agreements` tables (Plan 16)

---

### Wave 5: Platform Scale (Weeks 27-36)
**Theme:** Large platform features for growth-stage customers.

| Plan | Effort | Key Deliverables |
|------|--------|-----------------|
| 13 - Custom Reports & Analytics | XL (24-33 days) | Report builder, dashboards, scheduled exports, real-time live dashboard |
| 18 - Visual Chatbot Builder | XL (6-8 weeks) | React Flow canvas, 5 new node types, versioning, flow analytics |
| 20 - Integrations: CRM & Custom Objects | XL (19-24 days) | Jira/Linear linking, Salesforce/HubSpot CRM sync, custom object schema builder |

**Total estimated effort:** ~14-18 weeks (single developer)

**Why this wave:**
- These are the three largest individual plans (all XL). Each is largely independent.
- Plan 13 (reports) benefits from the tag management (Wave 2) and QA data (Wave 3) being in place.
- Plan 18 (chatbot) benefits from the KB enhancements (Wave 4) for the article suggestion node.
- Plan 20 (integrations) is standalone but benefits from the connector infrastructure improvements (Wave 2).
- These could be parallelized across multiple developers if capacity allows.

**Shared schema migration:**
- `reports`, `dashboards`, `dashboard_widgets`, `report_schedules`, `report_cache`, `metric_snapshots` tables (Plan 13)
- ALTER `chatbots`, plus `chatbot_versions`, `chatbot_sessions`, `chatbot_analytics` tables (Plan 18)
- `ticket_external_links`, `external_link_comments`, `crm_links`, `integration_credentials`, `custom_object_types`, `custom_object_records`, `custom_object_relationships` tables (Plan 20)

---

### Wave 6: Growth & Engagement (Weeks 37-46)
**Theme:** Proactive engagement features and enterprise workforce management.

| Plan | Effort | Key Deliverables |
|------|--------|-----------------|
| 05 - Workforce Management | L (15-21 days) | Agent schedules, forecasting, adherence, utilization |
| 19 - Campaign Orchestration | XL (10 weeks) | Multi-step campaigns, product tours, targeted in-app messages |
| 04 - Marketplace & Plugin Platform | XL (8-12 weeks) | Plugin SDK, sandboxed execution, OAuth, marketplace browse |
| 17 - AutoQA (Phase 3-4) | M (3-4 weeks) | Customer health scores, coaching workflow, calibration |

**Total estimated effort:** ~20-26 weeks (single developer)

**Why this wave:**
- Plan 05 (WFM) depends on routing (Wave 3) and business hours (Wave 1).
- Plan 19 (campaigns) is the largest competitive gap to close vs. Intercom but requires the segment evaluation engine and is lower priority than ticket-centric features.
- Plan 04 (marketplace) is the lowest priority -- it requires a plugin ecosystem to be valuable. Building first-party integrations (Wave 5) is more impactful.
- Plan 17 Phases 3-4 (health scores, coaching, calibration) are manager-workflow features that matter at scale, not for early adoption.

---

## 5. Shared Schema Consolidation

### Migration Strategy

Rather than one migration per plan, consolidate into **6 migration files** aligned with waves:

| Migration | Wave | Tables Created | Tables Altered | Key Changes |
|-----------|------|---------------|----------------|-------------|
| `0006_wave1_agent_productivity.sql` | 1 | 8 | 3 | Canned responses, macros, signatures, business hours, holidays |
| `0007_wave2_automation_infrastructure.sql` | 2 | 8 | 3 | Rule execution audit, permissions, RBAC tables, views columns, tags columns, connector tables |
| `0008_wave3_ai_routing.sql` | 3 | 10 | 4 | AI resolution tables, routing tables, AutoQA tables, user availability/skills |
| `0009_wave4_content_compliance.sql` | 4 | 10 | 6 | Notes/mentions/notifications, merge/split logs, KB i18n columns, PII tables |
| `0010_wave5_platform.sql` | 5 | 13 | 2 | Reports/dashboards, chatbot enhancements, integration/CRM/custom object tables |
| `0011_wave6_growth.sql` | 6 | 12 | 2 | WFM schedules, campaign steps/enrollments, tours, in-app messages, marketplace |

### Shared Column Changes (Deduplicated)

The `users` table is modified by 4 different plans. Consolidate:

| Column | Added By | Migration |
|--------|----------|-----------|
| `timezone` | Plans 02, 05, 12 | Wave 1 (first need) |
| `availability` | Plan 02 | Wave 3 |
| `last_seen_at` | Plan 02 | Wave 3 |
| `max_capacity` (JSONB) | Plan 05 | Wave 6 |
| `skills` (text[]) | Plan 05 | Wave 3 (also needed by Plan 02) |
| `custom_role_id` | Plan 15 | Wave 2 |

The `groups` table is modified by 3 plans:

| Column | Added By | Migration |
|--------|----------|-----------|
| `business_hours_schedule_id` | Plans 05, 12 | Wave 1 |
| `default_strategy` | Plan 02 | Wave 3 |
| `default_role` | Plan 15 | Wave 2 |

The `tickets` table is modified by 4 plans:

| Column | Added By | Migration |
|--------|----------|-----------|
| `routed_at`, `routed_via`, `queue_id` | Plan 02 | Wave 3 |
| `merged_into_ticket_id`, `split_from_ticket_id` | Plan 10 | Wave 4 |
| `predicted_csat`, `autoqa_score` | Plan 17 | Wave 3 |

### Table Name Conflicts

Plans 03 and 07 both propose a `macros` table with similar structure. **Resolution:** Use Plan 07's definition (it is more complete with `scope`, `position`, `usage_count`) and have Plan 03 reference it rather than creating its own.

Plans 05 and 12 both propose a `business_hours` table. **Resolution:** Use Plan 12's more detailed schema (`business_hours_schedules` + `business_hours_intervals` as separate tables) since Plan 12 is specifically dedicated to this feature. Plan 05 references it.

Plans 02 and 15 both propose a `group_memberships` table. **Resolution:** Identical structure -- create once in Wave 2 (Plan 15), reuse in Wave 3 (Plan 02).

---

## 6. Risk Analysis

### Top 5 Risks

| # | Risk | Severity | Affected Plans | Mitigation |
|---|------|----------|----------------|------------|
| 1 | **In-memory to DB migration breaks existing behavior** | High | 01, 02, 03, 05, 08 | Many systems (routing, rules, presence, ROI tracking) use `global.__cliaas*` singletons that reset on restart. Moving to DB adds latency. **Mitigation:** Write-through cache pattern -- DB is source of truth, in-memory cache for hot path. Feature flag each migration. |
| 2 | **Multi-instance consistency** | High | 02, 08 | EventBus and PresenceTracker are in-memory singletons. With multiple Next.js instances behind a load balancer, presence and events don't propagate. **Mitigation:** Add optional Redis pub/sub for cross-instance sync (Plan 08 Phase 4). The routing engine reads from DB directly, so it is already multi-instance safe. |
| 3 | **LLM cost and latency** | Medium | 01, 14, 17 | AI resolution, AutoQA, and answer bot all make LLM calls. At scale, costs and latencies compound. **Mitigation:** Configurable sample rates (Plan 17), confidence thresholds (Plan 01), caching (Plan 14), and rate limits per workspace. Heuristic fallbacks when LLM is unavailable. |
| 4 | **Schema migration complexity** | Medium | All | 20 plans propose ~80 new tables and ~30 column additions. Sequencing migrations incorrectly could cause downtime. **Mitigation:** Consolidate into 6 wave-aligned migrations. All changes are additive (new tables, nullable columns). Test each migration on a staging copy of production DB first. |
| 5 | **Scope creep on XL plans** | High | 04, 13, 14, 17, 18, 19, 20 | Seven plans are estimated XL (6-12 weeks each). The total roadmap exceeds a year of solo developer work. **Mitigation:** Phase within each plan -- ship the minimum viable increment first. E.g., Plan 17 ships AutoQA core (Phase 1) in Wave 3, defers coaching/calibration to Wave 6. Plan 14 ships i18n + answer bot (Phases 1-3), defers SEO polish to later. |

### Additional Risks

- **Dual tag storage** (Plan 11): Tickets have both `tags text[]` column AND `ticket_tags` join table. Must keep in sync or deprecate one.
- **DST transitions** (Plan 12): Business hours calculations across daylight saving time boundaries need exhaustive testing.
- **PII regex false positives** (Plan 16): SSN/credit card patterns need extensive tuning to avoid flagging non-PII data.
- **Conversations unique index change** (Plan 09): Dropping the 1:1 unique constraint on `conversations.ticketId` to enable side conversations is the riskiest schema change. Requires data audit before migration.
- **External API rate limits** (Plan 20): Jira, Linear, Salesforce all have different rate-limiting approaches. Need robust retry/backoff in all clients.

---

## 7. Resource Estimate

### Per-Plan Effort (Developer-Weeks)

| Plan | Effort Size | Developer-Weeks |
|------|------------|----------------|
| 01 | L | 3-4 |
| 02 | L | 3-4 |
| 03 | L | 2.5-4 |
| 04 | XL | 8-12 |
| 05 | L | 3-4 |
| 06 | L | 1.5-2 |
| 07 | M | 1.5-2.5 |
| 08 | M | 0.5-1 |
| 09 | L | 3-4 |
| 10 | L | 1-1.5 |
| 11 | L | 2.5 |
| 12 | M | 1.5-2.5 |
| 13 | XL | 5-7 |
| 14 | XL | 5-6 |
| 15 | L | 2-2.5 |
| 16 | L | 4-5 |
| 17 | XL | 6-8 |
| 18 | XL | 6-8 |
| 19 | XL | 10 |
| 20 | XL | 4-5 |

### Aggregate Totals

| Category | Count |
|----------|-------|
| **Total developer-weeks** | **~66-93** |
| **New DB tables** | ~80 |
| **New API routes** | ~200+ |
| **New MCP tools** | ~120+ (from current 60) |
| **New CLI commands** | ~100+ |
| **New UI pages** | ~40+ |
| **New UI components** | ~80+ |
| **New library modules** | ~50+ |
| **Estimated new lines of code** | ~50,000-70,000 |

### Timeline Scenarios

| Scenario | Resources | Calendar Time | Coverage |
|----------|-----------|--------------|----------|
| Solo developer | 1 FTE | ~18-24 months | All 20 plans |
| Solo developer, MVP cuts | 1 FTE | ~12 months | Waves 1-4 (16 plans, with Phase 1 only of XL plans) |
| Small team | 2 FTE | ~9-12 months | All 20 plans |
| Small team, parallelized | 3 FTE | ~6-8 months | All 20 plans (Wave 5+6 parallelized) |

### Recommended Approach

Ship **Waves 1-3** as the priority (~20-28 developer-weeks). This delivers:
- Agent productivity (canned responses, collision detection, business hours)
- Infrastructure fixes (automation audit trail, RBAC, connector write-depth)
- AI differentiation (autonomous resolution, routing, AutoQA)
- Views and tag management

After Waves 1-3, CLIaaS has competitive parity with mid-tier helpdesks and AI capabilities that exceed all competitors. Waves 4-6 add depth and enterprise features.

---

## Appendix: Plan File Locations

All plan files are at `/Users/discordwell/Projects/Zachathon/docs/plans/`:

```
plan-01-autonomous-ai-resolution.md
plan-02-omnichannel-routing.md
plan-03-workflow-automation-engine.md
plan-04-marketplace-plugin-platform.md
plan-05-workforce-management.md
plan-06-connector-write-depth.md
plan-07-canned-responses-macros.md
plan-08-agent-collision-detection.md
plan-09-internal-notes-side-conversations.md
plan-10-ticket-merge-split.md
plan-11-custom-views-filters-tags.md
plan-12-business-hours-schedules.md
plan-13-custom-reports-analytics.md
plan-14-kb-enhancements.md
plan-15-rbac-light-agents.md
plan-16-pii-masking-hipaa.md
plan-17-autoqa-predictions.md
plan-18-visual-chatbot-builder.md
plan-19-campaign-orchestration.md
plan-20-integrations-crm-custom-objects.md
```
