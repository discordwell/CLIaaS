# Session Summaries

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

## 2026-03-06T12:00Z — Session 77: Implementation Roadmap Synthesis
- Read all 20 competitive gap plan files (plan-01 through plan-20) in docs/plans/
- Produced comprehensive prioritized roadmap at docs/plans/ROADMAP.md with 7 sections:
  1. Summary table of all 20 plans with effort/dependencies/summaries
  2. Dependency graph with overlap clusters
  3. Scoring-based prioritization (Impact, Competitive Urgency, Effort Efficiency, Dependency Value)
  4. 6 implementation waves (Core Agent Productivity -> Automation -> AI -> Content -> Platform -> Growth)
  5. Shared schema consolidation: 6 wave-aligned migrations (0006-0011), deduplicated column changes
  6. Risk analysis: top 5 risks (in-memory->DB migration, multi-instance, LLM cost, schema complexity, scope creep)
  7. Resource estimate: ~66-93 developer-weeks, ~80 new tables, 200+ API routes, 120+ MCP tools
- Resolved table name conflicts: macros (Plan 03 vs 07), business_hours (Plan 05 vs 12), group_memberships (Plan 02 vs 15)
- Recommended approach: Waves 1-3 first (~20-28 dev-weeks) for competitive parity + AI differentiation

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

## 2026-03-05T15:20Z — Session 72: Parity Audit Phase 2 — Superweapon Timing + Test Cleanup
- **6 code bugs fixed in types.ts**: 5 superweapon recharge times (Chrono 2700→6300, GPS 6300→7200, IronCurtain 6300→9900, Nuke 12600→11700, Sonar 12600→9000) + Iron Curtain duration (450→675 ticks)
- **~65 hallucinated test assertions fixed** in data-parity.test.ts: naval (15), aircraft (18), infantry (3), weapons (17), structure HP (7), warhead (3), superweapons (6 updated + GPS added)
- **MISSING_FEATURES.md**: 6 entries marked [VERIFIED] for all superweapon timing
- All 111 data-parity tests pass, no regressions in EasterEgg tests
- Files: types.ts, data-parity.test.ts, MISSING_FEATURES.md

## 2026-03-05T12:00Z — Session 71: Publishable npm Package
- **Split package structure**: Created `packages/cliaas/` with own package.json, tsup build config, pnpm workspace
- **tsup bundling**: CLI (index.js) + MCP server (mcp-server.js) built from source, `@/` path alias resolved, all npm deps external
- **New commands**: `cliaas init` (writes .mcp.json + ~/.claude/CLAUDE.md + demo data), `cliaas setup` (env check with --json), `cliaas mcp serve` (stdio MCP server)
- **MCP config updated**: `buildMcpConfig()` now generates `cliaas mcp serve` instead of `npx tsx cli/mcp/server.ts`
- **Demo refactored**: Extracted `generateDemoData()` from demo command for reuse by init
- **Hero demo fixed**: scenario.ts updated (npm install + cliaas init, cliaas setup, correct sync syntax, 60 tools)
- **Tool catalog updated**: AGENTS.md, WIZARD/agents.md, WIZARD/claude.md all updated from 18/27 to 60 tools with complete catalog
- **Code review fixes**: Node 18 compat in postbuild.js, pg client cleanup, `homedir()` instead of `process.env.HOME`, duplicate Write Actions section removed, pg regex broadened
- **E2E verified**: `npm install -g cliaas` → `cliaas init` → `cliaas mcp test` (60 tools) all working
- **12 new tests** (init-setup.test.ts), MCP server test passes (60 tools), 221KB packed tarball
- Files: ~10 new, ~10 modified

## 2026-03-05T11:50Z — Session 70: Code Review Fixes (High + Low Priority)
- **High-pri fixes** (commit b532c12): Teams SSRF protection (allowlisted Bot Framework domains), forum cascade delete, `time_log` scope guard, SDK tsconfig DOM lib, QA recentReviews sort, campaign CLI rewrite (store-direct vs broken HTTP)
- **Low-pri fixes** (commit 0b4f301): Slack signature fail-closed (503 when no secret vs silent skip), SDK 24h session TTL + cleanup + 30/min rate limit on init, Customer PATCH enrichment persisted to JSONL overlay store, portal forum rate limiting (120/min per IP)
- **10 files changed** in low-pri pass, 45 tests pass, build clean
- Deployed both rounds to cliaas.com

## 2026-03-05T10:00Z — Session 69: Feature Parity Sprint — 9 Features in One Pass
- **Complete feature parity sprint**: Built 9 features + Customer 360 enrichment to match competitor platforms (Zendesk, Freshdesk, Intercom, HubSpot, Help Scout, Kayako, Zoho Desk, Jira SM)
- **Features built**: (1) Customer 360 Enrichment (+10 cols, 4 new tables, timeline/notes/segments/merge), (2) Time Tracking Enhancement (billable hours, customer/group grouping), (3) Community Forums (categories/threads/replies, portal view, thread-to-ticket conversion), (4) QA/Conversation Review (scorecards, manual/auto reviews, dashboard metrics), (5) Proactive/Outbound Messaging (campaigns, recipients, template vars, analytics), (6) Telegram channel (Bot API, webhook, config), (7) Slack as Intake (Events API, slash commands, OAuth, bi-directional sync), (8) MS Teams as Intake (Bot Framework, adaptive cards, manifest), (9) Mobile SDK (@cliaas/sdk package, session management, SSE realtime)
- **Shared infrastructure**: 1 SQL migration (14 new tables, 2 ALTER), 10 new canonical events, 3 new feature gates (all tiers), 4 new channel_type enum values
- **New stats**: 60 MCP tools (+14), 148 API routes (+47), 38 pages (+8), 73 DB tables (+14), 37 CLI command groups (+5)
- **SDK package**: `sdk/` directory with types, API client, SSE realtime, and unified entry point
- **Tests**: 45 new sprint feature tests (all passing), MCP server test updated (60 tools), build clean
- **Parallelized**: 4 sub-agents built features simultaneously, then merged
- Files: ~110 new, ~15 modified

