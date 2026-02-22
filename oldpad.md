# Archived Session Summaries

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
