# Session Summaries

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