## 2026-03-05T08:30Z — Session 68: HIRES English Icons + Play Mode Fix
- **HIRES icon extraction**: Downloaded Allied CD from cnc-comm.com → extracted HIRES.MIX (5.8MB, 162 files) + HIRES1.MIX (Aftermath) from REDALERT.MIX inside CD1_ALLIES.iso
- **67 icons upgraded**: All sidebar cameo icons switched from LORES.MIX (32×24 DOS pixel art) to HIRES.MIX (64×48 pre-rendered 3D English icons). Icon scaling via ctx.drawImage(src, 0, 0, 64, 48, dst, x, y, 32, 24)
- **Play mode fix**: `?anttest=play` fell through to default test mode branch, showing E2E test overlay. Added explicit play mode case in AntGame.tsx before default fallback.
- **Asset pipeline changes**: `scripts/extract-ra-assets.ts` now prefers HIRES.MIX for icons with LORES.MIX fallback. Added HIRES_PATH/HIRES1_PATH env var overrides.
- **5 new tests**: HIRES icon scaling (3 tests), play mode URL handling (2 tests) — 76 total pass
- **Wet test confirmed**: SCA01EA shows HIRES icons correctly in both production strips with proper scaling
- Files: extract-ra-assets.ts, AntGame.tsx, renderer.ts, sidebar-ui.test.ts, 68 icon PNGs, manifest.json

## 2026-03-05T07:55Z — Session 67: Production Data Parity Audit + TechLevel System
- **Root cause of ARTY bug**: SCA01EA sets playerTechLevel=3, ARTY has TechLevel=8 in rules.ini, but engine never checked TechLevel. Added full TechLevel gating system.
- **TechLevel pipeline**: Added `techLevel` to ProductionItem interface → piped `playerTechLevel` through ScenarioResult → stored in Game class → filtered in `getAvailableItems()`
- **13 data fixes**: E3→allied, MNLY→both, DOG→KENN prereq, E4+STEK, V2RL→DOME, MNLY→FIX, 4TNK+STEK, APC+TENT, CA→ATEK, SHOK→TSLA, ARTY remove DOME techPrereq, FENC→"Wire Fence", BARB removed
- **Building aliases**: TENT↔BARR, SYRD↔SPEN in `hasBuilding()` for cross-faction prereq resolution
- **TechLevel values**: Every PRODUCTION_ITEMS entry now has techLevel (1-13 for base game, 99 for expansion-only)
- **Tests**: 6 new test sections (faction, prereqs, walls, techLevel, filtering, aliases) + fixed 40+ pre-existing broken assertions across 5 test files
- Files: types.ts, scenario.ts, index.ts, production-parity.test.ts, faction-tech-trees.test.ts, wall-placement.test.ts, data-parity.test.ts, bugfix-green-shadows-production.test.ts

## 2026-03-05T06:30Z — Session 66: Sidebar Scroll Fix + Snow Theatre Palette
- **Sidebar clip rect fix**: Changed strip clip from `height - 40 - STRIP_START_Y` (166px) to `CAMEO_VISIBLE * (CAMEO_H + CAMEO_GAP)` (104px = exactly 4 slots)
- **Scroll arrows outside clip**: Moved arrow rendering to new `renderStripScrollArrows()` helper called AFTER `ctx.restore()` — arrows no longer covered by items
- **Scroll arrow click handling**: Added `getScrollArrowBounds()` to renderer, click detection in `handleSidebarClick()` with up/down scroll by one row (26px) per click
- **Snow theatre palette**: Added per-theatre palette loading in AssetManager (`snow-palette.json`, `interior-palette.json`), new `getTheatrePalette()` with TEMPERATE fallback. Renderer now switches `this.pal` when theatre changes via `palTheatre` tracking.
- **Theatre-aware crate colors**: SNOW crates render icy blue (`#b0c8d4`), TEMPERATE retains brown (`#8B4513`)
- **Tests**: 10 new tests in sidebar-ui.test.ts (scroll arrow regions, clamp bounds, clip height, snow crate colors, palette fallback) — 71 total pass
- **Wet test**: SCG01EA snow terrain confirmed correct (white/grey ground, blue water), SCA01EA temperate confirmed no regression
- Files: renderer.ts, assets.ts, index.ts, sidebar-ui.test.ts

## 2026-03-05T05:00Z — Session 65: SCG01EA Campaign Mission — Einstein Rescue Bug Fixes
- **worldDist units mismatch**: `worldDist()` returns cells (divides by CELL_SIZE), but 9 call sites compared against `N * CELL_SIZE` (pixel scale). Fixed all: auto-load (28.8→1.2 cells), move-arrival (60→2.5), guard-return (36→1.5), transport-load (36→1.5), service-depot (36→1.5), spy-disguise (96→4), dog-detection (72→3), explosions (96→4, 192→8)
- **Transport passenger evacuation**: When transport exits map edge, civilian passengers now count as evacuated (triggers EVAC_CIVILIAN → WIN)
- **Aircraft move bypass**: Agent harness move command skips pathfinding for aircraft (isAircraft), sets direct single-hop path
- **VIP spawn protection**: Civilians spawned via TACTION_REINFORCEMENTS get invulnTick=90 (~6s invulnerability)
- **TMISSION_HOUND_DOG**: Implemented team mission 10 — move to waypoint then switch to guard mode
- **SCG01EA won**: Full agent playthrough — kill guards → Einstein spawns → walks to WP0 → loads in Chinook → helicopter evacuates off east edge → MISSION ACCOMPLISHED (score 727, tick 255)
- 22 agent harness tests passing (1 new: aircraft move)
- Files: index.ts (8 worldDist fixes + transport evacuation), agentHarness.ts (aircraft move), scenario.ts (VIP protection + comment), entity.ts (debug log cleanup), agent-harness.test.ts

