# Archived Session Summaries

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

## 2026-02-23T12:00Z — Session 28: Full Code Review + ARCHITECTURE.md
- Implemented 4 enterprise blocker features: Event Pipeline Wiring, Voice/Phone Channel, PWA/Mobile, Sandbox Environments
- Fixed 17 code review issues: path traversal in sandbox (CRITICAL), IVR config validation, escapeXml dedup, etc.
- Full code review: 314 TS files, 47,600 LOC, 53 DB tables, 101 API routes, 29 pages, 10 connectors
- Created ARCHITECTURE.md documenting full system architecture

## 2026-02-24T09:00Z — Session 27: Real RA Audio Playback Implementation
- Wrote Westwood IMA ADPCM decoder, extracted 42 sound effects from MIX files
- Updated AudioManager with sample-first/synth-fallback pattern

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


