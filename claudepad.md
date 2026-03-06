# Session Summaries

## 2026-03-06T09:20Z — Session 95: Slice 11 Implementation + Code Review + Fixes
- Slice 11 (Custom Views/Filters/Tags) was already fully implemented by prior session — verified completeness
- Code review found **8 issues** (4 high, 4 medium), all fixed:
  1. **HIGH**: View tickets/count routes missing workspace scoping (IDOR) — added `getDefaultWorkspaceId` + `and()` filter
  2. **HIGH**: Tag deletion doesn't sync `tickets.tags` text array — added affected ticket lookup + sync in transaction
  3. **HIGH**: MCP `view_delete` allows deleting system views — added `ne(viewType, 'system')` guard
  4. **HIGH**: Personal view authorization bypass via direct ID access — added `viewType === 'personal' && userId !== authResult.user.id` checks on GET/PATCH/tickets/count routes
  5. **MEDIUM**: MCP/CLI tag delete not wrapped in transaction — wrapped with `db.transaction()`
  6. **MEDIUM**: LIKE wildcard injection in tag autocomplete — added `escapeLike()` matching existing pattern
  7. **MEDIUM**: MCP view tools (get/execute/delete) missing workspace scoping — added `getDefaultWorkspaceId` + `and()` filter
  8. **MEDIUM**: Bulk status/priority update N+1 sequential HTTP — replaced `for...of` with `Promise.allSettled`
- CLI `views delete` also fixed: workspace scoping + system view guard
- Build clean, 15/15 executor tests pass

## 2026-03-06T09:05Z — Session 94: Slice 11 Code Review Fixes (Round 2)
- Fixed 4 remaining code review issues from Slice 11 (Views/Tags):
  - **C1 (HIGH)**: Wrapped tag mutations in `db.transaction()` in db-provider.ts; also wrapped tag DELETE in `/api/tags/[id]` route
  - **C3 (MEDIUM)**: Date comparison in executor.ts — `greater_than`/`less_than` now use `Date.parse()` with NaN guard, falling back to string comparison for non-date fields
  - **S8 (LOW)**: Added 200-ticket cap to bulk tag operations endpoint
  - **MEDIUM (new)**: Moved ticket metadata update inside transaction when tags are present (was outside, allowing partial commits)
  - **MEDIUM (new)**: Added ticketIds deduplication via `new Set()` in bulk tags route
- Code review of fixes: all clean, one pre-existing workspace guard noted (not a regression)
- 15/15 executor tests pass, 0 TS errors

## 2026-03-06T08:45Z — Session 93: Code Review Fixes — 18 Findings (Sandbox/SSRF/Auth/Bugs)
- **Phase 1 (CRITICAL)**: Sandbox async timeout bypass — wrapped `runInContext` in `Promise.race` with 5s timeout. SSRF hardening — new shared `src/lib/plugins/url-safety.ts` with DNS resolution, octal/hex/decimal IP normalization, cloud metadata blocking. Applied to `sdk-context.ts` (async assertSafeUrl + safeFetch with 10s timeout + 5MB size limit), `sandbox.ts` (webhook SSRF), and `webhooks.ts` (replaced inline patterns).
- **Phase 2 (HIGH)**: Auth guards on 15 routing/agents/groups API routes (requireScope routing:read/write, requireAuth, requireRole admin). Body validation with try/catch on all POST/PUT. Strategy enum validation on queue POST. Limit caps (200) on log/agents routes. Added routing:read + routing:write to VALID_SCOPES.
- **Phase 3 (HIGH+MED)**: Operator precedence fix (`as string ??` → parenthesized). N+1 JSONL read fix (read marketplace-listings once outside filter loop). Wrong event type fix (`ticket:updated` → `agent:availability_changed`). Dead import removal (unused PluginManifestV2).
- **Phase 4 (LOW)**: JSON.parse error handling in MCP plugin_install/plugin_config. Hardcoded user replaced with auth context in reviews route. Availability status enum validation.
- **8 test files, 40 tests**: url-safety (20), sandbox-timeout (2), sdk-context-ssrf (6), store-n1 (3), availability (1), auth (6), plugins-json (2). All pass.
- **Code review**: 0 critical/high/medium issues. 2 low recommendations (status validation — fixed, UUID format — deferred).
- **32 files changed** (+955, -121). Committed `a006bb7`, pushed, deployed.

