# Session Summaries

## 2026-02-23T12:00Z — Session 28: Full Code Review + ARCHITECTURE.md
- Implemented 4 enterprise blocker features in previous session: Event Pipeline Wiring, Voice/Phone Channel, PWA/Mobile, Sandbox Environments
- Fixed 17 code review issues: path traversal in sandbox (CRITICAL), IVR config validation, escapeXml dedup, push.ts global singleton, voice-store load timing, service worker API caching removed, etc.
- All 326 tests passing (+2 new: path traversal, transfer fallback), typecheck clean
- Deployed to cliaas.com via deploy_vps.sh
- Full code review via 5 parallel explore agents (frontend, API routes, lib, CLI/MCP, infra)
- **Code review findings**: 314 TS files, 47,600 LOC, 53 DB tables, 101 API routes, 29 pages, 10 connectors
- Created ARCHITECTURE.md documenting full system architecture
- Top refactoring priorities: auth middleware (88% routes unprotected), unsafe JSON parsing (52 routes), connector dedup (4,700 LOC), test coverage gaps (CLI commands untested)

## 2026-02-24T09:00Z — Session 27: Real RA Audio Playback Implementation
- Wrote Westwood IMA ADPCM decoder (audDecoder.ts): parses AUD headers, decodes chunked 4-bit IMA ADPCM, converts to Web Audio AudioBuffer
- Created build-time extraction script (scripts/extract-ra-audio.ts): extracts AUDs from SOUNDS.MIX + SPEECH.MIX + Aftermath expansion, decodes to WAV
- 42 sound effects extracted: weapons (rifle, cannon, tesla, mandible), explosions, ant sounds, EVA voice lines, unit acks, victory/defeat
- Updated AudioManager: loadSamples() fetches WAVs at runtime, play() tries samples first then synth fallback
- Non-breaking: all existing synthesis kept intact as fallback; game works identically without extracted audio
- Added /public/ra/audio/ to .gitignore (generated binary files)
- Sources: SOUNDS.MIX (23 SFX), SPEECH.MIX (16 EVA voices), Aftermath (ANTBITE, ANTDIE, BUZZY1, TANK01, STAVCMDR/STAVCRSE/STAVMOV/STAVYES)

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
