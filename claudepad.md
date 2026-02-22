# Session Summaries

## 2026-02-24T00:00Z — Session 23: Visual Fidelity & Combat Polish — Turrets, Retaliation, Audio, Pathfinding
- GUN/SAM structure turret rotation: 8-dir facing toward targets, BODY_SHAPE frame selection
- GUN: 128-frame layout (32 rotation × 2 fire × 2 damage), firingFlash muzzle effect
- SAM: 68-frame layout (34 normal + 34 damaged), turret tracks targets
- Vehicle death animation fix: freeze at body frame instead of showing turret frames
- Unit retaliation: idle/unengaged enemies counter-attack when shot (triggerRetaliation)
- Infantry scatter: 40% chance to dodge away from direct bullet hits (scatterInfantry)
- Splash damage retaliation: units hit by AOE retarget the attacker
- 3 missing audio synths: eva_reinforcements, eva_mission_warning, tesla_charge
- Napalm/Sniper weapon sound/projectile/muzzle color mappings
- Weapon-aware ant effects: ANT3 shows fire burst with Napalm (not hardcoded tesla)
- Water crate override wired up in spawnCrate (was dead code)
- Terrain-aware pathfinding: roads cost less, trees cost more (A* speed multiplier)
- Structure explosion damage: 2-cell blast radius ~100 damage when buildings destroyed
- 5 commits pushed, all type check clean, code reviewed

## 2026-02-23T21:15Z — Session 22: 1:1 Fidelity Batch — Stat Overrides, Trigger Polish, Combat Fixes
- Per-scenario stat overrides from INI: scenarioUnitStats, scenarioWeaponStats, warheadOverrides
- CHAN infantry type (was incorrectly mapped to V_TRAN helicopter), Napalm weapon
- TSLA ammo system (-1=unlimited, N=remaining shots, checked in structure combat)
- TMISSION_GUARD → AREA_GUARD with guardOrigin (bridge guard ants don't chase infinitely)
- GuardRange from INI: limits how far guard units chase, used in updateGuard scan
- IsSuicide team flag (bit 1): teams fight to death with HUNT mission
- Trigger house field (f[1]) stored in ScenarioTrigger
- TACTION_TIMER_EXTEND (25) and TACTION_AUTOCREATE (13) handlers
- [General] SilverCrate/WoodCrate overrides: armor (+2× HP) and firepower (elite) crate types
- Artillery minRange (2 cells): retreat from point-blank, clamped to map bounds
- ALLOWWIN gate: fallback "all ants dead" win requires allowWin flag when scenario uses it
- Difficulty waveSize multiplier applied to queen spawn count (easy=0.7×, hard=1.3×)
- Queen-spawned ants get per-scenario stat overrides (fixes SCA04EA ANT1/ANT3 stats)
- Critical bugfix: worldDist returns cells but minRange comparison multiplied by CELL_SIZE
- 6 commits pushed, all type check clean, code reviewed

## 2026-02-22T18:00Z — Session 21: Trigger System, Civilians, Bridges, Evacuation
- Expanded trigger event/action system: 11 new events, 13 new actions (from EA open-source RA enums)
- Added TriggerGameState + TriggerActionResult interfaces for clean event/action separation
- Added SLEEP mission handler, Queen Ant periodic spawning (every 30s, max 20 nearby ants)
- Added EVA text message system with mission timer display (countdown + fading messages)
- Fixed code review issues: trigger bounds checks, TIME_UNIT_TICKS constant dedup, House enum consistency
- Added BUILDING_EXISTS event that checks specific building type via event.data index mapping
- Added civilian unit types C1-C10 (infantry, no weapon, use E1 sprite)
- Added transport types: TRAN (Chinook), LST (landing ship), CHAN alias
- Implemented TEVENT_LEAVES_MAP — tracks units leaving map boundaries for civilian evacuation
- Added bridge structure support: BARL/BRL3 types, destroyBridge() converts bridge terrain to water
- Added bridge cell counting: map.countBridgeCells(), tracked in index.ts bridgeCellCount
- Added trigger attachment system: structures carry triggerName from INI, TEVENT_DESTROYED fires when attached structure destroyed
- Added TACTION_DESTROY_OBJECT: kills triggering unit (hazard zones in SCA02EA)
- Added civilian panic AI: flee from nearby ants (6-cell detect range, 4-cell flee distance)
- Fixed team mission constants: corrected TMISSION enum numbering from RA TEAMTYPE.H
- Added new team missions: TMISSION_PATROL (move + attack en route), TMISSION_WAIT (idle timer)
- Fixed cell trigger persistence: per-entity tracking, persistent triggers reset on re-entry
- All changes type check clean (npx tsc --noEmit)

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