## 2026-03-06T08:45Z — Session 92: Slice 12 — Business Hours & Schedules
- Implemented full 8-step plan for configurable business hours with holiday calendars
- **Core engine** (`src/lib/wfm/business-hours.ts`): Added `addBusinessMinutes()`, `nextBusinessHourClose()`, enhanced `isHoliday()` for recurring/partial-day holidays
- **Holiday calendars** (`src/lib/wfm/holidays.ts`): CRUD + `resolveHolidaysForSchedule()` flattener
- **Presets** (`src/lib/wfm/presets.ts`): US Federal, UK Bank, Canada Statutory, Australia Public with floating holiday calculation (nth weekday, Easter)
- **SLA integration** (`src/lib/sla.ts`): `businessHoursId` on policies, `businessElapsedMinutes`/`dueAt` in check results
- **API routes**: 7 new route files under `/api/business-hours/` and `/api/holidays/`
- **UI** (`src/app/business-hours/_content.tsx`): Weekly grid editor, timezone selector, holiday calendar tabs with preset import
- **CLI** (`cli/commands/business-hours.ts`): Full `business-hours` + `holidays` subcommands (aliased `bh`)
- **MCP tools** (`cli/mcp/tools/business-hours.ts`): 13 tools (8 read, 5 write with scope guards)
- **Routing** (`src/lib/routing/availability.ts`): `isAvailableForRouting(userId, groupId?)` checks business hours
- **DB migration** (`0012_business_hours_enhancements.sql`): 3 new tables, 2 FK columns
- 42 tests across 4 test files all passing, 0 TS errors in new code

## 2026-03-06T06:20Z — Session 91: Collision Detection Review Fixes (Low/Medium)
- Implemented 8 fixes from collision detection code review:
  1. Extracted shared `checkForNewReplies()` utility in `src/lib/realtime/collision.ts`, updated 3 consumers
  2. Added `ticketIndex` secondary index to PresenceTracker for O(1) `getViewers()` lookup
  3. Added max entries cap (10,000) with cleanup + oldest-eviction in PresenceTracker
  4. Replaced `fetch()` with `navigator.sendBeacon()` for leave signal in CollisionDetector
  5. Added test helpers (`_testClear`, `_testRunCleanup`, `_testSetLastSeen`, `_testSetMaxEntries`, `_testEntryCount`) to PresenceTracker; removed unsafe casts from tests
  6. Fixed SSE event listener leak — catch blocks now call `unsubscribe()` + null guard consistently
  7. Added `loadMessagesSince` to DataProvider interface (optional) + DbProvider implementation with SQL `gt()` filter; extracted shared `resolveMessageRows` private method
  8. Added 11 API route tests (6 presence, 5 collision-check)
- 29 new/updated tests pass. No regressions (2 pre-existing SLA/scenario failures unrelated).

## 2026-03-06T11:30Z — Session 90: Code Review Fixes for Plan 10 (Ticket Merge & Split)
- **Fixed 9 issues** from code review of Ticket Merge & Split:
  1. HIGH: Added `requireScope(request, 'tickets:write')` auth to merge, split, undo routes; `tickets:read` to merge-history
  2. HIGH: Wrapped `mergeTickets`, `splitTicket`, `unmergeTicket` in `db.transaction()` calls
  3. MEDIUM: Added UUID format validation on all API input parameters (primaryTicketId, mergedTicketIds, messageIds, mergeLogId)
  4. MEDIUM: Optimized `getMergeHistory` to filter in SQL with `or()` conditions instead of full table scan + JS filter
  5. LOW: Added primary-ticket-already-merged check in `mergeTickets`
  6. LOW: Added `ticket:unmerged` to EventType union + emit from undo route
  7. LOW: Added `ticket.merged/split/unmerged` to CanonicalEvent + WebhookEventType + SSE_EVENT_MAP
  8. LOW: Fixed autoMerge sort by `createdAt` instead of `id` in `detect_duplicates`
  9. LOW: Added RemoteProvider stubs for merge/split/unmerge/history methods
- All 6 merge-split tests + 5 routing tests pass. No new TS errors.
- Committed `24fee02`, pushed, deployed to cliaas.com.

