# Session Summaries

## 2026-02-23T17:15Z — Session 20: Area Guard, Service Depot, Production Queue, Radar, Crates
- Implemented Area Guard mission: patrol/defend spawn area, attack nearby enemies, return if >8 cells from origin
- Added `applyMission()` INI mission string parser (Guard/Area Guard/Hunt/Sleep)
- Added `idleMission()` helper: all GUARD idle transitions respect guardOrigin
- Service Depot (FIX building) auto-repair: heals nearby vehicles 2 HP/3 ticks with spark effect
- Production queue: queue up to 5 of same item per category, right-click cancels one from queue
- Radar requirement: DOME building required for minimap, shows cached static noise without it
- Mission carry-over: localStorage save/load surviving units between missions (ToCarryOver/ToInherit INI flags)
- Carry-over units spawn with passability check (code review fix: prevents stuck in walls)
- Crate drops: money/heal/veterancy/unit bonuses, spawn every 60-90s, max 3 on map, 3min expiry
- E key: select all units of same type on entire map
- Area Guard ants now engage enemies while returning home (code review fix)
- Idle cycle (period key) includes AREA_GUARD player units (code review fix)
- Radar static noise performance fix: cached Uint8Array, updates every 10 frames (code review fix)
- All changes type check clean (npx tsc --noEmit)

## 2026-02-23T16:00Z — Session 19: Bug Fixes, Queen Ant, Larvae, GNRL
- Fixed 9 code review bugs: harvester returning re-entrancy (double GUARD check), structure footprints using STRUCTURE_SIZE instead of hardcoded 2x2, sell mode now refunds 50% credits and clears terrain, destroyed structures clear footprint to passable, findStructureAt uses actual footprint, sidebar scroll clamped to max, cached getAvailableItems per tick, harvesters skip guard auto-attack (would chase forever with no weapon)
- Added QUEE (Queen Ant) structure: 800 HP, TeslaZap weapon, self-healing +1 HP/2 ticks, 2x2 footprint
- Added LAR1 (Larva, 25 HP) and LAR2 (Larvae, 50 HP) structures: 1x1 footprint
- Added GNRL (Stavros) infantry: Sniper weapon (125 dmg, range 5, Super warhead), uses E1 sprite
- Added TRUK (Supply Truck) vehicle type for SCA02EA scenario
- Added Sniper weapon to WEAPON_STATS
- Updated victory condition: must destroy all QUEE/LAR1/LAR2 structures + kill all ants
- Fixed house mapping: France→USSR (enemy), England→Greece (allied), Turkey→Neutral
- Structure maxHp now type-specific: QUEE=800, LAR1=25, LAR2=50, TSLA=500
- Imported Terrain enum in index.ts; replaced magic number 4 with Terrain.WALL
- Replaced hardcoded 128 with MAP_CELLS in map.ts and index.ts
- All changes type check clean (npx tsc --noEmit)

## 2026-02-23T14:00Z — Session 18: Economy, Production, Sidebar, Building Placement
- Implemented full RTS economy system: harvester AI state machine (idle→seeking→harvesting→returning→unloading)
- Added ore/gem depletion: map.depleteOre() reduces overlay levels, returns credits (25/ore, 50/gem)
- Added map.findNearestOre() helper for harvester pathfinding
- Implemented production queue: one active build per category (infantry/vehicle/structure)
- ProductionItem data: 22 items (7 infantry, 7 vehicles, 8 structures) with costs/buildTimes/prerequisites
- Sidebar UI: credits display, scrollable production buttons with category colors, build progress bars
- Mouse wheel scrolling for sidebar when cursor over sidebar area
- Building placement system: ghost preview (green/red), adjacency validation, click to place
- MCV deployment: D key converts MCV to FACT (Construction Yard) structure
- Escape key now cancels modes (placement→attack-move→sell→repair) before pausing
- Right-click cancels placement with refund; right-click on sidebar cancels production
- Minimap moved to bottom of sidebar; idle count moved into sidebar area
- Terrain/fog rendering optimized to camera viewport width (not full canvas)
- PROC (refinery) placement spawns a free harvester
- Defensive structures (HBOX, GUN, etc.) get weapons when placed
- All changes type check clean (npx tsc --noEmit)

## 2026-02-23T12:00Z — Session 17: Ore Sparkle, Offscreen Indicators, Ambient, Tab Cycling
- Implemented ore/gem animated sparkle effects in overlay rendering
- Added off-screen selected unit indicators (arrow badges at screen edges)
- Added ambient wind noise (pink noise via Web Audio API)
- Added Tab key cycling through unit types in mixed selection (pool-based)
- Code review fixed 6 bugs: Tab cycling one-shot, Tab focus steal, corner double-count, ambient crossfade silence, ambient stop throw, idle count per-render-frame
- Commit: a5c8b77 — pushed to origin/main

## 2026-02-23T11:00Z — Session 16: Veterancy, Friendly Fire, Stances, Wave AI
- Added unit veterancy system: kills tracking, promotion at 3/6 kills, damage/HP bonuses (+25%/+50%)
- Veterancy stars rendered above health bars (silver=veteran, gold=elite)
- Veterancy + kills + stance shown in unit info panel
- Enabled friendly fire on splash damage (50% reduced), tracks as player losses
- Added stance system: Aggressive/Defensive/Hold Fire (Z key to cycle)
  - Hold fire: never auto-engage; Defensive: weapon range scan only, no pursuit
- Added gradual turret rotation (2 steps/tick via tickTurretRotation)
- Added ant wave coordination: waveId + rally delay, wave-mates cluster then attack together
- Added ant building targeting priority: ants target defensive structures when no units visible
- Added vehicle crush mechanic: non-infantry vehicles kill enemy infantry in same cell
- Added waypoint markers: dashed green lines + dots showing shift+click queue
- Added destroyed structure rubble: persistent debris tiles at destruction site
- Added unit-type selection sounds: select_infantry, select_vehicle, select_dog
- Improved pathfinding: soft occupancy costs (+20 penalty) instead of hard blocking
- Code review fixed 6 issues: S key not consumed, turret fires while rotating, EVA skipped on enemy splash kill, defensive stance stale forceFirePos, DEFENSE_TYPES allocation, orphaned JSDoc
- All changes type check clean (npx tsc --noEmit)


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
