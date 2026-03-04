# Session Summaries

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