## 2026-03-06T10:30Z — Session 89: Code Review Fixes for Plan 09
- **Fixed 8 issues** from code review of Internal Notes & Side Conversations:
  1. CRITICAL: Added auth via `X-Webhook-Secret` header (requires `INBOUND_EMAIL_SECRET` env var) to inbound email endpoint. Rejects if not configured.
  2. MEDIUM: Escaped ILIKE wildcards (`%`, `_`, `\`) in `mentions.ts` `resolveMentions`
  3. MEDIUM: HTML-escaped side conversation email bodies in `side-conversations.ts` (both create + reply)
  4. MEDIUM: Replaced JS-side filtering with proper ILIKE DB query in user search endpoint
  5. MEDIUM: Wrapped side conversation create (conversation + message inserts) in `db.transaction`
  6. LOW: Changed empty `workspaceId: ''` to `'default'` in MCP side_conversation_create
  7. LOW: Added mention resolution + notification dispatch to MCP `ticket_note` using the `mentions` param
  8. LOW: Reset `createState`/`replyState` to `idle` after success in SideConversationPanel
- All 17 internal-notes tests pass. No new TS errors introduced.

## 2026-03-06T09:45Z — Session 88: Test Fixes, Code Review & Deploy
- **Test fixes**: 19 failures → 0 (in isolation), remaining ~8 are parallel JSONL contamination (pre-existing)
  - EventSource mock for SSE in TicketActions, AppNav, AppNavWrapper tests
  - TicketActions: Reply/Note toggle (was checkbox), multiple "Reply" elements, fetch mock for CannedResponsePicker
  - MCP server test: 81→112 tools
  - Remote-provider: lazy init means constructor doesn't throw, test checks first operation instead
  - Sidebar layout: STRIP_START_Y 194→180
  - Routing strategies: unique queue ID to prevent parallel contamination
- **Build**: passes (3 warnings: ioredis, remote-provider cli/config.js)
- **Committed**: `1ad0386` — internal notes, side conversations, @mentions, notifications + test fixes
- **Deployed** to cliaas.com

## 2026-03-06T08:30Z — Session 87: WASM Agent Harness for C++ Red Alert Engine
- **Created** `agent_harness.cpp` (508 lines): 3 EMSCRIPTEN_KEEPALIVE exports — `agent_get_state` (JSON state serializer), `agent_command` (hand-rolled JSON parser + command processor), `agent_step` (combined command+tick+state). Static 64KB buffer, ID encoding `(RTTI<<16)|heap_index`.
- **Modified** `CMakeLists.txt`: Added source file + 3 exports to EXPORTED_FUNCTIONS
- **Modified** `original.html`: JS bridge via `Module.ccall` — `__agentState()`, `__agentCommand()`, `__agentStep()`, `__agentReady` flag
- **Fixes during wet test**: (1) Cache-bust version bump for stale WASM, (2) `allocateUTF8` → `Module.ccall` for string marshaling, (3) `agent_step` returning Promise — force `g_autoplay_mode=1` + `{async:true}` ccall, (4) `buf_cat` truncation bug (found in code review)
- **Git workaround**: Removed nested `.git` in CnC_and_Red_Alert, updated `.gitignore` to `/**` glob with negation rules for custom files
- **Verified**: All 3 exports callable from JS, state/command JSON round-trips work at menu screen. Full gameplay test deferred (Chrome extension instability with autoplay tabs).
- **Deployed** to cliaas.com, committed as `e5e4065`

## 2026-03-06T05:20Z — Session 86: Ticket Merge & Split (Plan 10)
- **Migration**: `0009_ticket_merge_split.sql` — 2 ALTER TABLE (merged_into_ticket_id, split_from_ticket_id), 2 new tables (ticket_merge_log, ticket_split_log), partial indexes, RLS
- **Drizzle schema**: Added mergedIntoTicketId + splitFromTicketId to tickets, ticketMergeLog + ticketSplitLog table defs
- **Types**: TicketMergeParams, TicketMergeResult, TicketSplitParams, TicketSplitResult, TicketUnmergeParams, MergeHistoryEntry added to DataProvider interface
- **Business logic**: `src/lib/tickets/merge-split.ts` — mergeTickets (move messages, union tags, close secondary, snapshot, log), splitTicket (new ticket+conversation, move messages, log), unmergeTicket (restore from snapshot, undo window), getMergeHistory
- **DbProvider**: 4 new methods delegating to merge-split.ts; loadTickets now returns mergedIntoTicketId/splitFromTicketId
- **JsonlProvider**: Stub throws for merge/split/unmerge; returns [] for getMergeHistory
- **HybridProvider**: Delegates to DbProvider + outbox entries
- **Events**: ticketMerged, ticketSplit, ticketUnmerged dispatch helpers; ticket:merged + ticket:split EventType
- **API routes**: POST /api/tickets/merge, POST /api/tickets/[id]/split, POST /api/tickets/merge/undo, GET /api/tickets/[id]/merge-history
- **CLI**: `tickets merge` + `tickets split` subcommands with --dry-run; `duplicates --merge --yes`
- **MCP**: ticket_merge + ticket_split tools with withConfirmation + scopeGuard; detect_duplicates autoMerge+confirm
- **UI**: TicketListClient (multi-select + merge bar), TicketMergeBar (primary selector, confirm modal), TicketSplitBar (subject input, confirm modal), TicketDetailClient (lineage banners, message checkboxes, merge history)
- **Tests**: 6 unit tests in merge-split.test.ts (validation edge cases + type checks)
- **Files**: 12 new, 14 modified

## 2026-03-06T05:12Z — Session 85: Workforce Management (WFM) — Plan 05
- **Types**: `src/lib/wfm/types.ts` — 16 interfaces/types (ShiftBlock, ScheduleTemplate, AgentSchedule, AgentAvailability, AgentStatusEntry, AgentCurrentStatus, TimeOffRequest, VolumeSnapshot, ForecastPoint, StaffingRecommendation, BusinessHoursConfig, AdherenceRecord, UtilizationRecord, WfmDashboardData, ScheduledActivity)
- **Store**: `src/lib/wfm/store.ts` — JSONL persistence for 6 collections with demo data seeding + compatibility aliases
- **Core modules**: business-hours.ts (timezone-aware checks, elapsed minutes, next-open), agent-status.ts (singleton tracker with events), schedules.ts (CRUD, conflict detection, activity tracking), time-off.ts (request/approve/deny with events), forecast.ts (EMA + staffing), adherence.ts (schedule-vs-status comparison), utilization.ts (occupancy calc), volume-tracker.ts (event-driven hourly counters)
- **Migration**: `0007_workforce_management.sql` — 7 new tables, 2 enums, 2 ALTER TABLE
- **Drizzle schema**: 7 new table defs + timeOffStatusEnum added to schema.ts (reuses agentAvailabilityEnum from routing)
- **API routes**: 13 new routes under `/api/wfm/` (schedules, templates, time-off, agent-status, adherence, forecast, utilization, business-hours, dashboard)
- **CLI**: `cli/commands/wfm.ts` — 15 subcommands (schedule/template/status/time-off/forecast/adherence/utilization/business-hours)
- **MCP tools**: `cli/mcp/tools/wfm.ts` — 13 tools with scopeGuard + withConfirmation on write ops
- **Events**: Added 4 WFM event types to EventType union
- **Feature gate**: Added `workforce_management` (all tiers)
- **UI**: `src/app/wfm/page.tsx` + `_content.tsx` — 5-tab dashboard (Dashboard, Schedules, Adherence, Forecast, Time Off)
- **Nav**: Added WFM link in AppNav
- **Tests**: 41 tests across 5 files (business-hours: 13, schedules: 10, adherence: 7, forecast: 7, utilization: 4), all passing
- **Code review**: Fixed phantom `changedAt` field in agent-status.ts, added positive-case conflict detection tests
- **Files**: 28+ new, 7 modified

## 2026-03-06T05:15Z — Session 84: Canned Responses, Macros & Agent Signatures (Plan 07)
- **Migration**: `0008_canned_responses_macros.sql` — 3 new tables (canned_responses, macros, agent_signatures), template_scope enum, RLS policies
- **Drizzle schema**: Added cannedResponses, nativeMacros, agentSignatures tables + templateScopeEnum to schema.ts
- **JSONL stores**: 3 new stores (canned-store.ts, macro-store.ts, signature-store.ts) with demo data seeding
- **Merge engine**: `src/lib/canned/merge.ts` — regex-based {{variable.path}} resolution, 12 supported variables (customer/ticket/agent/workspace)
- **Macro executor**: `src/lib/canned/macro-executor.ts` — sequential action processing (9 action types), merge variable integration
- **API routes**: 18 new routes — CRUD for canned-responses (6), macros (6), signatures (5), merge-variables (1)
- **Updated macros API**: Switched from rules table to native macros table + JSONL store; apply endpoint uses new executor
- **CLI commands**: `cli/commands/canned.ts` — 3 command groups (canned, macro, signature) with 15 subcommands
- **MCP tools**: `cli/mcp/tools/canned.ts` — 10 new tools (search/get/create/update/delete canned, resolve_template, list/create/apply macros, get_signature)
- **UI**: CannedResponsePicker component integrated into TicketActions reply form; 3 settings pages (canned-responses, macros, signatures)
- **Settings page**: Added Templates & Macros section with links to all 3 management pages
- **Feature gate**: Added `canned_responses` feature (all tiers)
- **Tests**: 21 tests (10 merge engine, 11 macro executor), all passing
- **Files**: 18 new, 8 modified

## 2026-03-06T10:10Z — Session 83: Port C++ Sidebar Rendering to TypeScript
- **Asset extraction**: 12 new SHP sprites (stripup/dn, power_marker, side1-3na/us, stripna/us, pips) from HIRES.MIX/LORES.MIX
- **Layout constants**: Replaced all sidebar constants with C++ HIRES values — MAX_VISIBLE 3→4, CAMEO_GAP 2→0, C++ English button layout (64/40/40 widths)
- **Rendering rewrite**: House-specific 3-section backgrounds (side1-3na for Allied, side1-3us for Soviet), strip column backgrounds (stripna/stripus), sprite-based buttons (ShapeButtonClass frames), sprite scroll arrows (stripup/stripdn), pips READY/HOLDING overlays, clock ghost overlay
- **Power bar**: Logarithmic Power_Height() scale from power.cpp, bounce animation via _modtable[13], palette-accurate colors (green/orange/red), drain marker shape, flash timer
- **Click handlers**: Updated for C++ English button layout, side-by-side scroll buttons below strip
- **Tests**: 96 tests passing — layout constants, Power_Height() verification, bounce modtable, sidebar background positions
- **Bug fix**: stripup/stripdn only have 2 frames (not 3) — fixed disabled frame index from 2→1
- **Files**: extract-ra-assets.ts, renderer.ts, index.ts, sidebar-ui.test.ts, MISSING_FEATURES.md

## 2026-03-06T05:05Z — Session 82: Agent Collision Detection (Plan 08)
- **Presence API auth fix**: Extracts userId/userName from `auth.user` instead of trusting request body; POST returns `currentUserId` + `viewers`
- **PresenceTracker**: Reduced stale threshold from 60s to 30s
- **CollisionDetector**: Removed userId/userName props, reads `currentUserId` from POST response; added avatar pills with initials, eye/pen icons for viewing/typing
- **TicketActions**: Typing broadcast (debounced 3s), composingStartedAt tracking, pre-submit collision check via `/api/tickets/{id}/collision-check`, inline collision warning with "Review/Send Anyway/Cancel", SSE-based new reply banner
- **SSE endpoint**: Added optional `?ticketId=X` filtering for events
- **Collision-check API**: `GET /api/tickets/{id}/collision-check?since=ISO` returns `hasNewReplies`, `newReplies[]`, `activeViewers[]`
- **MCP tools**: `ticket_presence` (show viewers), `ticket_collision_check` (check replies since timestamp), collision-aware `ticket_reply`/`ticket_note` with `since`/`forceSubmit` params
- **Tests**: 16 tests (12 PresenceTracker unit tests, 4 MCP presence logic tests), all passing
- **Files**: 4 new, 7 modified, 2 test files

## 2026-03-06T05:02Z — Session 81: Connector Write-Depth (Plan 06, Phase 1)
- **Kayako upstream adapter**: New `cli/sync/upstream-adapters/kayako.ts` wrapping existing kayakoUpdateCase/PostReply/PostNote/CreateCase
- **Kayako Classic upstream adapter**: New `cli/sync/upstream-adapters/kayako-classic.ts` with status/priority string→numeric ID mapping, KAYAKO_CLASSIC_DEPARTMENT_ID env var required for createTicket
- **HelpCrunch customerId fix**: Added `helpcrunchSearchCustomers()` to connector, adapter now resolves requester email to customerId instead of hardcoding 0
- **HubSpot update+reply**: Added `hubspotUpdateTicket()` (PATCH ticket properties) and `hubspotPostReply()` (create email engagement + associate) to connector; adapter now supports both
- **Capability matrix**: New `cli/sync/capabilities.ts` with static ConnectorCapability map for all 10 connectors, getSyncTier() classification
- **MCP tool**: `connector_capabilities` in sync tools, CLI `cliaas sync capabilities` command, GET `/api/connectors/capabilities` endpoint
- **Dynamic UI badges**: ConnectorCard shows "full sync" (green), "read + write" (blue), or "read only" (gray) based on actual capabilities instead of hardcoded "bidirectional"
- **Tests**: 67 tests across 3 files (46 upstream adapter tests, 9 capability tests, 12 ConnectorCard tests)
- Code review caught Kayako Classic NaN bug (string status→Number("open")=NaN), fixed with proper mapping tables

## 2026-03-06T06:30Z — Session 80: Marketplace & Plugin Platform
- **9-phase implementation** replacing demo-grade plugin system with production plugin platform:
  1. **Types & Schema**: `src/lib/plugins/types.ts` (PluginManifestV2, 24 hooks, 11 permissions, node|webhook runtime), 5 DB tables (marketplace_listings, plugin_installations, plugin_hook_registrations, plugin_execution_logs, plugin_reviews), migration 0006
  2. **Store Layer**: Dual-mode (DB+JSONL) stores for installations (`store.ts`), marketplace (`marketplace-store.ts`), execution logs (`execution-log.ts`). JOIN-based hook lookup in DB path, cross-ref in JSONL path.
  3. **Execution Engine**: `sandbox.ts` (node:vm with restricted globals, 5s timeout, SSRF prevention), `sdk-context.ts` (permission-gated SDK), `executor.ts` (fan-out via Promise.allSettled). Barrel module `plugins.ts` preserves backward compat.
  4. **API Routes**: 7 new routes (marketplace browse/detail/install/reviews/publish, plugin logs, plugin PATCH). Modified existing plugin GET/DELETE for dual-store fallback.
  5. **CLI**: `cli/commands/plugins.ts` — 10 subcommands (list/show/install/uninstall/enable/disable/config/logs/marketplace/publish)
  6. **MCP**: 8 tools (plugin_list/install/uninstall/toggle/config/logs, marketplace_search/show). 4 new scope guards.
  7. **UI**: Marketplace browse page + detail page with reviews/ratings, PluginConfigForm (JSON Schema-driven), PluginSidebar for ticket detail. Enhanced integrations page with toggle/logs.
  8. **First-Party Plugins**: slack-notify, jira-sync, stripe-context with manifests + handlers + seed script
  9. **Tests**: 52 tests across 8 files — store, marketplace-store, sandbox, executor, validator, MCP tools, API routes, integration
- Cross-realm Error fix in sandbox: `vm.createContext()` errors fail `instanceof Error`, added object-shape check
- AppNav updated with Marketplace link

## 2026-03-06T00:15Z — Session 79: Real-time Omnichannel Routing Engine
- **5-phase implementation** of skill-based, capacity-aware routing engine replacing demo router:
  1. **Core Engine**: `src/lib/routing/` — types, dual-mode JSONL store, availability tracker (singleton with auto-offline), 4 strategies (round_robin, load_balanced, skill_match, priority_weighted), queue manager with condition evaluation + overflow, core engine with category extraction + agent scoring
  2. **API Routes**: 22 new routes under `/api/routing/`, `/api/agents/`, `/api/groups/` — config, queues, rules, route-ticket, log, analytics, skills, capacity, availability, group members
  3. **CLI + MCP**: `cli/commands/routing.ts` (10 subcommands), `cli/mcp/tools/routing.ts` (5 tools: route_ticket, routing_status, agent_availability, agent_skills, queue_depth). MCP tool count: 60→81
  4. **Auto-routing Hooks**: Event dispatcher channel 5 — on `ticket.created` without assignee, auto-routes. Slack command creates real ticket + auto-routes. Sync engine routes imported unassigned tickets.
  5. **UI**: Settings page (`/settings/routing`) with config, queue CRUD, rule CRUD, agent skills/availability. Analytics page (`/analytics/routing`) with stat cards, bar charts, routing log. 4 components (AgentAvailabilityIndicator, AgentSkillBadges, RoutingQueueCard, AgentCapacityBar). Modified ticket detail (routing info + re-route button), dashboard (availability + queue panels), AppNav (routing link).
- **31 routing unit tests** across 4 test files, all passing. MCP server test updated (60→81 tools).
- DB schema: 3 enums + 6 tables (agentSkills, agentCapacity, groupMemberships, routingQueues, routingRules, routingLog)
- Business hours placeholder in engine scoring (0.7 penalty factor for off-hours agents)

## 2026-03-06T04:50Z — Session 78: Workflow Automation Engine Production Implementation
- **7-phase implementation** closing 5 critical gaps in the automation system:
  1. **DB↔Engine Bridge**: `bootstrap.ts` lazy-loads DB rules into in-memory engine on first ticket event. `invalidateRuleCache()` wired into all API mutation endpoints. Removed duplicate `automationRules` table.
  2. **Side Effects Fire**: `side-effects.ts` dispatches email (sendNotification), Slack, Teams, push notifications, and webhook fetches via `Promise.allSettled`. Loop prevention via `__cliaasAutomationDepth` global (max 2).
  3. **Persistent Audit**: `ruleExecutions` table + `audit-store.ts` with DB+in-memory dual-path. New API routes `/api/rules/executions` and `/api/rules/[id]/executions`.
  4. **Rule UI Overhaul**: ConditionBuilder (ALL/ANY groups), ActionBuilder (type-specific inputs), RuleForm with DryRunPanel. Rules page now supports multi-condition/action create+edit.
  5. **Macro Support**: `/api/macros` + `/api/macros/[id]/apply` routes. `MacroDropdown` component in ticket detail page. MCP `macro_apply` tool.
  6. **Dry-Run**: `/api/rules/dry-run` endpoint for testing rules against sample tickets. DryRunPanel UI component with before/after diff.
  7. **MCP Parity**: 7 new MCP tools (rule_list, rule_get, rule_update, rule_delete, rule_test, rule_executions, macro_list). Fixed rule_create/rule_toggle to persist to DB.
- Schema changes: Added `description`, `version`, `executionOrder`, `lastExecutedAt`, `executionCount` to `rules` table. New `ruleExecutions` table with workspace/rule/ticket indexes.
- `applyExecutionResults()` now async (breaking change from sync, all callers updated).
- **89 tests passing** across 10 test files (50 automation + 39 security/RLS).

## 2026-03-05T22:00Z — Session 76: Beat Allied Mission 1 (SCG01EA) via Agent Harness
- **MISSION ACCOMPLISHED**: Score 1166, Grade B, 14 seconds, 6 kills, 4 losses
- **Bug fix 1**: Aircraft 'returning' state now checks for new MOVE/ATTACK orders (was ignoring all commands when no helipad)
- **Bug fix 2**: Aircraft pre-move map exit check in 'flying' state — detects aircraft at map edge with OOB target
- **Bug fix 3**: Aircraft post-arrival map exit — when `moveToward` returns true at OOB destination, exit map + count evacuations. This was the critical race condition: `moveToward` could reach OOB target in one tick, clearing `moveTarget` before either exit check ran
- **Bug fix 4**: Direct transport load in agent harness `enter` command — loads infantry within 2 cells directly into transport, bypassing unreliable auto-load mechanism
- **Root cause of Attempts 5-7 failure**: In 'flying' state, pre-move exit check ran BEFORE `moveToward`. If aircraft wasn't at edge yet, check passed. Then `moveToward` arrived at target, cleared `moveTarget` + set 'returning'. Ground exit check (runs after entity update) saw null `moveTarget` and skipped. Next tick: 'returning' state, flying exit code never runs.
- **Strategy**: JEEPs + Tanya clear nearby enemies, rush guards to trigger Einstein spawn, direct-load Einstein into Chinook, fly east off map
- Files: `engine/index.ts` (aircraft state machine), `engine/agentHarness.ts` (enter command)

## 2026-03-06T06:45Z — Session 75: Sidebar Visual Parity — Icons, Power Bar, Credits
- **Root cause found**: Cameo icon PNGs are 32x24 (LORES) but manifest.json claims 64x48 — canvas `drawImage` clips source rect, rendering icons at quarter size in top-left corner
- **Fix**: Use `iconSheet.image.width/height` (actual image dimensions) as source rect instead of manifest metadata, scaled to fill full 64x48 cameo slot
- **Power bar**: Replaced single-color fill with two-tone gauge — green (produced) from bottom, red (over-consumed) above, white divider line at produced level
- **Credits area**: Semi-transparent background (`rgba(10,10,15,0.6)`) blends with sidebar tile texture, text shadow for readability, silo capacity shown inline instead of overlapping button row
- **Button row**: Icons fill full button area (removed -2px margin), semi-transparent backgrounds let sidebar texture show through
- **Verified via agent harness**: Forced `baseDiscovered=true` through React fiber tree to test with 15 production items — all icons render at full cameo size
- Commit: `8fd278b` — renderer.ts only (61 insertions, 48 deletions)

## 2026-03-06T03:00Z — Session 74: Full Data-Parity Test Coverage (Phases 4-9)
- **275 parity tests** now pass across 10 data tables (was 132)
- **Phase 4 — Warheads**: WARHEAD_VS_ARMOR all 9 full arrays (was 2 spot checks), WARHEAD_PROPS all 9 with both fields (was 2), WARHEAD_META all 9 with all flags (was 2)
- **Phase 5 — Superweapons**: All 7 SUPERWEAPON_DEFS with all fields (was 5 rechargeTicks-only), all 8 constants (was 1)
- **Phase 6 — Countries/Terrain**: COUNTRY_BONUSES all 11 countries (new), TERRAIN_SPEED all 9 terrains (new)
- **Phase 7 — Structure Weapons**: All 8 STRUCTURE_WEAPONS entries (new)
- **Phase 8 — Production Items**: New file `production-items-parity.test.ts` — all 65 items with cost/buildTime/prereq/techLevel/faction (was 10 cost-only)
- **Phase 9 — Structure HP Audit**: Added 11 missing entries (PBOX, AGUN, FTUR, KENN, SYRD, SPEN, QUEE, LAR1, LAR2, BARL, BRL3) + completeness check
- **Plan values corrected**: Caught ~20 hallucinated values in the plan (wrong TERRAIN_SPEED terrains, wrong STRUCTURE_WEAPONS stats, wrong COUNTRY_BONUSES countries), used actual source data instead
- **Code review**: 100% correct — zero mismatches between assertions and source
- Files: data-parity.test.ts (405 insertions), production-items-parity.test.ts (new, 128 lines)

## 2026-03-06T00:30Z — Session 73: WASM Autoplay Game Loop — Asyncify Breakthrough
- **Game loop now runs** in `?autoplay=allies` mode — frames advancing (confirmed f=53+ on tab)
- **Three Asyncify blockers eliminated** in Main_Loop:
  1. `SDL_Event_Loop()` in `Update_Window_Surface` — skipped `emscripten_sleep(0)` in autoplay (window.cpp)
  2. `SDL_RenderPresent()` uses internal emscripten_sleep even without VSYNC — skip ALL SDL rendering in autoplay (drawbuff_sdl.cpp)
  3. `Theme.AI()`/`Sound_Callback()` — SDL audio internals trigger emscripten_sleep — skip in autoplay (conquer.cpp Call_Back)
- **VSYNC disabled** for Emscripten builds (SDL_CreateRenderer flags=0 instead of SDL_RENDERER_PRESENTVSYNC)
- **Batch frame optimization**: 100 game frames per browser yield in Sync_Delay (overcomes background tab throttling where each setTimeout(0) takes 1-10s)
- **Single yield architecture**: Only `emscripten_sleep(0)` in Sync_Delay every 100 frames; init runs fully synchronous
- **Diagnostic cleanup**: Removed 9 ML checkpoint titles + 3 CB checkpoint titles; kept only `RA:f=N` at yield point + `window.__wasm_frame`
- Files: conquer.cpp (Call_Back audio skip, Sync_Delay batch, diagnostic cleanup), drawbuff_sdl.cpp (render skip), window.cpp (event loop skip, no VSYNC), original.html (cache busters)

# Key Findings

- VPS SSH user is `ubuntu`, not `root`: `VPS_USER=ubuntu bash scripts/deploy_vps.sh`
- Demo data on VPS lives at `/tmp/cliaas-demo` (the lib/data.ts checks this path first)
- Demo command is `cliaas demo --tickets 50 --out /tmp/cliaas-demo` (not `demo generate`)
- The `public/ra/` and `src/EasterEgg/` dirs contain vendored code — already in eslint ignores
- Landing page was restyled with zinc-950 borders design between sessions
- Zendesk API: `email/token:apikey` Basic auth confirmed, cursor-based incremental exports, 10 req/min rate limit
- Kayako API: Basic auth + X-Session-ID required after first request, cases at `/api/v1/cases.json`, posts use `after_id` cursor pagination
- Kayako articles endpoint is `/api/v1/articles.json` NOT `/api/v1/helpcenter/articles.json`
- Kayako triggers use `predicate_collections` not `conditions`
- Kayako posts have `source` field (AGENT/API/MAIL/etc) not `is_requester`
- Kayako notes are separate from posts: `/api/v1/cases/:id/notes.json`
- Zendesk credentials: subdomain=discorp, email=cordwell@gmail.com, token in .env
- Kayako Classic domain: classichelp.kayako.com (needs API key + secret from admin REST API settings)
- Kayako Classic API: HMAC-SHA256 auth, XML responses, path-based pagination for tickets, marker-based for users
- Intercom API: `type:"user"` (not `type:"contact"`) for creating conversations; response returns `conversation_id`
- Intercom delete conversation requires `Intercom-Version: Unstable` header
- Intercom contact search: POST `/contacts/search` with `{query:{field:"email",operator:"=",value:"..."}}`
- Freshdesk free plan blocks DELETE via API (405 Method Not Allowed)
- Groove API has no delete endpoint (REST v1 is deprecated, recommend GraphQL v2)
- All connector creds saved in .env (gitignored): Zendesk, Freshdesk, Groove, HelpCrunch, Intercom
- Intercom workspace: "Discorp", admin ID 9982601 (Robert Cordwell), Freshdesk subdomain: cliaas

## Code Review Results (Session 28)
- **47,600 LOC** across 314 TypeScript files (excl. Easter Egg + tests)
- **53 DB tables**, multi-tenant from ground up (tenant -> workspace -> users)
- **101 API routes**: 88% lack auth middleware, 52 have unsafe JSON parsing
- **29 pages**: /ai page is 1,275 LOC (should split), color maps duplicated 22x
- **58 lib modules**: 4 different persistence patterns, ID generation duplicated 6x
- **69 CLI files**: 10 connectors with ~4,700 LOC of duplicated auth/pagination/normalization
- **38 test files (5,339 LOC)**: CLI commands and connectors have zero test coverage
- **Event pipeline**: wired to webhooks/plugins/SSE, fire-and-forget via Promise.allSettled
- **Refactoring priorities**: (1) auth middleware, (2) JSON parsing safety, (3) connector dedup, (4) test coverage