## 2026-03-05T04:00Z — Session 64: Upstream Sync — Push Changes to Source Platforms
- **New feature**: Push changes made in CLIaaS back to originating helpdesk platforms
- **10 new/modified files**: auth.ts (extracted shared auth), upstream-adapter.ts (interface), 8 adapter implementations (zendesk, freshdesk, groove, helpcrunch, intercom, helpscout, zoho-desk, hubspot) + factory
- **upstream.ts engine**: enqueueUpstream (fire-and-forget insert into upstream_outbox), upstreamPush (process pending entries by connector group), upstreamStatus (aggregate counts), upstreamRetryFailed (reset failed entries < 3 retries)
- **DB**: upstream_outbox table + upstream_operation/upstream_status enums + SQL migration
- **MCP hooks**: ticket_update/reply/note auto-enqueue when ticket has source+externalId; ticket_create accepts optional `source` param
- **3 new MCP tools**: upstream_push, upstream_status, upstream_retry (total tools: 46)
- **3 new CLI commands**: `cliaas sync upstream push/status/retry [--connector]`
- **Adapter capability matrix**: Zendesk/Freshdesk/Groove/HelpCrunch = full, Intercom/HelpScout/ZohoDesk = no update, HubSpot = notes+create only
- **64 new tests** across 4 test files (auth: 18, adapters: 35, engine: 3, MCP tools: 8) — all passing
- **0 regressions**: existing 21 engine tests + full sync/MCP suite (121 tests) all pass
- Files: cli/sync/{auth,upstream-adapter,upstream}.ts, cli/sync/upstream-adapters/*.ts, cli/mcp/tools/{actions,sync}.ts, cli/commands/sync.ts, src/db/schema.ts, ARCHITECTURE.md

## 2026-03-05T03:30Z — Session 63: Agent Harness — AI Player Interface
- **New file `agentHarness.ts`**: State serializer + command processor + window API installer
- **State serialization** (`__agentState()`): Returns compact JSON with units, enemies, structures, production, economy, map bounds — all in cell coordinates, ~4KB mid-game
- **Command interface** (`__agentCommand()`): 11 command types (move, attack, attack_move, attack_struct, stop, build, cancel_build, place, sell, repair, deploy). Returns per-command ok/error.
- **Step control** (`__agentStep(n, commands?)`): Combine commands + N ticks in one call. Default 15 ticks (1 game-second).
- **Game class additions**: `toggleRepair()`, `sellStructureByIndex()`, `isStructureRepairing()` — public methods wrapping existing private logic
- **AntGame.tsx**: Added `?anttest=agent` mode following existing `compare` mode pattern. Loads paused, fog disabled, harness installed.
- **21 unit tests** (agent-harness.test.ts): state serialization, move/attack/build commands, batch processing, structure ops
- **Wet tested** on cliaas.com: state JSON returns correctly, step advances ticks, move/attack_move/build commands all work, production queue visible
- URL: `https://cliaas.com?anttest=agent&scenario=SCA01EA&difficulty=normal`
- Commit: 0cb11e6, pushed, deployed
- Files: agentHarness.ts (new), agent-harness.test.ts (new), AntGame.tsx, index.ts

## 2026-03-05T01:30Z — Session 62: Sidebar UI — C++ Source Parity Rewrite
- **Complete sidebar layout rewrite** replacing mock approximation with faithful C++ Red Alert parity
- **Phase 1 — Sprite extraction**: Added REPAIR.SHP (3×17×14), SELL.SHP (3×17×14), MAP.SHP (3×17×14), CLOCK.SHP (55×32×24) from LORES.MIX
- **Phase 2 — Type system**: Replaced `SidebarTab` ('infantry'|'vehicle'|'structure') with `StripType` ('left'|'right'), `getItemCategory` → `getStripSide`; deprecated aliases kept
- **Phase 3 — Renderer rewrite**: New layout constants (RADAR_SIZE=140, CREDITS_Y=148, BUTTON_ROW_Y=164, STRIP_START_Y=194). New `renderStrip()` (single-column per strip, CLOCK.SHP overlay). New `renderButtonRow()` (3 sprite icons). Deleted `renderTabBar()`. Added `getStripBounds()` for hit testing. Credits background fill to prevent text bleed.
- **Phase 4 — Game logic**: `stripScrollPositions` replacing `activeTab`/`tabScrollPositions`. Per-strip scroll via `getStripBounds()`. Rewrote `sidebarItemAt()` + `handleSidebarClick()` for dual strips. Button row: repair/sell/map. Infantry+vehicles share right strip queue. Added `centerOnBase()` for map button.
- **Phase 5 — Tests**: 63 tests all passing — dual production strips, C++ parity queues (infantry+vehicle share right), button row, strip bounds + scroll
- **Bug fix**: mouse.png was degenerate (16144×0 PNG, MOUSE.SHP variable-size frames). Skipped in extraction, removed from manifest. This fixed the persistent "Failed to load image: /ra/assets/mouse.png" mission load error.
- **Wet test**: Game loads successfully on cliaas.com. Sidebar shows: radar minimap (top), credits, 3 sprite icon buttons (repair/sell/map), power bar (left), dual production strips, superweapons (bottom). No tab bar.
- Files: extract-ra-assets.ts, types.ts, renderer.ts, index.ts, sidebar-ui.test.ts, manifest.json

## 2026-03-04T23:10Z — Session 61: Map Tile Fix — TREE Terrain + Deferred Trees
- **Root cause 1 fixed**: TREE terrain cells with clear templates (tmpl=0/0xFFFF) now use tileset clear tile (255,0) instead of procedural grass — eliminates visible light green blocks
- **Root cause 2 fixed**: Tree sprite rendering deferred to second pass — clump sprites (TC01-TC05, 72-96px) no longer overwritten by _clump satellite cells' grass fill
- **Broken asset removed**: mouse.png was degenerate (16144×0 PNG, frameHeight=0) causing mission load failure — removed from manifest.json
- **10 new tests** (tree-tile-rendering.test.ts): condition logic for TREE/CLEAR atlas path, deferred draw list pattern, _clump satellite recognition
- Wet tested on cliaas.com: zoomed inspection confirms uniform tileset grass, tree clumps render fully
- Files: renderer.ts (2 changes in renderTerrain), manifest.json, tree-tile-rendering.test.ts (new)

## 2026-03-04T18:00Z — Session 60: Sprite-Based Fog of War (C++ Parity)
- **Replaced blocky fillRect fog** with faithful C++ Cell_Shadow sprite-based shroud rendering
- **Extracted SHADOW.SHP** from CONQUER.MIX: 48 frames, 24x24px each → `public/ra/assets/shadow.png`
- **New module `engine/shadow.ts`**: 256-entry lookup table (byte-for-byte from C++ display.cpp), 8-neighbor bitmask function with exact C++ bit layout (NW=0x40 N=0x80 NE=0x01 W=0x20 E=0x02 SW=0x10 S=0x08 SE=0x04)
- **Renderer rewrite**: `ensureShadowOverlay()` pre-processes sprite sheet → semi-transparent black (alpha=166, ~65% matching C++ ShadowTrans), `renderFogOfWar()` computes bitmask per mapped cell, draws sprite frame overlay
- **Code review**: fixed 3 findings — drawImage source dimensions use sheet metadata (not hardcoded CELL_SIZE), hoisted closure + fillStyle above hot loop
- **25 new tests** (shadow-table.test.ts): table length, value range, 14 spot checks from C++ source, bitmask function per-direction, bit layout constants
- Build clean, all tests pass, deployed to cliaas.com
- Files: shadow.ts (new), renderer.ts (modified), extract-ra-assets.ts (+1 line), shadow-table.test.ts (new), shadow.png (new asset)

## 2026-03-04T17:20Z — Session 59: Campaign Control Harness — 5 Critical Gap Fixes
- **Gap #2 (EINSTEIN)**: Added `I_EINSTEIN` to UnitType enum, EINSTEIN entry in UNIT_STATS (image='einstein', civilian VIP type)
- **Gap #3 (Civilian Evacuation)**: Added `civiliansEvacuated` counter to Game class, increments when C1-C10 or EINSTEIN leave map edge, wired into `buildTriggerState` for TEVENT_EVAC_CIVILIAN — SCG01EA now winnable
- **Gap #1 (AI House Credits)**: parseScenarioINI reads `Credits=` for all non-player houses, stored in `houseCredits` map, applied in `start()` alongside PROC-based credits (×100 multiplier). AI houses now start with proper economy.
- **Gap #4 (BEGIN_PRODUCTION)**: Implemented TACTION_BEGIN_PRODUCTION — passes trigger house index through result, index.ts creates AIHouseState for the house if not already present, enabling AI strategic planner loop
- **Gap #5 (Edge= Spawning)**: Parsed `Edge=` per house from INI, stored in houseEdges. Reinforcement spawning with `origin=-1` now computes random position along the house's edge (North/South/East/West) within map bounds
- **New exports**: `houseIdToHouse()` from scenario.ts, `CIVILIAN_UNIT_TYPES` from types.ts
- **10 new tests** in campaign-system.test.ts: EINSTEIN stats, civilian detection, AI credits parsing, Edge field parsing, BEGIN_PRODUCTION trigger action, houseIdToHouse mapping
- All 35 campaign tests pass, 0 TypeScript errors in modified files
- Files: types.ts, scenario.ts, index.ts, campaign-system.test.ts

## 2026-03-04T06:15Z — Session 58: C++ Combat Parity for Ant Missions
- **Game-breaking fix**: ANT1 Mandible warhead HollowPoint→Super (0.05x→1.0x vs armor = 20x damage increase)
- **modifyDamage()** function added to types.ts — mirrors C++ Modify_Damage (combat.cpp:72-129) exactly
  - SpreadFactor-based inverse distance falloff, MinDamage=1, MaxDamage=1000, houseBias
- **ANT1 stats fixed**: strength 150→125, armor light→heavy, speed 5→8, rot 5→8, sight 2→3
- **applySplashDamage**: universal 1.5-cell radius + inverse falloff via modifyDamage (was linear)
- **damageSpeedFactor**: removed fabricated ConditionRed 0.5x tier (C++ has one tier only)
- **E2 Grenadier**: production faction both→soviet
- **42-test parity suite** (ant-combat-parity.test.ts) — all passing
- **Updated combat-parity.test.ts**: fixed AP spreadFactor (1→3), Nuke→Fire spreadFactor test, pre-existing assertion errors
- **11 items marked [VERIFIED]** in MISSING_FEATURES.md
- **Wet test SCA01EA**: Deployed to cliaas.com, Konami code works (WASD), mission loads, combat confirmed working:
  - ANT3 TeslaZap deals 54 dmg/hit to JEEP (Super warhead, was ~3 with HollowPoint)
  - E1 M1Carbine deals 9 dmg/hit to ants (SA vs heavy at distance)
  - ANT2 FireballLauncher splash: 17/34/113 varying by distance — inverse formula confirmed
  - Fire warhead friendly-fire splash working (ants take self-splash)
  - 3 ANT3s can kill a 150hp JEEP — ants are now appropriately dangerous
- Committed (01ff5b0), pushed, deployed

## 2026-03-04T05:45Z — Session 57: Game Map Visual Fixes (5 Fixes)
- Fixed 5 visual issues in Easter Egg Ant Mission game map after post-deploy screenshot review
- **Fix 1**: Generous initial fog reveal (radius 15) around player units — eliminates massive black void at mission start
- **Fix 2 & 5**: Round tile + fog screen coordinates with Math.round() — eliminates sub-pixel tile seams and dark patches
- **Fix 3**: "NO BASE" message in empty sidebar production strip — ant missions have no base/factory
- **Fix 4**: Cap power bar height to 120px max — prevents oversized visual element
- New test for coordinate rounding logic in mappack-uint16.test.ts (14/14 pass)
- Code review: all changes correct, no bugs, no breaking changes
- Files: index.ts (fog reveal), renderer.ts (4 rendering fixes), mappack-uint16.test.ts (1 new test)

## 2026-03-04T10:30Z — Session 56: Wet Test → 6-Agent Bug Fix → Merge Recovery
- **Comprehensive wet testing** of entire CLIaaS platform: auth enforcement, CLI --json, all 14 dashboard pages, email provider magic link, connector test verification, hard security testing
- **6 bugs found**: (1) cross-workspace data leakage (RLS), (2) analytics 500 on empty workspace, (3) onboarding seed failure, (4) no rate limiting on magic link, (5) Unicode/Cyrillic homoglyph emails accepted, (6) React hydration errors #418
- **6 Opus agents launched** in isolated worktrees to fix all bugs in parallel
- **Merge recovery**: RLS agent (39 files, 43 tests) committed and merged cleanly. 3 other agents' worktrees were auto-cleaned; their changes lost during stash conflict resolution. Reapplied manually from surviving worktrees + agent output descriptions.
- **Final fixes applied**: emptyAnalytics() helper with try/catch, dual-layer rate limiting (3/email/5min, 10/IP/15min), validateEmail() on all auth routes, useEffect hydration patterns in 4 components
- **89 new tests**: 43 RLS + 5 analytics + 14 rate limit + 20 email validation + 7 hydration — all passing
- Committed (7c63459), pushed, deployed to cliaas.com
- Files: 48+ files changed across RLS (39) + security hardening (9) + 6 new test files + 1 new lib file

## 2026-03-04T07:15Z — Session 55: Cross-Workspace Data Leakage Fix
- Fixed critical security bug: data from one workspace visible to users in other workspaces
- Root cause: API routes and data stores were not filtering by `auth.user.workspaceId`
- **37 files modified**, 1 new test file with 43 tests (all passing)
- **DB-backed stores fixed** (Drizzle ORM `and()` clauses): rules, KB articles, SLA policies, workflows
- **In-memory stores fixed** (filter functions): brands, webhooks, automation rules/audit, SMS/social/voice channels
- **Audit routes fixed**: audit, audit/export, security/audit, security/audit/export
- **Not fixed (intentional)**: Slack/Teams integrations (global singletons, not per-workspace data)
- All backward-compatible: workspace parameters are optional
- Code review: no high-severity issues found

## 2026-03-04T03:45Z — Session 54: DRY Connector Refactoring (Remaining 7)
- Completed the DRY refactoring of all 10 platform connectors in `cli/connectors/`
- Prior commits (e655f53, 3b961db) had already handled base utilities + freshdesk/groove/helpcrunch
- This session refactored the remaining 7: HelpScout, HubSpot, Intercom, Kayako, Kayako Classic, Zendesk, Zoho Desk
- **Base enhancements**: `normalize.ts` (new) with initCounts, fuzzyStatusMatch, fuzzyPriorityMatch, flushCollectedOrgs, epochToISO; `client.ts` gained responseMiddleware + errorHandler hooks; `types.ts` gained ExportCounts, StatusMap, PriorityMap types
- **Kayako major refactor**: Eliminated 60-line custom kayakoFetch, migrated to createClient with responseMiddleware (session ID capture) and errorHandler (MFA 403). Removed createKayakoFetchFn adapter. kayakoFetch kept as deprecated backward-compat wrapper.
- Removed 5 duplicate mapStatus/mapPriority functions, 2 local epochToISO, 3 manual org-writing loops, 10 inline counts objects
- Net result: -73 lines across 7 files, all 124 tests pass (10 live skipped)
- Commit: efe8219 on branch refactor/dry-connectors, pushed to origin
- Files: cli/connectors/{helpscout,hubspot,intercom,kayako,kayako-classic,zendesk,zoho-desk}.ts, cli/connectors/base/{normalize.ts,types.ts,client.ts,index.ts}

## 2026-03-04T06:50Z — Session 53: Animated Hero Demo for Landing Page
- Replaced static `<pre>` terminal demo on landing page with animated `<video autoplay muted loop>` hero
- Created `/demo-recording` page with typewriter animation through 5-turn scenario (install → setup → sync → triage → investigation)
- Recorded 235 frames via Puppeteer headless Chrome at 2x resolution, converted with ffmpeg to WebM (371KB) + MP4 (1.3MB)
- Created `HeroDemo` component with `prefers-reduced-motion` fallback (original static `<pre>` preserved)
- Created `useReducedMotion` hook, `estimateDuration` utility for scenario timing validation
- Added `/demo-recording` to AppNavWrapper's NO_NAV_PREFIXES for clean recording
- Added immutable cache headers for `/demo/:path*` in next.config.ts
- Code review: fixed video fallback text, added aria-label to static path, documented SSR behavior
- 13 new tests (7 HeroDemo + 6 scenario), all pass, build clean, deployed to cliaas.com
- Files: scenario.ts, demo-recording/page.tsx, HeroDemo.tsx, useReducedMotion.ts, page.tsx, next.config.ts, AppNavWrapper.tsx

## 2026-03-03T18:20Z — Session 52: Unit Behavior, Sidebar Overhaul & FMV Support
- **Phase 1 — Unit fixes**: Fixed Tanya "jumping around" by reducing moveToward snap threshold from effectiveSpeed (~3px) to 0.5px sub-pixel. Changed movementSpeed default fraction from 0.5 to 1.0 (units now move at full stat speed, matching C++ parity). Verified SCG01EA sidebar gating already correctly prevents production for no-base missions. Investigated Tanya attack mechanics — confirmed Colt45 correctly one-shots infantry (hitscan instant damage, 50dmg vs 50HP).
- **Phase 2 — Sidebar overhaul**: Changed SIDEBAR_W from 100→160px (original RA). Moved minimap from bottom to top of sidebar. Added sprite-based sidebar background (sidebar.png tiled). Added vertical power bar (powerbar.png). Switched to 2-column production strip with 32x24 cameo icon sprites ({type}icon.png). Added proper tab bar offset past power bar. Updated all minimap position references via renderer.getMinimapBounds(). Updated sidebarItemAt() for 2-column hit testing. Updated sell/repair + superweapon button positioning. Updated scroll wheel calculations.
- **Phase 3 — Briefing extension**: Added generateGenericBriefing() that creates procedural briefings from INI [Briefing] text for all 61 campaign missions. Faction-aware visual themes (Allied=blue, Soviet=red). BriefingRenderer.start() now accepts optional iniBriefingText fallback. Wired TACTION_PLAY_MOVIE trigger as EVA title card.
- Code review findings fixed: comment mismatches, tab bar/power bar overlap resolved
- 11 new tests (unit-behavior-sidebar.test.ts), TypeScript clean, all pass
- Files: entity.ts, index.ts, renderer.ts, briefing.ts, AntGame.tsx

## 2026-03-03T06:50Z — Session 51: Multi-Theatre Tileset Extraction & MapPack Fix
- Extracted SNOW and INTERIOR tilesets alongside TEMPERATE (3261 tiles across 3 theatres)
- Refactored `scripts/extract-ra-tiles.ts` into reusable `extractTheatre(config)` with theatre configs
- Extended TEMPERATE template map with IDs >255 (bridges 378-383, hill 400, cliffs 401-408, shores 500-508, etc.)
- Added INTERIOR template map (IDs 253-399): arrows, floors, walls, light walls, stripes, extras
- Updated AssetManager to load per-theatre tilesets (Map<string, {image, meta}>), backwards-compat TEMPERATE API
- Renderer now theatre-aware: refreshes tileset cache on theatre change, removed TEMPERATE-only guard
- Fixed 0xFFFF clear check in renderer (both tileset path and procedural fallback)
- Added SNOW terrain classification (same ranges as TEMPERATE — was previously blocked)
- Added INTERIOR terrain classification: walls (329-377) → ROCK, light walls (291-317) → WALL
- Code review: fixed renderLayer() missing tileset reset branch, procedural 0xFFFF guard, ESM test imports
- 30 tests pass (multi-theatre-tileset + mappack-uint16), TypeScript clean (only pre-existing error)

## 2026-03-03T06:15Z — Session 50: Campaign Mission Selection System
- Implemented full campaign mission selection for Red Alert Easter Egg (6 phases)
- Phase 0: Dynamic Player House refactor — replaced 40+ hardcoded `House.Spain || House.Greece` checks with `this.isAllied()` and dynamic `_playerHouses` Set in entity.ts. Added England, France, GoodGuy, BadGuy to House enum. Added `buildAlliancesFromINI()` for scenario-driven alliances.
- Phase 1: Extended extract-ra-assets.ts to find 57 campaign mission INIs (Allied 14, Soviet 14, CS Allied 8, CS Soviet 8)
- Phase 2: Campaign data structures in scenario.ts — CampaignId, CampaignDef, CampaignMission types, CAMPAIGNS array, progress persistence via localStorage
- Phase 3: New UI screens in AntGame.tsx — main_menu (4 buttons), faction_select (Allied/Soviet), campaign_select (mission grid with linear unlock). Updated briefing/win/lose screens for campaign context.
- Phase 4: Generic campaign briefing in briefing.ts — `buildGenericBriefing()` auto-generates static_burst → classified → radar/intel_report → fade_out sequence from free-form text
- Phase 5: Campaign victory conditions — added generic "all enemies destroyed" fallback for non-ant missions in checkVictoryConditions()
- 20 new tests (campaign-system.test.ts): data structures, progress persistence, dynamic player houses, alliance building, House enum completeness
- TypeScript clean (only pre-existing renderer.ts:2945 error), all tests pass

## 2026-03-03T05:30Z — Session 49: Aftermath Expansion Content Extraction
- Extracted EXPAND2.MIX from freeware Aftermath archive (download + DOSBox RTP patch + ccmixar unpack)
- Updated extract-ra-assets.ts to load EXPAND2.MIX from filesystem, extract 5 new sprites + 2 INI files
- New sprites: CTNK (32 frames 48x48), QTNK (96 frames 48x48), DTRK (32 frames 24x24), TTNK (64 frames 48x48), MSUB (16 frames 56x56)
- Updated UNIT_STATS image references: CTNK→ctnk, QTNK→qtnk, DTRK→dtrk, TTNK→ttnk (replaced stand-in sprites)
- MRLS.SHP not in freeware data — uses v2rl stand-in (similar vehicle silhouette)
- Verified MRLS combat pipeline: selectWeapon returns Nike for ground+air, isAntiAir flag enables aircraft targeting
- 26 new tests (aftermath-content.test.ts): sprite refs, MRLS dual-weapon, Mechanic parity, production gating
- Code review fixes: removed unused import, added SKIP logs, documented DTRK/QTNK non-buildable, Mechanic faction test
- All 1302 tests pass (46 files), deployed to cliaas.com

## 2026-03-03T02:30Z — Session 48: RA Engine C++ Parity — Multi-Agent Parallel Fix
- Executed massive 10-agent parallel plan fixing ~150 C++ parity discrepancies in RA TypeScript engine
- Wave 1 (Agent 0): Fixed all data/stat values in types.ts + scenario.ts (~100 value changes, 113 tests)
- Wave 2 (9 agents in parallel worktrees): Fixed formulas, algorithms, mechanics across all engine files
  - Agent 1: Combat formulas (damage falloff, splash, dog kill) — 39 tests
  - Agent 2: Economy & ore (bail system, gold/gem values, lump-sum unload) — 42 tests
  - Agent 3: Movement (removed 3-point turns, fixed speed tiers, groundspeedBias) — 14 tests
  - Agent 4: Spy/engineer/crate (spy rewrite, engineer full repair, weighted crates) — 28 tests
  - Agent 5: Superweapons & power (Tesla cutoff, power values, ParaBomb/ParaInfantry) — 59 tests
  - Agent 6: Naval/aircraft/cloaking (cloak timing, takeoff ramping, rearm ROF) — 21 tests
  - Agent 7: Production/repair/sell (sliding power penalty, multi-factory, flat sell refund) — 51 tests
  - Agent 8: Triggers/AI/threat (C++ enum indices, cost-proportional threat scoring) — 48 tests
  - Agent 9: New units (Tanya C4, Thief, V2RL, Minelayer, Gap Generator, Chrono Tank, MAD Tank, Demo Truck, Mechanic) — 45 tests
- Post-merge reconciliation: fixed 53 test failures from worktree overlap, cleaned up worktrees
- Final: 1259 tests pass (was 913), 44 test files, build clean
- New units added: I_TANYA, I_THF, V_V2RL, V_MNLY, V_MRLS + Nuke/Mechanical warheads

## 2026-02-27T08:00Z — Session 43: Visual Workflow Builder — Refactoring
- Continued from previous session (implemented 8-phase visual workflow builder, applied correctness fixes, committed)
- Completed 6 refactor items from code review:
  1. Extracted `tryDb()`/`getDefaultWorkspaceId()` to `src/lib/store-helpers.ts` (shared by chatbot + workflow stores)
  2. Fixed `WorkflowExport` import type (inline `import()` → static import)
  3. Extracted `scopeGuard()` to `cli/mcp/tools/scopes.ts` (eliminated 4 local copies)
  4. Extracted automation constants to `src/lib/automation/constants.ts` (15 fields, 15 operators, 13 actions, 5 events)
  5. Added `templateKey` support to `POST /api/workflows` — server-side template creation, eliminated ~80 lines of client-side template duplication
  6. Split `page.tsx` from 1727→303 lines into 6 sub-components in `_components/`: types.ts, ConditionRows.tsx, ActionRows.tsx, NodeEditors.tsx, TransitionEditor.tsx, WorkflowBuilder.tsx
- All 43 workflow tests + MCP server test passing, typecheck clean
- Next: entering plan mode to discuss UX simplification

## 2026-02-26T22:50Z — Session 42: Comprehensive API Testing + Live Integration
- Created `src/__tests__/api-features.test.ts`: **193 unit tests** across 21 sections (auth, tickets, KB, webhooks, automations, custom fields, SLA, analytics, API keys, portal, chat, SCIM, channels, billing, MCP tools, data provider, auth enforcement)
- Applied correctness review fixes: global state cleanup, guard assertions, tighter status codes, proper type casts
- Fixed `getDataProvider()` dir override: was ignored when DATABASE_URL set, now always returns fresh JsonlProvider when dir is passed
- Created `scripts/live-integration-test.ts`: **41 live integration tests** against real Postgres via SSH tunnel
- Set up VPS Postgres (docker, pgvector, drizzle push), created tenant/workspace/user chain for auth
- Both reviewers passed: stale JSDoc fixed, timeout protection added, skip logging for unavailable sections, DATABASE_URL guard for auth tests
- Commits: 0bcc790 (193 unit tests), c7285ee (live integration + data provider fix)

## 2026-02-26T21:00Z — Session 41: HubSpot Connector Activation
- Created HubSpot private app "CLIaaS" with 6 scopes: crm.objects.{companies,contacts}.{read,write}, crm.objects.owners.read, tickets
- The `tickets` legacy scope required clicking the `<label>` wrapper via JS (`.closest('label').click()`) — direct checkbox clicks don't trigger React state
- HubSpot account: ID 245335647, na2 region, private app ID 32404093
- Created 10 sample tickets via API, exported (10 tickets, 2 contacts, 1 owner, 1 company)
- Ingested into VPS DB: **142 tickets across 8 connectors** (50 zendesk + 32 freshdesk + 30 groove + 10 helpcrunch + 10 hubspot + 5 intercom + 4 helpscout + 1 zoho-desk)
- HubSpot token pushed to VPS .env

## 2026-02-26T19:30Z — Session 40: Connector API Keys + Multi-Source Ingest
- Grabbed API keys via browser automation: Help Scout OAuth (existing app), Zoho Desk OAuth (Self Client JP region)
- Verified all 6 active connectors: Zendesk, Freshdesk, Groove, Intercom, Help Scout, Zoho Desk
- Fixed Zoho Desk connector: JP region domain support via `ZOHO_DESK_API_DOMAIN` env var
- Ran exports for all 5 new connectors (Groove: 30, Freshdesk: 32, Intercom: 5, Help Scout: 4, Zoho Desk: 1)
- Made ingest engine multi-provider: `provider` param on IngestOptions, ticket source from data, org/user dedup across connectors
- Added `db ingest` CLI command (generic, any provider) alongside existing `db ingest-zendesk`
- Ingested all exports into VPS DB: **122 tickets across 6 connectors** (50 zendesk + 32 freshdesk + 30 groove + 5 intercom + 4 helpscout + 1 zoho-desk)
- All connector keys pushed to VPS .env (not in git)
- 1099 tests passing (3 Easter Egg pre-existing failures), typecheck clean
- Skipped: HubSpot (no account), HelpCrunch (0 tickets)

## 2026-02-26T12:00Z — Session 39: RA Engine C++ Parity — Round 2
- Completed 3 batches (19 total fixes): S1-S5 Critical, H1-H6 High, M1-M8 Medium
- All committed + deployed: 6372818, 82cf45d, 5b7b6f1
- All 6 original sweep agents reported in — findings cross-referenced, all addressed
- Launched 3 new sweep agents: infantry.cpp, building.cpp, house.cpp+team.cpp
- Cataloged ~40 remaining unfixed issues from original sweeps (many were already fixed)
- Key genuine gaps: C++ threat scoring algorithm (cost-based vs heuristic), fog bleed artifacts, camera bounds
- Currently: waiting for new sweep agents, will organize next fix batch

## 2026-02-25T06:00Z — Session 37: Tier-Aware Architecture Build — ALL 6 PHASES COMPLETE
- Completed Phases 2-6 (Phase 1 done in Session 36)
- Phase 2: RemoteProvider with auto-pagination, error handling, `config set-mode` CLI command, 2 new API endpoints, 47 tests
- Phase 3: Sync engine (cli/sync/engine.ts, worker.ts), CLI commands (sync run/start/status), MCP tools (sync_status, sync_trigger), 10 tests
- Phase 4: Feature matrix (10 features × 6 tiers), FeatureGate component, 5 premium pages gated, byoc plan, 29 tests
- Phase 5: HybridProvider (local DB + outbox), sync_outbox/sync_conflicts tables, conflict detection (cli/sync/conflict.ts), hybrid sync ops (pull/push/conflicts/resolve), 3 new MCP tools (sync_pull/push/conflicts), 29 tests
- Phase 6: install-byoc.sh (interactive wizard), WIZARD/ folder (claude.md, agents.md, TROUBLESHOOTING.md), .mcp.json.example, /setup page + /api/setup route, BYOC mode detection on landing page, 19 tests
- Final stats: 910 tests passing, 0 failures, TypeScript clean, 30 MCP tools, 59 DB tables
- Phases 2/3/4 ran as parallel background agents, then 5/6 ran in parallel
- Landing page rewritten: split into ByocHome (BYOC mode) + MarketingHome (hosted mode)

## 2026-02-25T04:00Z — Session 36: Tier-Aware Architecture Build (Phase 1)
- Phase 1 COMPLETE: DataProvider interface + factory pattern
  - `src/lib/data-provider/` — types.ts, jsonl-provider.ts, db-provider.ts, remote-provider.ts (stub), hybrid-provider.ts (stub), index.ts
  - Rewired `cli/mcp/util.ts` + `src/lib/data.ts` to use DataProvider
  - Updated all 7 MCP tool files + resources + LLM providers
  - 14 unit tests, TypeScript clean

## 2026-02-24T17:00Z — Session 35: WASM Comparison Test — Menu Navigation Fix
- Fixed WASM Red Alert rendering in headless Playwright for visual comparison with TS engine
- Root cause: `specialHTMLTargets[0]` initialized to 0, preventing Emscripten event registration
- Key discovery: page-dispatched keyboard events BLOCK the WASM main thread permanently (ASYNCIFY disruption)
- Solution: Playwright CDP keyboard.press() one at a time, wait for game to become responsive between presses
- Game navigates: "CHOOSE YOUR SIDE" → Allied movie → mission briefing (stuck at "OK" button needing mouse click)
- Screenshot variance: 4 unique screens across 30 captures (was ALL IDENTICAL before)
- Both tests pass in 2.3 minutes, TS engine captures 30 QA screenshots, WASM captures 30 varied screenshots
- Files: original.html (autoplay coordination, screen detection), test-compare.ts (CDP keyboard navigation)

## 2026-02-25T00:00Z — Session 34: Week 4 Billing — Stripe Integration
- Implemented full Stripe billing system: 10 new files, ~10 modified files, 31 new tests
- Phase 1: Added `stripe` SDK (v20.3.1), env placeholders in .env.example
- Phase 2: Extended tenants table with 5 Stripe fields, added `usage_metrics` + `billing_events` tables
- Phase 3: Billing library (5 modules): plans.ts, stripe.ts, usage.ts, checkout.ts, index.ts
- Phase 4: 4 API routes — GET /api/billing, POST checkout/portal, Stripe webhook with signature verification
- Phase 5: Quota enforcement on ticket creation (429) and AI resolution (skip), usage metering
- Phase 6: /billing page (brutalist zinc design), founder badge, usage meters, plan cards, AppNav link
- Founder plan: Pro-level quotas free forever for tenants created before Feb 28 2026 11:59:59 PM PST
- Signup route updated: `isFounderEligible(new Date()) ? 'founder' : 'free'`
- 684 tests passing (up from 653), typecheck clean, build passes
- Updated ARCHITECTURE.md with billing section, 55 DB tables, 30 pages

## 2026-02-24T18:00Z — Session 30: 5-Phase Code Review Hardening + Enterprise Roadmap
- Implemented 5-phase hardening plan from code review findings (8 new files, +1148/-448 LOC)
- Phase 1: Automation engine now applies side effects (notifications, webhooks, changes)
- Phase 2: SCIM hardened — HMAC timing-safe auth, RFC 7644 PatchOp, store consolidation
- Phase 3: Single connector registry replaces 3 fragmented metadata sources
- Phase 4: Magic-link cleanup, approval queue dedup, ROI tracker fix
- Phase 5: All 38 routes migrated to parseJsonBody utility
- Code review: 0 critical issues, fixed PatchOp validation + SCIM parseJsonBody
- 533 tests passing (+36 new), typecheck clean, deployed to cliaas.com (commit 0194774)
- Enterprise readiness assessment: identified 4 non-negotiable blockers (auth, billing, job queue, secrets)
- Stored 6-week enterprise roadmap in ARCHITECTURE.md
- **Next**: Week 1 plan — auth enforcement across 101 routes, API key CRUD, MFA/TOTP

## 2026-02-24T15:22Z — Session 29: 6-Phase Platform Activation
- Implemented full 6-phase plan to activate dormant infrastructure (56 files, +3073 LOC)
- Phase 0: Fixed 9 lint errors (require→import, any→Record, setState-in-effect, prefer-const)
- Phase 1: Wired all 10 connectors into web/API/DB (was 4), added 4 providers to DB enum, 21 connector tests
- Phase 2: Wired automation engine to event dispatcher, created executor/scheduler/4 API routes, 13 tests
- Phase 3: AI resolution pipeline with confidence routing, approval queue, ROI tracker, 4 API routes, 15 tests
- Phase 4: Magic-link portal auth, SCIM 2.0 provisioning (Users/Groups), audit evidence export, 17 tests
- Phase 5: 7 MCP write tools with confirmation pattern, scope controls, audit logging, 8 tests
- Fixed regex ordering bug in extractExternalId (ky matched before kyc)
- Code review: 2 HIGH issues (regex order + SCIM PatchOp), 5 MEDIUM, 8 LOW correctness; 13 refactoring findings
- 497 tests passing, deployed to cliaas.com (commit 259a734)


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
