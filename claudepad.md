# Session Summaries

## 2026-02-22T23:00Z — Session 11: RA Visual Fidelity — Sprites, Effects, Triggers, Terrain
- Implemented 7-part plan to make ant missions look/play like real Red Alert
- Fixed sprite frame mapping: ants (104 frames: stand/walk/attack), infantry (DoControls formula), vehicles (BodyShape[32])
- Added animation metadata: INFANTRY_ANIMS lookup (E1-MEDI), BODY_SHAPE table, ANT_ANIM constants
- Added missing unit stats: 4TNK, APC, ARTY, HARV, MCV, E2, E4, E6, DOG, SPY, MEDI + weapons
- Replaced procedural effects with RA sprite sheets: fball1, piff, piffpiff, veh-hit1
- Implemented RA trigger system: 18-field INI format, TeamTypes, trigger evaluation (TIME/GLOBAL/ENTERED)
- Decoded MapPack Base64→LCW terrain template data for varied terrain visuals
- Rewrote ant sprite generator: 32→104 frames with walk/attack animations
- Fixed 3 code review bugs: pendingAntTriggers missing CREATE_TEAM, FORCE_TRIGGER no-op, persistent trigger infinite spawning
- User feedback: "get the actual triggers from the original gamecode" → researched exact RA source formats

## 2026-02-22T21:30Z — Session 10: Phase 3 Polish — Briefings, Progression, Performance
- Addressed code review findings from Session 9 (committed d797242):
  - Fixed guard scan range 24x too large (worldDist returns cells, not pixels)
  - Fixed selection box Y2 typo (dragStartX → dragStartY)
  - Fixed stop() race condition (set state=paused before clearing timers)
  - Removed redundant state check in game loop accumulator
- Built Phase 3 Polish features:
  - Mission select screen with 4 unlockable ant missions
  - Mission briefing screen with text, objective, LAUNCH MISSION button
  - Win/lose overlays with Next Mission / Retry / Replay / Mission Select / Exit
  - localStorage progress tracking (antmissions_progress key)
  - Keyboard shortcuts: 1-4 select, Enter launch, Esc back, F10 exit
  - All-complete celebration screen with trophy
- Performance optimizations:
  - Fog of war: track visibleCells array, downgrade only those (O(visible) vs O(16384))
  - Pathfinding: check existing node before allocating new AStarNode object
  - Removed dead animFrameId field from Game class
- Added to scenario.ts: MISSIONS array, MissionInfo type, loadProgress/saveProgress
- Re-exported mission types from engine/index.ts barrel
- Committed b2d85e3, pushed to main
- Note: build broken by pre-existing drizzle-orm import in cli/db/ingest-zendesk.ts (not our code)

## 2026-02-22T20:00Z — Session 9: Bug Fixes & Visual Fidelity
- Fixed 3 critical bugs found during browser testing:
  1. RAF throttling: switched game loop to setTimeout (immune to Chrome background tab throttling)
  2. Edge scroll drift: added mouseActive guard (camera no longer scrolls when mouse at 0,0)
  3. Input event ordering: moved clearEvents() AFTER processInput() (selection/commands now work)
- Added full visual fidelity to renderer:
  - Fog of war system (shroud=black, fog=semi-transparent, visible=clear)
  - Procedural terrain variation via cellHash
  - Explosion, muzzle flash, blood splatter, tesla arc particle effects
  - Death fade animation, damage flash overlay
  - Selection circles (green ellipses under selected units)
  - Improved health bars with pip segments, color coding (green/yellow/red)
  - Unit info panel for selected units
  - Fog-aware minimap with camera viewport indicator
- Entity system: added deathTick, damageFlash, lastGuardScan, lastAIScan fields
- Rate-limited AI scanning (guard every 15 ticks, ant AI every 8 ticks)
- Pathfinding: swap-and-pop optimization for O(1) open list removal
- Committed 88b515a, pushed to main
- Note: Chrome extension clicks don't reach canvas mousedown/mouseup handlers (testing artifact only)

## 2026-02-22T18:30Z — Session 8: Native TS Ant Mission Engine
- Replaced WASM/Emscripten Easter egg with pure TypeScript/Canvas 2D game engine
- Built 10 engine modules: types, assets, camera, input, entity, map, pathfinding, renderer, scenario, index
- Asset pipeline: MIX→SHP→PNG extraction (27 sprites), procedural ant sprite generation (3 ant types)
- SHP parser fixed: 14-byte KeyFrameHeaderType header, 8-byte offset entries with bit-masked flags
- MIX decryption: RSA + Blowfish ECB working for encrypted MIX archives
- Ant sprites (ANT1-3.SHP) not in freeware CS download — generated red/orange/green ants procedurally
- Game renders terrain, sprites from original game data, minimap, selection, health bars
- Selection (left click), movement commands (right click), combat, ant HUNT AI all functional
- Win/lose conditions with 3-second grace period, mission accomplished/failed overlays
- tsconfig.json: excluded `scripts/` dir to avoid BigInt/ES2020 build errors
- Cleaned up 9 debug scripts

## 2026-02-22T08:00Z — Session 7: Wave 5 — Live Demo Pipeline
- Saved API keys (Anthropic + OpenAI) to .env from master.env
- Created scripts/seed-zendesk.ts, seeded 25 realistic tickets into Zendesk (billing, auth, bugs, features, onboarding, API, account)
- Re-exported Zendesk: 26 tickets, 26 messages, 3 users, 1 org, 1 KB, 21 rules
- Added `import 'dotenv/config'` to cli/index.ts (no more `-r dotenv/config` needed)
- Configured Claude as LLM provider, validated all 4 workflows: triage, draft, kb suggest, summarize
- Updated src/lib/data.ts: multi-source export loading (merges all export dirs), added 'kayako-classic' source
- Redesigned landing page: hero, live CLI terminal demo, connector badges (3 live), workflow cards, LLM providers, routes, footer
- Updated explainer: team=Robert Cordwell, added Kayako Classic connector, mentioned live Zendesk data
- Deployed to cliaas.com (build passes, site returns 200)
- Captured 1440x2296 full-page screenshot via Playwright
- Fixed make_submission_zip.sh (mkdir for zip output path), created submission bundle (52MB)
- Two commits pushed: 1f21227 (main changes) + 892021d (screenshot + zip fix)

## 2026-02-22T08:00Z — Session 7: Wave 5 — Live Demo Pipeline
- Saved API keys (Anthropic + OpenAI) to .env from master.env
- Created scripts/seed-zendesk.ts, seeded 25 realistic tickets into Zendesk (billing, auth, bugs, features, onboarding, API, account)
- Re-exported Zendesk: 26 tickets, 26 messages, 3 users, 1 org, 1 KB, 21 rules
- Added `import 'dotenv/config'` to cli/index.ts (no more `-r dotenv/config` needed)
- Configured Claude as LLM provider, validated all 4 workflows: triage, draft, kb suggest, summarize
- Updated src/lib/data.ts: multi-source export loading (merges all export dirs), added 'kayako-classic' source
- Redesigned landing page: hero, live CLI terminal demo, connector badges (3 live), workflow cards, LLM providers, routes, footer
- Updated explainer: team=Robert Cordwell, added Kayako Classic connector, mentioned live Zendesk data
- Deployed to cliaas.com (build passes, site returns 200)
- Captured 1440x2296 full-page screenshot via Playwright
- Fixed make_submission_zip.sh (mkdir for zip output path), created submission bundle (52MB)
- Two commits pushed: 1f21227 (main changes) + 892021d (screenshot + zip fix)

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
