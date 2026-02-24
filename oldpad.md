# Archived Session Summaries

## 2026-02-24T07:45Z — Session 26: Bug Fixes + RA Soundtrack Implementation
- Resolved all 6 bugs from Session 25 audit: Bug 5 fixed (HUNT pathfinding stagger), Bugs 1/3/4 already fixed in uncommitted diff, Bugs 2/6 verified as non-bugs
- Committed 9195b3d: bug audit fixes (pathfinding lag, AREA_GUARD cleanup, artillery vs structures)
- Downloaded Red Alert soundtrack from Internet Archive (Frank Klepacki, 1996, CC BY-NC-ND 4.0)
- 15 MP3 tracks, 122MB total, stored in public/ra/music/ (gitignored)
- Created download script: scripts/download-ra-music.sh
- Implemented MusicPlayer class in audio.ts: HTML5 Audio streaming, shuffled playlist, crossfade, probe-with-deferred-play
- Integrated into game lifecycle: auto-start, pause/resume, stop on win/lose, N key skip
- Track name HUD display: bottom-right, fades after 4s, AUDIO section in F1 help
- Code reviewed and fixed: crossfade memory leak, probe race condition, volume/mute sync for fading track
- Committed d9e1f85, pushed
- **TODO**: Music files need to be on VPS for live site (run download-ra-music.sh on server)

## 2026-02-24T02:00Z — Session 25: Transport Fix + Bug Audit (INTERRUPTED — bugs queued)
- Committed f506c8a: Fix transport passenger lifecycle (passengers vanished after 3s because alive=false + entity cleanup)
- Ran 2 independent code reviews + 2 audits, cross-referenced findings
- **VERIFIED REAL BUGS still needing fixes (prioritized):**
- BUG 1 — CRITICAL: Mission timer ticks 15x too slow (fix: `missionTimer -= 15`)
- BUG 2 — HIGH: enemyUnitsAlive may count civilians (needs verification)
- BUG 3 — MEDIUM: AREA_GUARD doesn't clear target on retreat
- BUG 4 — MEDIUM: Artillery minRange not enforced vs structures
- BUG 5 — LOW: HUNT pathfinding global recalc causes lag spike (fix: stagger with entity.id)
- BUG 6 — LOW: Team GUARD/IDLE duration decrements by hardcoded 8
- FALSE POSITIVES: hasTurret TRAN/LST (already excluded), BUILDING_TYPES ordering (validated), cell trigger per-unit (correct behavior)

## 2026-02-23T05:30Z — Session 24: CLIaaS Migration & Live Testing
- Built migrate command: `pnpm cliaas migrate --from <dir> --to <connector>` with crash recovery maps
- Added 4 new connectors: Intercom, Help Scout, Zoho Desk, HubSpot (export + write + verify)
- Live-tested migration against 4 platforms: Zendesk (30/30), Freshdesk (30/30), Groove (30/30), Intercom (30/30)
- Added `--cleanup` flag to reverse migrations (delete migrated tickets from target)
- Fixed Intercom: `type:"user"` not `type:"contact"`, `conversation_id` response field, contact auto-resolution
- Fixed 204 No Content handling in Zendesk/Freshdesk/Intercom fetch wrappers
- Intercom delete needs `Intercom-Version: Unstable`; added apiVersion option to intercomFetch
- Freshdesk free plan blocks API DELETE; Groove has no delete API
- Saved all connector credentials to .env (Zendesk, Freshdesk, Groove, HelpCrunch, Intercom)
- 4 commits pushed, all type check clean

