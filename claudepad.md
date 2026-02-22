# Session Summaries

## 2026-02-23T07:00Z — Session 14: Combat Mechanics, LOS, Structure Damage
- Added Bresenham line-of-sight (LOS) to map.ts — vision/targeting blocked by walls/rocks
- Integrated LOS into fog of war reveal, guard scan, and ant AI targeting
- Added AOE splash damage system — explosive weapons deal falloff damage to nearby units
- Splash radius added to: FireballLauncher, MammothTusk, Bazooka, Grenade, Flamethrower, TeslaCannon, ArtilleryShell
- Made structures damageable and destroyable — right-click to attack buildings
- MapStructure now has maxHp, alive fields; destruction spawns explosion + scorch mark
- Added medic auto-heal — medics automatically heal nearby damaged friendly infantry
- Added infantry scatter on explosion — infantry near splash damage get pushed away
- Added death animation variety — die2 variant selected randomly (40% chance)
- Added terrain scorch marks/decals — persistent burn marks where units die
- Added audio: unit_lost notification, building_explode, heal sounds
- Fixed control group memory leak — prune dead entity IDs from groups
- Avoided circular dependency: entity.ts uses StructureRef interface instead of importing MapStructure
- All changes type check clean (npx tsc --noEmit)

## 2026-02-23T01:30Z — Session 13: 1:1 Fidelity Features + Critical Bug Fixes
- Continued implementing 1:1 RA ant mission features (Tasks #17-32)
- Fixed screen shake save/restore mismatch bug in renderer
- Added NoMovingFire flag (ants, artillery must face target before firing)
- Added gradual rotation via tickRotation() with per-unit rot speed stat
- Added infantry sub-cell rendering (5 positions per cell: center + 4 corners)
- Added vehicle turret rendering (separate body/turret sprite layers, turret tracks target)
- Added victory/defeat screen with stats (time, kills, losses)
- Added custom cursor states (crosshair for attack, pointer for move, not-allowed for impassable)
- Added building damage states and idle animations
- Added command markers (green/red/yellow rings at move/attack destinations)
- Added OverlayPack decoding for ore/gem/wall rendering on map
- Added pause toggle (P/Escape) with pause overlay
- Added shroud edge blending (soft transitions between shroud and revealed)
- Fixed Escape key conflict between React UI and game engine pause
- Added attack-move visual indicator ("A" crosshair near cursor)
- Added path recalculation when blocked (with cooldown to prevent A* spam)
- Added idle animation variety (per-unit random fidget delay)
- Added voice acknowledgment pitch variety (randomized blip frequencies)
- Code review found 6 critical bugs, all fixed:
  1. Turret/desired facing not initialized from scenario data
  2. TMISSION_GUARD duration 8x too long (scan rate vs tick rate)
  3. HUNT mode walked through walls (now uses pathfinding)
  4. noMovingFire was dead code (now enforces facing before attack)
  5. Attack-move units didn't resume move after killing target
  6. Path recalc hammered A* every tick (added 5-tick cooldown)
- Also fixed: cellInfCount Map allocation GC pressure (reused class field)

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
