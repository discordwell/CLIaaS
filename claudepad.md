# Session Summaries

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

### BUG 1 — CRITICAL: Mission timer ticks 15x too slow
- `index.ts` ~line 2590: `this.missionTimer--` inside `processTriggers()` which runs every 15 ticks
- Timer is SET in game ticks (`result.setTimer * TIME_UNIT_TICKS`) but decremented by 1 per 15 ticks
- **Fix:** Change `this.missionTimer--` to `this.missionTimer -= 15`

### BUG 2 — HIGH: enemyUnitsAlive counts neutral civilians as enemies
- `index.ts` ~line 3296: `if (e.alive && !e.isPlayerUnit && !e.isCivilian) enemyUnitsAlive++`
- Wait — this line ALREADY excludes civilians with `!e.isCivilian`. Need to verify if there's a SECOND count elsewhere.
- Check line ~2575 in updateHunt for a separate count that may NOT exclude civilians.

### BUG 3 — MEDIUM: AREA_GUARD doesn't clear target/targetStructure on retreat
- `index.ts` ~line 2712: sets `mission=MOVE, moveTarget=origin` but doesn't clear `entity.target` or `entity.targetStructure`
- **Fix:** Add `entity.target = null; entity.targetStructure = null;` before line 2712

### BUG 4 — MEDIUM: Artillery minRange not enforced vs structures
- `updateAttackStructure()` at ~line 2739 has no minRange check
- **Fix:** Add minRange check similar to updateAttack entity version

### BUG 5 — LOW: HUNT pathfinding global recalc causes lag spike
- `index.ts` ~line 2557: `this.tick % 15 === 0` recalcs ALL hunting units on same tick
- **Fix:** Change to `(this.tick + entity.id) % 15 === 0` to stagger

### BUG 6 — LOW: Team GUARD/IDLE duration decrements by hardcoded 8
- `index.ts` ~line 1844: `entity.teamMissionWaiting -= 8` instead of actual elapsed ticks
- Minor timing inaccuracy, not critical

### FALSE POSITIVES from code reviews (DO NOT FIX):
- hasTurret missing TRAN/LST: WRONG — entity.ts line 175 already excludes both
- Dead loop in civilian evacuation: Need to verify — line 376-378 area
- BUILDING_TYPES ordering: Already validated in session 21 against RA source
- Semi-persistent trigger playerEntered not reset: Check if this actually matters — triggers with persistence=1 skip when `trigger.fired && persistence <= 1` (line 3307), so playerEntered flag is irrelevant after firing
- Duplicate TMISSION constants: True but harmless, not a bug
- Cell trigger per-unit activation: This IS correct behavior — each unit should independently trigger cell triggers

### UNVERIFIED (check before fixing):
- Civilian flee target can be out-of-bounds (line 1352-1363): Minor, findPath handles it
- structureTypes in trigger state doesn't distinguish houses: Check if ant scenarios need house-specific building checks
- TEVENT_DESTROYED only tracks structures not units: Check if any ant scenario attaches triggers to units

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