## 2026-02-24T00:00Z — Session 23: Visual Fidelity & Combat Polish — Turrets, Retaliation, Audio, Pathfinding
- GUN/SAM structure turret rotation: 8-dir facing toward targets, BODY_SHAPE frame selection
- GUN: 128-frame layout (32 rotation x 2 fire x 2 damage), firingFlash muzzle effect
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
- TMISSION_GUARD -> AREA_GUARD with guardOrigin (bridge guard ants don't chase infinitely)
- GuardRange from INI: limits how far guard units chase, used in updateGuard scan
- IsSuicide team flag (bit 1): teams fight to death with HUNT mission
- Trigger house field (f[1]) stored in ScenarioTrigger
- TACTION_TIMER_EXTEND (25) and TACTION_AUTOCREATE (13) handlers
- [General] SilverCrate/WoodCrate overrides: armor (+2x HP) and firepower (elite) crate types
- Artillery minRange (2 cells): retreat from point-blank, clamped to map bounds
- ALLOWWIN gate: fallback "all ants dead" win requires allowWin flag when scenario uses it
- Difficulty waveSize multiplier applied to queen spawn count (easy=0.7x, hard=1.3x)
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
- Fixed 9 code review bugs: harvester, structure footprints, sell mode, sidebar scroll, etc.
- Added QUEE (Queen Ant) structure, LAR1/LAR2 (Larvae), GNRL (Stavros), TRUK (Supply Truck)
- Updated victory condition: must destroy all QUEE/LAR1/LAR2 + kill all ants

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

## 2026-02-23T09:00Z — Session 15: Base Defense, Sell/Repair, EVA, Polish
- Added artillery scatter/inaccuracy — weapons with inaccuracy field scatter impact point randomly
- Inaccuracy set on Grenade (0.5) and ArtilleryShell (1.5); projectiles travel to scattered point
- Added dog anti-infantry targeting priority — dogs prefer infantry over vehicles in guard scan
- Improved guard scan: all units now pick closest enemy (was first-in-list)
- Added LOS check in updateAttack — units can't fire through walls, move to get clear shot
- Added structure health bars on damaged buildings (visible cells only)
- Expanded unit info panel: weapon name, range, armor class for single selection
- Added sell mode (Q key) — sells player structures, spawns rifleman, with cursor/label indicator
- Added repair mode (R key) — toggles repair on damaged structures (1 HP/tick), pulsing green border
- Added defensive structure auto-fire: HBOX, PBOX, GUN, TSLA, SAM, AGUN, FTUR attack nearby enemies
- Structure weapons defined in STRUCTURE_WEAPONS lookup with damage, range, rof, splash
- Tesla coils get special tesla zap effect; other structures fire bullet projectiles
- Structure weapons now apply warhead-vs-armor multipliers (code review fix)
- Added EVA announcements: eva_unit_lost (3-note descending), eva_base_attack (4-note alarm)
- Base attack EVA throttled to once per 5 seconds to prevent spam
- Imported House, UnitType enums into index.ts for proper type usage
- Code review found 1 critical bug (structure weapons ignoring armor), fixed
- Added engineer (E6) building capture — enter hostile structure to convert to player
- Added force-fire on ground (Ctrl+RMB) — artillery fires at ground position using splash/inaccuracy
- Added shift+RMB waypoint queue — queue moves for patrol routes
- Added X key scatter — selected units move to random nearby positions
- Added Home/Space to center camera on selected units
- Added G key as guard position shortcut (same as S/stop)
- Added F1 help overlay with all keyboard shortcuts
- Added +/-/M volume controls
- Added structures to minimap (white=player, red=enemy)
- Added shiftHeld tracking to input system; forceFirePos and moveQueue to Entity
- 3 commits pushed: fdb3ee7, 91a14f6, 62bdfc0
- All changes type check clean (npx tsc --noEmit)

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
- Code review found 6 critical bugs, all fixed
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

## 2026-02-22T21:30Z — Session 10: Phase 3 Polish — Briefings, Progression, Performance
- Mission select screen with 4 unlockable missions, briefing screen, win/lose overlays, localStorage progress
- Performance: fog of war O(visible), pathfinding node reuse, removed dead animFrameId
- Committed b2d85e3

## 2026-02-22T20:00Z — Session 9: Bug Fixes & Visual Fidelity
- Fixed 3 critical bugs: RAF throttling, edge scroll drift, input event ordering
- Added fog of war, procedural terrain, particle effects, death fade, selection circles
- Improved health bars, unit info panel, fog-aware minimap
- Rate-limited AI scanning, pathfinding swap-and-pop optimization
- Committed 88b515a

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
