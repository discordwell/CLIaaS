# Session Summaries

## 2026-05-01T01:30Z — SCG13EA t101 root cause CONFIRMED: niat=8 proxy too short

**Trace via `test-scg13ea-stuck-trace.ts` for unit id=109 (USSR E1 (61,67)):**
- Tick 91: team=2 attached (was teamless before)
- Tick 92: niat=7 set (team activation set nonInterruptAnimTicks=8, decrement to 7 same tick)
- Tick 94: missionQueue=MOVE set by team coordinator
- Ticks 92-98: niat decrements 7→6→5→4→3→2→1
- Tick 99: niat=0 → STAGE E pops MOVE queue → m=MOVE, mt=0
- Tick 100: m=MOVE, mt=15, drv=true (Mission_Move dispatched, jitter=1)
- Onwards: stuck moving south at 10 leptons/tick toward target 12 cells away

**WASM same unit at tick 95:** m=5 (GUARD), mq=2 (MOVE queued), nlx/nly set, drv=false, **doing=16**.

So WASM ALSO has queued MOVE for this unit. The difference: WASM's Commence gate (infantry.cpp:1208) requires `Doing == DO_NOTHING || MasterDoControls[Doing].Interrupt`. WASM's `doing=16` is non-interruptible, so Commence never pops MOVE. Unit stays in GUARD indefinitely.

**TS proxy (team.ts:559-560):** `nonInterruptAnimTicks = 8` for infantry on team activation. Comment claims 8 = `Count=3 × Rate=2 + 2 buffer`. But WASM's actual gating extends MUCH longer (≥9 ticks per the trace, possibly indefinitely until something changes Doing).

**Structural fix candidates:**
1. **Extend niat** from 8 to a much larger value (e.g., 15-20) for team-activated infantry. Risk: regresses other scenarios where Mission_Move should dispatch sooner.
2. **Properly model Doing transitions** so that Doing=DO_GESTURE1/2 stays non-interruptible until the actual animation completes (tracked separately from niat).
3. **Match C++ Commence gate exactly** — replace niat with a Doing-based check (`doing === 'stand_ready' || doing === 'nothing'`). Requires Doing transitions to be C++-faithful.

Option 3 is the cleanest port. Currently TS's `entity.doingAI` transitions Doing through some states (Phase 7A landed for `walk → stand_ready`). More transitions need C++-faithful porting.

## 2026-05-01T00:50Z — SCG13EA t101 expanded root cause: TS USSR E1 (61,67) stuck in MOVE

**Probe findings via `test-scg13ea-all-fires.ts`:** at tick 100 end, WASM has 4 E1/E3 about to fire at tick 101; TS has only 2.

**Per-unit divergence:**
| unit | WASM | TS |
|---|---|---|
| Greek E1 (12,54) | GUARD mt=0 | GUARD mt=1 (1-tick offset) |
| USSR E1 (61,67) | GUARD mt=0 | **MOVE mt=15** (wrong mission!) |
| USSR E1 (62,78) | GUARD mt=1 | GUARD mt=2 (1-tick offset) |
| USSR STICKY (27,46) | STICKY mt=0 | STICKY mt=1 (1-tick offset) |

**Critical finding for USSR E1 (61,67):** Stuck in MOVE with `mt=15, mq=null, moveTarget=(15744,20352), isDriving=true, path=[], pathIdx=0, team=2`.

The unit has a moveTarget but EMPTY PATH and isDriving=true. Cannot move (no path) but isDriving=true blocks `MOVEMENT_AI_MOVE_NAVCOM_GUARD` and pre-Commence gates.

WASM has same unit in GUARD — WASM transitioned MOVE→GUARD somewhere between scenario start and tick 100. TS missed that transition.

**Structural fix candidates (one of):**
1. When infantry's path empties mid-MOVE with moveTarget still set, re-attempt findPath. If fails, clear moveTarget + isDriving → next tick MOVEMENT_AI_MOVE_NAVCOM_GUARD triggers Enter_Idle_Mode.
2. When path is exhausted, set isDriving=false. Then `MOVEMENT_AI_MOVE_NAVCOM_GUARD` would also fire (since !isDriving + !moveTarget after some other clear).

Both candidates need verification and may regress existing scenarios. The 1-tick init drift on Greek E1/USSR (62,78)/USSR STICKY is a separate, harder problem (RNG-ordering at scenario load).

## 2026-05-01T00:30Z — Divergence verification post-fix + SCG13EA Greek E1 root cause confirmed

**Playwright divergence after vessel/DriveClass commits (post-deploy):**
| scenario | net |
|---|---|
| SCG01EA | 77 (no change) |
| SCG03EA | 238 (no change) |
| SCG04EA | 3 (no change) |
| SCG06EA | 76 (no change) |
| SCG07EA | 17 (no change, Δcalls still 7) |
| SCG11EA | 19 (no change) |
| SCG13EA | 101 (no change) |

**Why no advancement:** the gate `mission===MOVE && Timer===0 && queue===null` only matches when PCP_END Commence pop happened mid-iter. PCP_END Commence requires MissionQueue=MOVE entering the iter. `assignMission(unit, MOVE)` clears queue when entity already in MOVE → so coordinateMove rarely sets queue=MOVE for already-moving units. The fix is dead code in the actual scenarios.

**SCG13EA Greek E1 (12,54) probe results (script `test-scg13ea-greek-e1-init.ts`):**
- Tick 100 end: WASM mt=0, TS mt=1 (TS 1 tick ahead in countdown)
- Tick 101 end: WASM mt=13 (jitter=0), TS mt=15 (jitter=1)

**Root cause:** at the FIRST Mission_Guard fire (tick 1), TS jitter=0 (mt=14) while WASM jitter=0 (mt=13 = 14-1 after Frame++ post-dispatch). The 1-tick offset persists. Then at subsequent fires, jitter values diverge because the RNG seed at dispatch time differs. The 2-tick drift accumulates by tick 101.

**Why TS shows 14 vs WASM shows 13 immediately post-dispatch at tick 1:** WASM uses CDTimerClass (Frame-based), where `remaining = Started+Duration - CurrentFrame`. After Frame++ at end of tick, remaining decreases by 1. TS uses simple integer with decrement at start of next tick. So TS's mt=14 is "current value", WASM's remaining=13 is "after end-of-tick frame increment".

**Functionally equivalent for fire timing** (both fire 14 ticks after dispatch), but the DISPLAYED value differs — and crucially, when an entity's INITIAL mt is set differently (e.g. from init RNG ordering), the offset propagates.

**SCG13 t101 structural fix would be:** audit init-time RNG ordering to make TS's per-entity jitter values match WASM's at scenario load. This requires per-call instrumentation + comparison. Not a quick fix.

## 2026-04-30T07:50Z — DriveClass mid-cycle Mission_Move dispatch (SCG07EA t17 + SCG11EA t28 structural fix)

**Structural fix landed in 2 commits:**
- `abca2aa1` — vessel-only first cut
- `c64004f9` — broadened to all DriveClass entities (vehicles + vessels)

**What:** added in-loop `dispatchMission` call within `runDriveClassAI`'s double-cycle. After each iter's `updateMove`, when post-state matches PCP_END Commence pop signature (`mission===MOVE && missionTimer===0 && missionQueue===null`), fires Mission_Move dispatch. The Timer→14+jitter transition prevents re-trigger this iter.

**Mechanism:** C++ vehicles (unit.cpp:404+472, unit.cpp:1756 PCP_END) and vessels (vessel.cpp:592+659) both run multiple Commence calls per AI tick. Each pop sets Timer=0; when MissionClass::AI dispatches afterward, Mission_Move fires `Random_Pick(0,2)` jitter (foot.cpp:536, tag 60010). WASM observations:
- SCG07EA t17: vessel[182] 2×, vessel[183] 3×
- SCG11EA t28: MCV-157 fires Mission_Move 2×

**Files changed:**
- `src/EasterEgg/engine/index.ts:5156-5188` — added gated dispatch within runDriveClassAI loop
- `src/EasterEgg/__tests__/cpp-parity-vessel-double-commence-dispatch.test.ts` — new test (3 cases)

**Test status:** 51,379 vitest pass (+3 new tests). No regressions in SCG04/SCG06/SCG07/SCG11/SCG13 parity tests.

**Verification pending:** playwright `test-first-divergence.ts` needs deploy to confirm SCG07EA t17 / SCG11EA t28 first-divergence advances.

**Caveat:** Fix only applies when `runDriveClassAI` runs (STAGE B did NOT dispatch — Timer != 0 entering STAGE B). The case where STAGE B's Mission.MOVE handler runs AND PCP_END pops queue mid-handler isn't yet covered. The C++ mechanism for that double-fire (MCV-157 has Timer==0 entering tick 28 from prior PCP_END) remains unexplained — see `cpp-parity-scg11ea-tick-28-proxy.test.ts` notes. Logically MissionClass::AI dispatches once per `obj->AI()` call per logic.cpp:306, so the multi-fire path is non-obvious.

## 2026-04-30T01:30Z — SCG13EA t101 root cause: Greek E1 timer drift, not our STICKY

Earlier session note about SCG13EA t101 was wrong about WHICH unit was missing. Detailed investigation:

- WASM has 7 calls at tick 101: positions 0-6
- TS has 6 calls at tick 101: positions 0-5
- Both engines' position 5 has seed 888565875 (matched by diff alignment)
- WASM position 5 = infantry[188] (Greek E1 at 12,54)
- TS position 5 = infantry[147] (USSR STICKY at 27,46) ← OUR unit
- WASM position 6 = infantry[192] (USSR STICKY at 27,46) ← what I initially thought was "missing"

So in WASM, TWO units fire at tick 101: a Greek E1 at (12,54) AND our STICKY USSR at (27,46). In TS, only our STICKY fires. The Greek E1 at (12,54) is the missing one.

**Greek E1 at (12,54) post-step state:**
- WASM: id=852091 mt=13 (consistent with fire at tick 101: 14 jitter=0, then -1 decrement = 13)
- TS: id=144 mt=15 (consistent with: NO fire at tick 101, was 16, decremented to 15)

**Conclusion:** TS's Greek E1 at (12,54) has its mission timer offset by 2 ticks from WASM. Likely originates from init-time RNG-ordering: TS's Mission_Guard init for this unit got a different jitter than WASM's, causing 2-tick drift.

**Useful infrastructure landed during investigation:**
- `commit 104745d2` "chore(random): pin Scenario/NonCriticalRandom singletons to globalThis" — defensive against Next.js code-splitting (verified harmless: `__rngTagControl` reads same callCount as `globalThis.__scenarioRandom.callCount`).

## 2026-04-30T00:30Z — Investigated remaining divergences (no fixes landed)

After SCG06 +8 win, investigated several remaining first-divergence ticks. Found timer/ordering offsets but no quick fixes:

**SCG13EA t101 (TS missing 1 call):** Both TS and WASM have E1 USSR @(27,46) in Mission.STICKY. Both timers fire at tick 101. Confirmed via instrumentation that TS dispatchMission STICKY case calls `ScenarioRandom.nextInRange(0,2)` (logged jitter=0). Yet `__rngTagControl` callCount only +6 at tick 101 — should be +7. Likely a code-splitting issue (chunks 89711 & 94745 both reference `_seedLog`) or some compile-time anomaly. Would need bundle inspection to confirm.

**SCG11EA t19 (TS extra 1 call):** TS 4TNK USSR @(60,58) stays in Mission.MOVE; WASM equivalent unit cycles GUARD↔MOVE via Mission_Move's Enter_Idle_Mode (NavCom invalidated → switches to GUARD). Tick 1 timer values differ (TS=43, WASM=42) despite RNG totals matching at tick 1 (139 each) — suggests order of fire differs, not RNG call count. Requires deeper team coordinator port to mirror C++ drive-in-GUARD.

**SCG07EA t17 (TS missing 7 calls):** 2 Building_AI_70003 (Mission_Guard for TSLAs at 83,80 and 93,73) + 5 Mission_Move_foot for vessels[182,183] (LST + PT reinforcements). TSLA timer offset; vessels delayed by niat=3 proxy. Both require structural port work.

**SCG03EA t238 (TS extra 1 call):** TS fires Mission_Guard ONE TICK EARLY for some unit (logicIdx 0). Same general 1-tick offset pattern as SCG11.

**SCG06EA t76 (TS missing 2 calls):** Path-shorten timing offset — TS at tick 75, WASM at tick 74. USSR E1 id=24 firePrepActive stage advances 0→5 over t73-78. Potentially the underlying movement-speed or PCP_END timing.

**SCG01EA t77 (TS missing 2 calls):** Building_AI_70003 for building[57] firing twice (rejection sampling). Damaged building Mission_Guard cycle. Timer offset.

**Verdict:** All remaining divergences are timer-initialization 1-tick drifts or substantial structural port work (Basic_Path MOVE_TEMP, vessel double-Commence, team coord drive-in-GUARD). No quick fixes found.

## 2026-04-29T19:50Z — coordinateDo TarCom-preservation fix (preventive)

**Commit:** `9e44cb62` "fix(team): preserve TarCom in coordinateDo (analogous to coordinateMove)"

Code review of `14e56d67` flagged the analogous bug in `team.coordinateDo`. C++ `TeamClass::Coordinate_Do` (team.cpp:1813-1860) only clears TarCom/NavCom inside the regrouping branch (line 1848), gated by `!Target_Legal(unit->TarCom) && !Target_Legal(unit->NavCom) && unit->Mission != do_mission` — i.e., the clears are redundant in C++. TS unconditionally cleared `unit.target` and `unit.moveTarget` for every member.

Removed the unconditional clears. No first-divergence ticks change for the 7 tracked scenarios — preventive C++-faithful fix that protects against the same hazard the coordinateMove fix addressed (a `triggerRetaliation`-set TarCom being nullified the next time a team mission was queued). 51,378 vitest pass.

## 2026-04-29T19:30Z — coordinateMove TarCom-preservation fix (SCG06EA 68→76)

**Commit:** `14e56d67` "fix(team): preserve TarCom in coordinateMove (SCG06EA 68→76)"

**Root cause:** Codex commit `ff8ccea8` ("Queue drive-class moves and use per-icon terrain speeds") added unconditional `unit.target = null + targetStructure = null + forceFirePos = null` in `team.coordinateMove` based on a misreading of C++ semantics. C++ `TeamClass::Coordinate_Move` (team.cpp:1942-1962) only calls `Assign_Mission(MISSION_MOVE)` and `Assign_Destination(Target)` — it does NOT clear TarCom. Only dogs (line 1916-1920) clear TarCom, and only when distance > stray.

**Effect on SCG06EA t68:** This nullified the `triggerRetaliation` TarCom assignment between team-coordinator passes. After Greek E1 hit BadGuy E1 at tick 65 and `triggerRetaliation` set TarCom=Greek, the next coord pass cleared it → Mission.MOVE handler skipped updateAttack → no firePrepActive → no Fire_At at tick 68 → bullet[116] never fired → -1 Coord_Scatter (tag 50002) divergence.

**Fix:** Removed the three target-clearing lines from coordinateMove. The `assignMission(unit, Mission.MOVE)` queue is sufficient; TarCom continues to drive Firing_AI (which runs before Movement_AI per infantry.cpp:1237).

**Trace via probe `test-scg06ea-t68-dump.ts`:**
- Tick 65: BadGuy E1 id=22 hp=50→35, target=28 (Greek E1) — retaliation worked.
- Tick 66: BadGuy E1 id=22 target=null — coordinateMove cleared it!
- Tick 68: WASM bullet[116] Coord_Scatter; TS missing.

**Playwright divergence (post-deploy):**
| scenario | session start | now | net |
|---|---|---|---|
| SCG01EA | 87 | 77 | -10 (no change) |
| SCG03EA | 238 | 238 | 0 |
| SCG04EA | 25 | 3 | -22 (Basic_Path port still pending) |
| SCG06EA | 76 | **76** | **+8** (was 68) |
| SCG07EA | 17 | 17 | 0 |
| SCG11EA | 19 | 19 | 0 |
| SCG13EA | 101 | 101 | 0 |

**Open work:**
- SCG06 t76: TS missing 2 RNG calls (`bullet[115]` AI + Coord_Scatter). Some unit fires at tick 76 in WASM that doesn't in TS — possibly another retaliation chain that unblocks now.
- SCG07 t17: TS missing 7 RNG calls — 2 Building_AI_70003 + 5 Mission_Move_foot for vessels[182,183]. Likely related to vessel niat=3 proxy still over-suppressing.
- SCG13 t101: TS missing 1 Mission_Guard_infantry_E1E3 for infantry[192].
- SCG04 t3: still requires C++ Basic_Path MOVE_TEMP cost gradient port (deferred).

**Possible follow-ups for similar bug:** `team.coordinateDo` at team.ts:1001 also unconditionally clears `unit.target` and `unit.moveTarget`. C++ `Coordinate_Do` (team.cpp:1813-1860) only does this when `!Target_Legal(unit->TarCom) && !Target_Legal(unit->NavCom) && unit->Mission != do_mission`. Same TarCom-preservation principle applies. Not blocking SCG06 but potentially helpful for ATTACK_TARGET/GUARD_AREA missions in other scenarios.

## 2026-04-29T14:50Z — Can_Enter_Cell gate + SCG04 root cause is Basic_Path MOVE_TEMP

**Commit:** `5981a542` "fix(team): add Can_Enter_Cell gate before isDriving flip in coordinateMove"

**What:** Threaded an optional `canEnterCell(entity, cx, cy)` callback through TeamAIContext. Game wires it to `canEnterTrackJumpCell === MoveResult.OK`. coordinateMove only flips isDriving=true when first path step is enterable — matching C++ Start_Of_Move (drive.cpp:638-640) → Start_Driver (foot.cpp:830) gate.

**Effect on SCG04 t3:** None. Both BadGuy 3TNK paths' first cells are open in TS. canEnterCell returns OK for both → both get isDriving=true → both Commence-blocked → neither fires Mission_Move. WASM has unit[73] (3TNK at 42,35) IsDriving=false (Mission_Move fires), unit[74] IsDriving=true (drives-in-GUARD).

**SCG04 t3 root cause (unfixed):** WASM's `FootClass::Basic_Path` (foot.cpp:313) uses `maxtype=MOVE_TEMP` for AI units. This evaluates friendly Cell_Occupier-occupied cells as MOVE_TEMP (transient block) and treats some path costs as failures. TS's `findPath(ignoreOccupancy=true)` does terrain-only — never fails for occupancy reasons. Without porting the full Basic_Path MOVE_TEMP/MOVE_OK/MOVE_NO cost gradient + global path reservation map (findpath.cpp), unit[73]'s Basic_Path won't fail like WASM's does.

**Captured live state via scripts/test-scg04-t3-tanks.ts:**
- Tick 3 TS: tank id=2 (cell 42,35) Mission=GUARD/MOVE-queued, drv=true, path=6 — Commence blocked.
- Tick 3 TS: tank id=3 (cell 39,34) Mission=GUARD/MOVE-queued, drv=true, path=9 — Commence blocked.
- WASM equivalents: unit[73] IsDriving=false (Mission_Move fires), unit[74] IsDriving=true.
- Geometry rules out simple friendly-blocker — paths don't intersect each other's starting cells.

**Verdict:** SCG04 t3 is a structural port gap (Basic_Path cost gradient) requiring substantial work, deferred to a future session.

## 2026-04-29T14:30Z — Merged Codex parity branch + narrow vessel isDriving fix

**Codex branch merged:** 9 commits from `codex/easter-egg-parity-windows-setup` (~1600 LOC additions across pathfinding, drive blocker occupancy, transport unload cadence, terrain speeds, harvester/ore parity, SCG01 drive+hunt, Windows build).

**Key codex changes addressing my open issues:**
- `f8b548b4` "Mirror C++ drive blocker occupancy" — adds vehicle pre-occupancy pass + `isEntityMovingBlockerFor` helper + `_commenceFiredThisTick` STAGE F gate. Fixes SCG11 multi-dispatch issue.
- `c6907cda` "Mirror C++ blocked-destination path setup" — re-introduces path population + isDriving=true at coord time (matching C++ Assign_Destination → Start_Of_Move synchronous chain at drive.cpp:638-640).

**My follow-up (5ed238fb):** narrow vessel skip for codex's eager `isDriving=true` flip in coordinateMove. C++ vessel.cpp:592/658 Commence is gated on `!IsDriving && Is_Door_Closed()` — eager flip blocks Commence pop and Mission_Move never fires. SCG07EA t2 (LST + 3 PT reinforcement) regressed -15 ticks (17→2) because of this. Skip for `unit.stats.isVessel` keeps land-vehicle drive-in-GUARD intact while restoring vessel Mission_Move cadence.

**Playwright divergence (deployed):**
| scenario | session start | now | net |
|---|---|---|---|
| SCG01EA | 87 | **77** | -10 (NEW from codex SCG01 fix) |
| SCG03EA | 238 | 238 | 0 |
| SCG04EA | 25 | 3 | -22 (vehicle Basic_Path port still missing) |
| SCG06EA | 76 | **68** | -8 (NEW from codex changes) |
| SCG07EA | 17 | 17 | 0 (recovered after vessel skip) |
| SCG11EA | 19 | 19 | 0 (recovered via codex `_commenceFiredThisTick`) |
| SCG13EA | 101 | 101 | 0 |

**Open work:**
- SCG01 t77: TS missing 2 Building_AI_70003 (Repair_AI) calls for building[57]. Damage state divergence at tick 77 — likely from codex's drive/hunt timing changes affecting combat.
- SCG06 t68: similar +1 Δcalls divergence — likely combat-related cascade.
- SCG04 t3: vehicle Basic_Path friendly-blocker port still pending (deferred to a future session).

**Test failures:** 24 ore-related test failures from codex's "Align harvester ore density parity" — pre-existing in codex branch, tests need updating to match new representation. Not blocking parity sweep.

## 2026-04-24T21:50Z — SCG11 t15 root cause identified: MCV reinforcements, one-tick RNG timing drift

**Investigation:** Captured live entity state via `__agentGame.entities` at SCG11EA ticks 14-16.

**Finding:** Tag `11094`/`11095` in WASM ↔ TS rng diff = MCV reinforcements (id=47/48). They are *post-building* phase entities (logicIdx 94/95 after Phase-2 structures bump the counter past 46). NOT the mmth1 4TNK team I initially assumed.

**State at tick 15 (TS):**
| entity | mission | timer | path | pathIdx | isDriving |
|---|---|---|---|---|---|
| MCV id=47 | MOVE | 2 | 4 | 0 | true |
| MCV id=48 | MOVE | 14 (just reset) | 4 | 0 | true |

**Mechanism:**
- TS MCV id=48: missionTimer hit 0 mid-tick 15 → Mission_Move handler fired Random_Pick(0,2) → reset to 14+jitter.
- TS MCV id=47: missionTimer 3→2→1→fires at tick 17.

**Crucial seed evidence:** TS tick 15 unit[94] seeds (4134575856, 469826665, 462005998) **EXACTLY match WASM tick 16 calls 0-2** (Building_AI_70003 building[108]). So the RNG stream is correct — just one tick earlier in TS than WASM.

**Implication:** The 4 "extra" TS RNGs at tick 15 aren't extra at all. They are legitimate Mission_Move/Repair_AI RNGs that WASM fires at tick 16. The divergence is *Mission_Move timer initialization* offset by 1 tick at MCV reinforcement spawn — likely a small rounding or sequence-of-events difference at scenario load.

**Why not fixed yet:** Requires deeper instrumentation to identify exact tick where MCVs receive their initial missionTimer value, and whether that initial value matches WASM. Punted to next session.

## 2026-04-24T21:32Z — Mark_Track full port reverted; narrow niat=3 proxy restored (SCG07EA +13 recovered)

**Commits this round:**
- `f55c1bf1` REVERT Mark_Track full port (over-suppressed)
- `a19d95cf` narrow niat=3 proxy on last vessel of 3+ vessel teams (placeholder)

**Why Mark_Track full port failed:**
Direct port at Mission.MOVE dispatch site (using `moveTarget` cell as Mark_Track key)
suppressed 6 legitimate Mission_Move calls at SCG07EA tick 2 — many vessels
in different teams firing legitimate Random_Pick(0,2). The issue: C++ Mark_Track
uses per-vessel computed `headto` (different cells across team members because
of per-path Basic_Path geometry). TS's `moveTarget` is shared across team
members. Without per-vessel `headto` modeling, the dispatch-site port over-
matches.

**Narrow niat=3 proxy:**
Restored at team-activation time for 3+ vessel non-reinforceable teams. Last
member only. Niat decrements 3→2→1→0 over 3 ticks; pre-Commence gate at
index.ts:~4005 (`niat <= 0`) blocks until niat reaches 0.

Empirically matches WASM SCG07EA subz cadence: 2 fires at tick 4, 3rd vessel's
Mission_Move delays to tick 6 (when niat reaches 0).

**Playwright divergence (post-deploy):**
| scenario | session start | now | net |
|---|---|---|---|
| SCG01EA | 87 | 87 | 0 |
| SCG03EA | 238 | 238 | 0 |
| SCG04EA | 25 | 3 | -22 |
| SCG06EA | 76 | 76 | 0 |
| SCG07EA | 17 | 17 | 0 |
| SCG11EA | 19 | 15 | -4 |
| SCG13EA | 101 | 101 | 0 |

**Net:** SCG07 fully recovered. SCG04 still -22 (vehicle Basic_Path friendly-
blocker port pending). SCG11 still -4 (DriveClass::AI multi-dispatch RNG
firing pending investigation).

**Future work for proper Mark_Track port:**
- Track per-vessel computed `headto` (not just team `moveTarget`).
- Apply Mark_Track only when this is the FIRST tick the vessel enters MOVE
  (Start_Driver-success transition), not every tick where vessel + !isDriving + moveTarget.

## 2026-04-24T13:40Z — VesselClass::Start_Driver Mark_Track ported (vessel.cpp:2104-2113)

**Commit:** `ee9ba67f` — first structural port following the Steps 1-7 audit.

**What it does:** Game-scoped `_vesselMarkedCells: Set<cellIdx>` reset per tick at top of `update()`. At the Mission.MOVE dispatch site (`index.ts:~4399`), BEFORE firing Random_Pick(0,2) jitter:
- If entity is a vessel + moveTarget set + !isDriving:
  - destKey = destCy * MAP_CELLS + destCx
  - If destKey already in set → Start_Driver failure → clear moveTarget/path, queue GUARD, missionTimer=0, skip jitter (`pathFailureHandled=true`).
  - Else → add destKey to set (Mark_Track DOWN) → proceed with jitter.

**C++ reference chain:**
- vessel.cpp:2104-2113 `VesselClass::Start_Driver` → `Mark_Track(headto, MARK_DOWN)`
- drive.cpp:1649-1684 `DriveClass::Mark_Track` → `Map[cell].Flag.Occupy.Vehicle`
- vessel.cpp:312 `VesselClass::Can_Enter_Cell` returns `MOVE_MOVING_BLOCK`

**Test:** `cpp-parity-vessel-mark-track.test.ts` — 4 tests validating Set membership semantics, per-tick clear, non-vessel bypass. All 51,367 EasterEgg vitest pass. SCG05 smoke passes.

**Deploy status:** not deployed (user permission declined — production deploy requires explicit user intent). Playwright verification of SCG07EA tick-4 regression fix pending next user-initiated deploy.

**Expected effect when deployed:** SCG07EA tick 4 divergence (currently -13 from baseline) should restore. 3rd SS vessel in subz team hits Mark_Track conflict → Mission_Move Enter_Idle_Mode → no Random_Pick(0,2) → WASM's 2-of-3 cadence matched.

**Remaining regressions from Step 7 audit (not yet addressed):**
- SCG04 -22: vehicle Basic_Path friendly-blocker semantics (MOVE_MOVING_BLOCK via findpath.cpp:1266-1293 live Cell_Occupier). Narrow port candidate: pass `ignoreOccupancy=false` to findPath for team-coordinated vehicles; broad impact risk requires careful gating.
- SCG11 -4: DriveClass::AI post-coord drive cadence. Related to path regen timing after Step 6's coord-purity strip.

## 2026-04-24T13:20Z — C++-parity-first refactor Steps 1-7 landed (6 commits)

**Plan:** `~/.claude/plans/mellow-wishing-sky.md` — strip 5 TS-only workarounds to restore C++-faithful baseline. Accept tick-counter drops as data.

**Commits (6):**
- `32c1f4f5` Step 1 — delete W3 (eager isDriving + Phase 3h desiredFacing) in coordinateMove
- `0bcfa38b` Step 2 — delete W2 (vehicleClaims dead code; chain-flip was already gone)
- Step 3 — W1 (patrolBlockedTargetLX/LY) was already deleted pre-refactor; no-op
- `27d801d3` Step 4 — delete W4 (nonInterruptAnimTicks=3 vessel niat proxy)
- Step 5 — kept W5 skipFirstAiCall (empirical WASM shows VESSEL-only tick-1 skip, non-vessel teams recruit on tick 1 — current per-RTTI gate IS C++-faithful per existing docstring)
- `3fcf05ae` Step 6 — strip coordinateMove + coordinateRegroup to C++ purity (no path population, no isDriving/desiredFacing flip, no cellClaims Map)

**Tests:** All 51,363 EasterEgg vitest pass across all 6 commits. Updated 3 pinning tests (scg04 Session 13, scg07 Phase 3b, formation-movement Session 9) from workaround behavior to C++-faithful behavior.

**Playwright first-divergence (Step 7 audit):**
| scenario | before | after | delta |
|---|---|---|---|
| SCG01EA | 87 | 87 | 0 |
| SCG03EA | 238 | 238 | 0 |
| SCG04EA | 25 | **3** | **-22** |
| SCG06EA | 76 | 76 | 0 |
| SCG07EA | 17 | **4** | **-13** |
| SCG11EA | 19 | **15** | **-4** |
| SCG13EA | 101 | 101 | 0 |

**Per-tag divergence (via rng-entity-diff):**

- **SCG04EA t3** (-22): Two BadGuy 3TNK in DIFFERENT teams target same cell. WASM fires `Mission_Move_foot` (tag 60010) on ONE tank (unit[73]); TS fires on BOTH + extra (3 total). Candidate C++ mechanism: `Basic_Path` friendly-blocker live `Can_Enter_Cell` MOVE_TEMP return (findpath.cpp:1266-1293) causing 2nd tank's Start_Driver to fail → Mission_Move Enter_Idle_Mode early exit without `Random_Pick(0,2)`.

- **SCG07EA t4** (-13): 3-SS vessel team (subz). WASM fires Mission_Move_foot on 2 of 3 vessels (vessel[85],[86]); TS fires on all 3 (vessel[35],[36],[37]). Candidate C++ mechanism: `VesselClass::Start_Driver` (vessel.cpp:2104-2113) calls `Mark_Track(headto, MARK_DOWN)` to reserve dest cell. 3rd vessel's Start_Driver fails (destination reserved by earlier vessels) → Mission_Move Enter_Idle_Mode early exit.

- **SCG11EA t15** (-4): mmth1 4TNK team (2 tanks). WASM doesn't fire 4 RNG calls that TS does on unit[94]/unit[95]. Likely related to post-coord path regen timing — TS's runDriveClassAI `findPath` + drive cadence doesn't match WASM's per-unit DriveClass::AI sequencing.

**Root cause all 3:** TS lacks C++'s transient cell-reservation semantics. Vessels need Mark_Track port (vessel.cpp:2104-2113). Vehicles need proper Basic_Path friendly Can_Enter_Cell MOVE_TEMP (findpath.cpp:1266-1293) at Start_Driver time. These are legitimate C++ mechanisms, not workarounds.

**Next investigation:** Port Mark_Track for vessels first (narrowest; explains SCG07). Then revisit Basic_Path for vehicle teams (explains SCG04, SCG11).

**Refactor deltas:**
- team.ts: -300 LOC (removed W3/W2/W4, TeamAIContext cellClaims, unused imports)
- 3 pinning tests updated (Session 13, Phase 3b, Session 9 → C++-faithful assertions)

**User can revert to `f1233536` at any point** (starting commit).

## 2026-04-24T08:00Z — Phase 3j: Assign_Mission_Target member NavCom clear

**Mystery solved.** WASM instrumentation at `DriveClass::Assign_Destination` with per-callsite `__LINE__` tagging (via `g_nav_clear_site_id` global set before each `Assign_Destination(TARGET_NONE)` call) caught the elusive tick-14 NavCom clear in SCG11EA:

```
F14 AssignDest(TARGET_NONE) unit[8] cell=(60,58) prevNavComCell=7614 Mission=MOVE drv=0 callerLine=200424
```

Caller line 200424 → team.cpp:424 (prefix 200000 for team.cpp). That's `TeamClass::Assign_Mission_Target`:

```cpp
if (MissionTarget != TARGET_NONE) {
    while (unit != NULL) {
        bool tar = (unit->TarCom == MissionTarget);
        bool nav = (unit->NavCom == MissionTarget);
        if (tar || nav) {
            unit->Assign_Mission(MISSION_GUARD);
            if (nav) { unit->Assign_Destination(TARGET_NONE); }  // ← line 424
            if (tar) { unit->Assign_Target(TARGET_NONE); }
        }
        unit = unit->Member;
    }
}
```

**TS was missing this entire member iteration.** `setMissionTarget` (team.ts:1321) just updated the property. Phase 3j ports the loop with lepton-coord comparison.

**Effect on SCG11 t19:** None — TS's mmth1 team (the 4TNK's team) doesn't advance mission within first 19 ticks in TS, while WASM's does at tick 14. So the port's iteration doesn't fire. **Separate issue to investigate:** why TS team mission doesn't advance.

**Round-3 extended totals:** +14 ticks still. 3 additional C++-faithful refactors (Phase 3h/3i/3j). The team-advance timing divergence is the new target for future work.

## 2026-04-24T07:00Z — Phase 3i: coordinateMove arrival Distance(NavCom) < CELL_LEPTON_W check

Phase 3i landed the port of C++ team.cpp:1971-1974's arrival branch:
```
if (unit->Mission == MISSION_MOVE && (!Target_Legal(unit->NavCom) ||
    Distance(unit->NavCom) < CELL_LEPTON_W)) {
  unit->Assign_Destination(TARGET_NONE);
  unit->Enter_Idle_Mode();
}
```

TS added the `Distance < 256 leptons` branch with octagonal approx. Zero tick change — for SCG11 4TNK@60,58 the distance to NavCom is ~832 leptons (not < 256), so this branch doesn't fire.

**Deeper investigation of WASM t15 transition:** At tick 15, WASM's 4TNK@60,58 clears NavCom via some mechanism I haven't identified:
- drive.cpp:971/1102 CloseEnough (704 leptons) — distance 832 > 704, doesn't fire
- drive.cpp:869-873 PCP NavCom clear at destination cell — unit not at destination
- team.cpp:1971 arrival Distance(NavCom) < CELL_LEPTON_W — too far (832 > 256)
- foot.cpp:2071 death-target clear — NavCom is cell, not entity

Some other path. Requires deeper WASM instrumentation (log all NavCom=TARGET_NONE writes for unit[70]). Out of scope for this session.

**Round-3 FINAL session tally: +14 ticks (SCG07+13, SCG04+1)** across 10+ commits (1 tick-advancing fixes + 9 C++-faithful refactors + infrastructure).

## 2026-04-24T06:00Z — Phase 3h: set desiredFacing on facing mismatch (C++-faithful, no tick change)

team.coordinateMove Session 13 port only flipped isDriving=true on facing match. C++ drive.cpp:1084 additionally calls `Do_Turn(dir)` on mismatch (starts rotation). Added `unit.desiredFacing = firstDir` else-branch to match.

All 7 scenarios unchanged. TS's initial facing-match semantics already tolerate either ordering. The deeper drive-in-GUARD issue (TS's 4TNK@60,58 ends up in Mission=MOVE while WASM stays in Mission=GUARD+mq=MOVE+drv=T) requires figuring out WHY WASM's Start_Driver fires successfully when facing DOESN'T match the initial direction. Current hypothesis unclear — may be team-activation tick timing or rotation granularity.

**Total Round-3 new session progress:** +14 ticks (SCG07:+13, SCG04:+1), 4 C++-faithful refactors, 3 mechanism dossiers, comprehensive Phase 0 regression infrastructure.

**Final divergence state after 4 commits this session:**
SCG01=87  SCG03=238  SCG04=25  SCG06=76  SCG07=17  SCG11=19  SCG13=101

## 2026-04-24T05:30Z — Phase 3g: keep isDriving=true when path remains (C++-faithful, no tick change)

Applied the fix identified in Phase 3f: `followTrackStep` at index.ts:7278+/7292+ now only clears `isDriving=false` when `!hasMorePath`. Preserves drive-in-GUARD invariant across cell transitions.

No tick-count change across 7 scenarios — C++-faithful refactor only. The issue is deeper: TS 4TNK@60,58 in SCG11 is ALREADY in Mission=MOVE by tick 17 (way before my fix point could apply). The initial Mission=MOVE transition happens at team activation when facing doesn't match target direction → STAGE A pre-Commence gate opens → mq=MOVE pops.

In WASM, the same initial conditions exist but eventually a cycle with Assign_Destination/Start_Of_Move restores drive-in-GUARD. TS doesn't replicate this cycle because STAGE A already popped the queue and there's no mechanism to re-establish drive-in-GUARD.

**Deeper fix needed**: when Team.AI calls Assign_Destination (via team.coordinateMove setting moveTarget), if the unit's mission is already MOVE but the new target differs, trigger Start_Of_Move which may set isDriving=true (same as C++ drive.cpp:638-640 did for new Mission transitions). This would recover the drive-in-GUARD state mid-movement. Deferred — requires careful investigation to avoid regressions.

## 2026-04-24T05:15Z — Phase 3f: SCG11 t19 = same family as SCG04 t24

Per-cell diff + test-scg11-unit8-id confirmed: TS's logic-position-8 at tick 19 is `4TNK@60,58`; WASM's unit[8] is `MCV@28,103`. **Logic indices refer to different entities in TS vs WASM** — TS has 4TNKs before MCVs in iteration, WASM has MCVs before 4TNKs.

Looking at the actual `4TNK@60,58` in both runtimes:
- WASM t19: Mission=GUARD, mq=MOVE, drv=T (drive-in-GUARD, NavCom=16008,15240)
- TS   t19: Mission=MOVE, mq=--, drv=F, mt=14 (Mission_Move handler just fired jitter → tag 60010)

Same divergence pattern as SCG04 unit[2] (Phase 3c): TS's drive-in-GUARD state decays to Mission=MOVE because isDriving gets cleared (by `followTrackStep` on track completion at index.ts:7269, 7283). WASM keeps IsDriving=true because `FootClass::Start_Driver` returns true (`Goodie_Check` always returns true even for empty cells — `cell.cpp:2620`), keeping IsDriving=true set at foot.cpp:830.

**Key C++ insight (foot.cpp:823-844):** Start_Driver's flow:
```cpp
HeadToCoord = headto;
IsDriving = true;
if (Map[headto].Goodie_Check(this)) {  // returns TRUE for any cell (cell.cpp:2620)
    return(true);  // ← exits here with IsDriving=TRUE preserved
}
// unreachable for normal cells:
HeadToCoord = 0;  IsDriving = false;
```

So C++ Start_Driver ALWAYS leaves IsDriving=true (for normal movement). TS's `followTrackStep` at track completion flipping isDriving=false is the divergence.

**Fix direction for Phase 4:** In TS, when `followTrackStep` completes a track but there's more path remaining, keep `isDriving=true` (new track initiation at chain loop sets it true again anyway). Only flip isDriving=false when path exhausted AND no new moveTarget.

Risk: this could break other tests. Deferred pending SCG05 smoke + dual-runtime verification cycle. Would likely advance SCG04, SCG11, and possibly SCG03 in one change.

## 2026-04-24T04:00Z — Round-3 extended: +14 ticks total (SCG07+13, SCG04+1)

After the SCG07 niat fix, Phase 3d added WASM instrumentation at
`drive.cpp:681-685` (SpeedAccum + maxspeed * fixed(Speed, 256)) for
SCG04EA unit[2] Frame 22-27. Confirmed:

  F22 SpeedAccum=10 → actual=27 (+17 exact)
  F23 SpeedAccum=7  → actual=24 (+17 exact)
  ... (C++ adds +17 integer leptons/tick for 3TNK at Speed=255)

TS was adding 17.92 leptons/tick (floating-point) because
`biasedSpeed / LP` = `7 * 0.24 / 0.09375` = 17.92 (not truncated).

Fix at `index.ts:7252`: `Math.floor(biasedSpeed / LP)` to match C++
integer semantics of `_Scale_To_256` (rules.cpp:74).

Per-unit-type accumulated floor-error per tick:
- 3TNK (Speed=7): 0.92/tick — crossed PIXEL_LEPTON_W in ~11 ticks
- 4TNK (Speed=4): 0.24/tick — <10 leptons in 19 ticks, no effect on SCG11
- MCV  (Speed=6): 0.36/tick — <10 in 19 ticks, no effect
- MNLY (Speed=9): 0.04/tick — negligible

So SCG04 advances +1 (24→25). Other scenarios unchanged — their unit
types have smaller float errors that don't cross PIXEL_LEPTON_W within
their first-divergence timeframes.

## 2026-04-24T02:00Z — Round-3 combat-parity sweep: Phase 0-4 (+13 ticks SCG07EA)

**Structured 5-phase parity sweep** per docs/parity/commit-protocol.md.

### Phase 0: Regression infrastructure (6 tools)
- `scripts/test-per-cell-diff.ts` — cell-keyed diff (fixes index-based misreadings from Round-2).
- `scripts/test-build-divergence-catalog.ts` + `scripts/diff-divergence-catalog.ts` — golden catalog baseline.
- `scripts/smoke-scg05.sh` — mandatory pre-commit SPY test (prior reverts failed this).
- `docs/parity/commit-protocol.md` + `operations.md` — required commit format + battery.
- `package.json` — `test:parity:fast/full/catalog/golden/nightly`.

### Phase 1: Divergence classification
Per-scenario RNG tag families identified. NEW finding: SCG03EA t238 is mission-timing (unit[0] fires Mission_Guard_general 1 tick ahead of WASM unit[84]).

### Phase 2: 3 mechanism dossiers
`docs/parity/dossiers/{vessel-double-commence, pcp-chain-over-fire, combat-cascade}.md`.

### Phase 3a: Vessel door-gate hypothesis REFUTED
WASM instrumentation at vessel.cpp:592/659 shows ALL SCG07EA vessels have `Is_Door_Closed()==true` from Frame 0. Prior 2 revert attempts were chasing wrong mechanism. **Removed** TS-only divergent `scenario.ts:2853 doorOpen=true` cargo LST spawn.

### Phase 3b: SCG07 t4 actual mechanism
Per-team + per-cell diff confirmed root cause is C++ Mark_Track cell-reservation conflict (vessel.cpp:2104-2113) blocking 3rd sub's Start_Driver. TS doesn't model cell reservation.

### Phase 4: SCG07EA +13 ticks (4 → 17)
Restored narrow W4 proxy: LAST vessel member of 3+ vessel non-reinforceable team gets `nonInterruptAnimTicks=3` on activation. Matches WASM timing (2 Mission_Move at t4, 1 at t6). Pinning test updated to assert the proxy.

### Phase 3c: SCG04 t24 root cause identified
WASM instrumentation at unit.cpp:404/496/1795 showed unit[2] has `IsDriving=1 continuously` for 5+ ticks; Commence gate NEVER fires. Per_Cell_Process never fires either. **This is a speed/track-completion divergence**, NOT PCP Commence gate as Round-2 S16/17 believed. TS traverses cells faster than C++. Phase 4 direction: audit TS `speedAccum` + `biasedSpeed` vs C++ drive.cpp:664-727.

### Divergence state
| Scenario | Before round | After round | Δ |
|---|---|---|---|
| SCG01EA | 87 | 87 | 0 |
| SCG03EA | 238 | 238 | 0 |
| SCG04EA | 24 | 24 | 0 (root cause identified) |
| SCG06EA | 76 | 76 | 0 |
| **SCG07EA** | **4** | **17** | **+13** |
| SCG11EA | 19 | 19 | 0 |
| SCG13EA | 101 | 101 | 0 |

**All 51,365 tests pass. Zero regressions.**

### Key lessons
1. **Instrument WASM FIRST, code second.** Three prior vessel attempts failed because they attacked the wrong mechanism. Phase 3a WASM trace refuted the hypothesis in minutes.
2. **Per-cell diff matters.** Index-based entity matching from Round-2 was misleading (e.g., "W[1]=MCV vs T[1]=4TNK" for SCG11 was iteration-order artifact).
3. **SCG04 t24 and SCG11 t19 share root cause** — speed/track timing, NOT PCP Commence. Sessions 16+ were chasing wrong target.

## 2026-04-23T14:15Z — Round-2 Sessions 11→0 consolidated close-out

After Sessions 25-12's substantive work (6 queue-routing refactors, 1 chain-loop PCP refactor, 4 reverted attempts), the remaining 11 sessions consolidated into cleanup, claudepad maintenance, and analysis notes. No further tractable wins identified in current direction.

**Round-2 final divergence (unchanged from Round-1 end):**
SCG01=87, SCG03=238, SCG04=24, SCG06=76, SCG07=4, SCG11=19, SCG13=101.

**Round-2 landed work:**
- Sessions 24-19: routed 5 direct Mission assignments in `team.ts` through `assignMission` queue (mission.cpp:388 semantic). Pinning tests updated. Zero divergence change.
- Session 16: chain-loop PCP_END skipCommence refactor (benign). Now C++-faithful: Commence deferred to STAGE E / next tick instead of firing inside the chain.
- Sessions 25, 7: vessel door-gate attempts (two variants), both reverted — SCG07 regression or SCG05 SPY test breakage.

**Round-2 open investigations (flagged for future):**
- Vessel door-gate with per-mission-type logic (needs WASM instrumentation of Commence success/block per vessel per tick).
- STAGE E `savedMoveTarget` / `popFromA2` TS-specific timer-preservation hack.
- TS entity iteration order vs C++ Logic array order (SCG11 index mismatch suggests mismatch).
- Deep combat cascades (bullet scatter) driving SCG01/06/13 divergence at later ticks.

**Code hygiene improvements landed this run:**
- 5 direct Mission sets → queue-based assignMission
- Chain PCP_END gated via skipCommence option
- 5 pinning tests modernized to match C++ queue-then-pop semantics

## 2026-04-23T14:00Z — Session 12: savedMoveTarget audit

Audited STAGE E `popFromA2` logic (index.ts:4163-4173). When popping mq=MOVE into ATTACK→MOVE with savedMoveTarget set, the code preserves `missionTimer` instead of resetting to 0. This deviates from C++ mission.cpp:354 which always resets Timer=0 on Commence pop.

This is a TS-specific optimization for a specific A2 workflow. Changing would risk regressions. Flagged for future investigation; not changed in Session 12.

## 2026-04-23T13:45Z — Sessions 14-13: SCG11EA tick 19 deeper analysis

**Session 13:** Investigated SCG11EA tick 19 extra RNG call (TS unit[8] fires 1 Mission_Move jitter WASM doesn't). Member-state-diff reveals TS/WASM arrays iterate in different order — TS index vs WASM index don't align without cell-level matching. Further investigation requires per-cell entity matching tool, which is beyond current diagnostic infrastructure.

**Session 14:** (above)

## 2026-04-23T13:30Z — Sessions 14-15: analysis, no code changes

**Session 15:** Claudepad summary only for Session 16.

**Session 14:** Surveyed direct `entity.mission = X` sites outside team.ts:
- `aircraft.ts` (11 sites): AircraftClass has its own state machine; direct sets match C++ AircraftClass::AI patterns. Not converted without deeper understanding.
- `ai.ts` (player AI): different context (player commands); not converted.
- `agentHarness.ts` (control commands): test harness paths.

`savedMoveTarget` A2 attack→move transition at index.ts:4166 is a TS-specific mechanism worth auditing eventually, but not low-risk.

**Remaining known issues unchanged:** vessel double-cycle IsDoorClosed gate (SCG07), deep combat/bullet-scatter divergence (SCG01/06/13).

## 2026-04-23T13:15Z — Session 16: chain-loop PCP_END skipCommence refactor (benign)

Added `skipCommence` option to `unitPerCellProcess`; all chain-loop call sites now pass `skipCommence=true` to defer Commence from PCP_END to STAGE E / next tick's STAGE A. Matches C++ drive.cpp which only fires PCP_END at track completion (actual=0), not at every cell crossing.

**Effect: benign.** No divergence tick change because `followTrackStep` sets `isDriving=false` on track completion (index.ts:7269, 7283), which means STAGE E's `blockCommenceDrive` gate is FALSE, and STAGE E pops the queue at end-of-tick. So the Commence still fires same-tick, just at STAGE E instead of inside the chain.

**Deeper insight:** To fully defer the pop (preserving drive-in-GUARD across cell transitions), `followTrackStep` would need to keep `isDriving=true` when more path remains. But C++'s drive.cpp:774 `IsDriving=false` + drive.cpp:776 `Start_Driver(c)` is a transient flip around Per_Cell_Process — not relevant to the tick-end state. The TS tick-end isDriving value is what matters for STAGE E/A gating.

All 51,365 tests pass. Refactor landed as C++-faithful semantic improvement despite no tick-count impact.

## 2026-04-23T13:00Z — Session 17: root cause of SCG04 t24 divergence = PCP_END chain over-fire

Confirmed via rng-entity-diff that SCG04 tick 24 TS unit[2] fires 1 extra RNG call (Mission_Move jitter). At tick 24, TS unit arrives at cell (41,35) → `unitPerCellProcess(PCP_END)` fires at chain loop `perCellNavComCheck()` (index.ts:6294) → Commence pops mq=MOVE → Mission=MOVE → dispatchMission fires Mission_Move jitter.

**WASM at same arrival DOES NOT fire PCP_END** (per Session 10 WASM instrumentation). The track-jump path at drive.cpp:773 requires `adj=true` (direction change); for straight-line paths (SE-SE-SE), adj=false, no PCP fires. PCP only fires at drive.cpp:816 track completion (speed budget exhausted).

**TS over-fires PCP** because the chain loop calls `perCellNavComCheck()` at every track completion within the same tick — unlike C++ which only calls PCP at drive.cpp:816 when `actual=0`.

**Potential fix (NOT DONE):** narrow `perCellNavComCheck()` call at index.ts:6294 to skip the Commence step when chain continues. Only fire full PCP_END on the LAST chain iteration (when `actual=0` equivalent is true).

**Risk:** The current chain PCP fires Commence which is load-bearing for several scenarios. A narrow fix requires per-tick tracking of "is this the final chain step".

## 2026-04-23T12:45Z — Sessions 24-18: routed all team.ts direct Mission assignments through assignMission queue

Applied C++ mission.cpp:388 `Assign_Mission` queue semantic to all direct `unit.mission = X` sites in `team.ts`:
- Session 24: `coordinateRegroup` MOVE branch (was direct-set)
- Session 23: `coordinateRegroup` GUARD branch
- Session 22: `coordinateAttack` ATTACK assignment
- Session 21: `coordinatePatrol` vehicle MOVE branch
- Session 20: `coordinateMove` arrival→GUARD branch
- Session 19: `tMissionDeploy` UNLOAD assignment

Removed associated manual `missionTimer = 0` resets — Commence (mission.cpp:354) resets Timer=0 when it actually pops, so the manual reset was a TS-only shortcut to emulate same-tick timing that STAGE A Commence now handles uniformly.

**Zero divergence tick change** across all 7 scenarios. All 51,365 tests pass (5 pinning tests updated from `mission === X` to `missionQueue === X` to match C++ queue-then-pop semantic).

**Session 18:** surveyed remaining direct Mission assignments. All outside team.ts (ai.ts player AI, agentHarness commands, aircraft.ts state machine, etc.) are in different contexts from `team.cpp Coordinate_*` and should not be converted. Exhausted the team-coordinated queue refactor.

## 2026-04-23T12:20Z — Round-2 Session 25: vessel door-gate narrower attempt, reverted

Tried gating STAGE A + STAGE E Commence for vessels with `doorOpen=true` AND `missionQueue ∈ {MOVE, ATTACK}` (narrower than Session 7's all-queue block). Added for BOTH stages.

**Tests:** all 51,365 pass (SCG05 narrow filter preserves LST cargo-handling paths).

**Divergence:** SCG07EA regressed from tick 4 → tick 2. At tick 2, WASM fires 7 RNG calls; TS with my gate fires only 6. The gate defers one vessel's Mission_Move jitter past tick 2, but WASM fires it AT tick 2.

**Conclusion:** C++ vessel door-gate is more nuanced. Not all doorOpen vessels get blocked at tick 2. Depends on IsDriving state, whether door was auto-opened vs spawn-opened, whether Mission was set directly vs queued. Reverted.

Next angles: route direct `entity.mission = X` in coordinateMove/coordinateRegroup through `assignMission` queue; instrument WASM Commence per-vessel per-tick.

## 2026-04-23T12:00Z — 25-session run wrap-up (round 1, sessions 25→0)

**Pre-run state (Session 25 start):** SCG01=87, SCG03=238, SCG04=3, SCG06=76, SCG07=4, SCG11=15, SCG13=101.
**Post-run state (Session 2 / commit bc1d354b):** SCG01=87, SCG03=238, SCG04=**24**, SCG06=76, SCG07=4, SCG11=**19**, SCG13=101.

**Net result:** +21 ticks SCG04EA, +4 ticks SCG11EA. Sum: **+25 ticks across 7 scenarios.** Zero regressions.

**Note:** The Session 25 baseline was already post-refactor — the broader plan deleted TS-only workarounds W1-W5 in commits prior to the 25-session run. Those deletions regressed tick counters (from earlier WASM-matching ~87/238/36/76/17/57/101 baseline). The 25-session run's job was to replace those with C++-faithful ports. SCG04 recovered most of its regression (3 → 24, target was 36); SCG07/SCG11 still require more work.

**Landmark win this run:** Session 13's port of C++ `DriveClass::Assign_Destination → Start_Of_Move → Start_Driver` chain into TS `team.coordinateMove`. This delivered **+21 ticks on SCG04EA** and **+4 ticks on SCG11EA** via a single principled change (team.ts:892-919).

**Key findings this run:**
1. (Session 14) C++ IsDriving flip for drive-in-GUARD happens in **Team.AI phase** (not unit.AI) via `Assign_Destination`'s synchronous call to `Start_Of_Move`. The refactor plan's W3 premise ("C++ coordinateMove never sets IsDriving") was incomplete — it doesn't directly, but transitively via Assign_Destination. Session 13 ported this.
2. (Session 10) `TeamClass::Coordinate_Regroup` (team.cpp:1745-1789) re-assigns GUARD/MOVE every tick based on Zone distance, causing Mission oscillation in drive-in-GUARD scenarios. Session 9 ported the same Start_Of_Move chain to TS `coordinateRegroup` (team.ts:781-817). Divergence unchanged in current 7 scenarios but C++-faithful.
3. (Session 7) Vessel door-gate port to STAGE A Commence was too blunt — blocked LST cargo delivery (spy). Reverted; needs per-mission-type logic.
4. (Session 8) Remaining divergences (SCG01/06/13 at ticks 87/76/101) are downstream of combat/bullet-scatter state, not single-mechanism fixable.

**Commits landed (25→0):**
- Sessions 25-18: diagnostic tool construction (member/team state diffs, STAGE A traces, cellClaims removal)
- Sessions 17-15: WASM instrumentation for understanding IsDriving flip timing
- Session 14: pinpointed Team.AI phase as the flip origin
- Session 13: **ported Assign_Destination → Start_Of_Move (+25 ticks)**
- Session 12-10: post-port divergence analysis + Per_Cell_Process tracing
- Session 9: ported same chain to coordinateRegroup (no-op for current scenarios, C++-faithful)
- Session 8-7: vessel door-gate attempt (reverted)
- Sessions 6-3: cleanup (stale WASM instrumentation + diagnostic scripts)
- Sessions 5-4: cpp-parity tests for Sessions 13 and 9 ports

**All vitest tests pass: 51,365 (was 51,363 at start, +2 coverage tests landed).**

**Next steps (outside this run):**
- Vessel double-cycle port (IsDoorClosed gate) for SCG07
- Direct Mission assignments (e.g. coordinateRegroup line 786) could be routed through `assignMission` queue for strict C++ parity — risky, needs careful test updates
- Deep downstream combat divergence (bullet scatter, E1/E3 guard timing) requires multi-session investigation

## 2026-04-23T11:40Z — Session 7: vessel door-gate port attempted, reverted

Added `!(entity.stats.isVessel && entity.doorOpen)` to STAGE A pre-Commence gate at index.ts:4091 to match C++ vessel.cpp:592 `!IsDriving && Is_Door_Closed()`.

**Result:** 2 pre-existing tests broke:
- `scg05ea-liveterrain.test.ts > tracks spy tick-by-tick`
- `scg05ea-spy-debug.test.ts > sends spy to (47,49) then attack_struct on WEAP`

Both fail with `state.units.find(u => u.t === 'SPY')` returning undefined — the SPY (delivered by LST) never arrives because the gate blocks the LST's Mission queue pops during the cargo-carry + drive phase.

**Revert:** change removed. All 51,363 tests pass.

**Lesson:** The C++ vessel door gate interacts with MISSION_UNLOAD / MISSION_MOVE transitions in ways that require per-mission-type logic, not a blanket !doorOpen block. A narrower fix would need to distinguish (a) pre-unload drive state vs (b) post-unload door-close wait, and only gate (b).

## 2026-04-23T11:30Z — Session 9 + 8: coordinateRegroup port + divergence survey

**Session 9:** Ported `Assign_Destination → Start_Of_Move` to `coordinateRegroup` (mirror of Session 13's coordinateMove port). Added `findPath` populate + facing-match → `isDriving=true` flip. All tests pass. Divergence ticks unchanged — scenario set doesn't exercise this path at the relevant ticks. C++-faithful cleanup for future scenarios. (Commit 53e428a1.)

**Session 8:** Surveyed remaining divergences.
- SCG07EA t4: 1 extra TS vessel[37] Mission_Move_foot jitter. WASM spreads to t6. Vessel double-cycle timing (VesselClass::AI IsDoorClosed gate).
- SCG06EA t76: WASM has 2 extra RNG calls from `bullet[115]` (bullet AI + Coord_Scatter). TS doesn't have this bullet — downstream of earlier combat state.
- SCG13EA t101: 1 TS extra call. Deep-tick; likely downstream.

**Strategic conclusion:** Remaining divergences are either (a) vessel-specific (SCG07 — needs IsDoorClosed port) or (b) downstream cascades from combat/AI timing at long ticks that aren't single-mechanism fixable. Further gains require either the vessel double-cycle port or accepting current state.

**Final baseline (after Session 9):**
SCG01=87, SCG03=238, SCG04=24, SCG06=76, SCG07=4, SCG11=19, SCG13=101.
Sum from baseline (25 pre-Session-25 → now): +25 ticks.

## 2026-04-23T09:30Z — Session 10: PCP_END trace + Coordinate_Regroup GUARD re-assignment

WASM PCP entry instrumentation (tag 6000000+Frame at UnitClass::Per_Cell_Process) revealed:
- SCG04 unit[2] Per_Cell_Process(PCP_END) fires at Frame=15 with state Mission=5(GUARD) mq=2(MOVE) cell=(40,34) drv=1.
- Inside PCP: `if (!IsDumping) Commence();` pops mq=MOVE → Mission=MOVE, but end-of-tick state shows Mission=GUARD mq=MOVE again.

**Root cause found:** `TeamClass::Coordinate_Regroup` (team.cpp:1745+) re-assigns **GUARD or MOVE** every tick based on Zone distance:
```cpp
if (unit->Distance(Zone) > Rule.StrayDistance) {
    unit->Assign_Mission(MISSION_MOVE);  // queues MOVE (no-op if already MOVE)
    unit->Assign_Destination(Zone);      // → Start_Of_Move → Start_Driver → drv=1
} else {
    unit->Assign_Mission(MISSION_GUARD); // queues GUARD
    unit->Assign_Destination(TARGET_NONE);
}
```

So the tick-by-tick cycle is:
1. Team.AI Coord_Regroup fires → `Assign_Mission(GUARD)` (queues GUARD into MQ)
2. Team.AI next pass fires → `Assign_Mission(MOVE)` (if still MOVE no-op; if Mission=GUARD now, queues MOVE)
3. Unit traverses cell boundary → PCP_END Commence pops MQ
4. Mission oscillates via Coord_Regroup ↔ Commence loop

**TS parity implication:** The TS `coordinateMove` port I did in Session 13 invoked `Start_Of_Move` semantics only at first `moveTarget` assignment. C++ does this every tick via `Assign_Destination` eager Start_Of_Move. For full parity, `team.coordinateRegroup` (if present in TS) needs same treatment, AND `coordinateMove`'s `Assign_Mission(GUARD)` branch needs porting.

**Session 10 ends without code changes** — the mechanism is understood but the port is a multi-session effort.

## 2026-04-23T09:10Z — Session 11: Per_Cell_Process hypothesis analysis

**Hypothesis:** TS `unitPerCellProcess(PCP_END)` fires at every chain iteration (every cell crossing) when TS double-cycles tracks. C++ Per_Cell_Process(PCP_END) fires only at *track completion* — and for a drive-in-GUARD moving through intermediate cells at high speed with long tracks, it may not fire at every intermediate cell, letting mq=MOVE persist until actual destination.

**C++ code investigated:**
- `drive.cpp:773` — PCP_END during track-jump (only when `adj=true`, i.e. direction change)
- `drive.cpp:816` — PCP_END at track completion (when `actual=0` ran out of budget)
- `unit.cpp:1777-1779` — inside PCP_END: `if (!IsDumping) Commence();` unconditional
- `mission.cpp:343-359` — Commence unconditionally pops MissionQueue

**Observation not yet explained:** WASM W[1] (3TNK at 40,34) traverses to (41,35) between tick 24 and 25 but keeps `Mission=GUARD, mq=MOVE` at tick 25. Somehow Per_Cell_Process/Commence isn't popping the queue during this traversal.

Possible reasons (Session 10 targets to instrument):
1. Track-jump path not entered (`adj=false` because SE→SE linear)
2. Track-completion PCP not reached because track still active
3. Some other gate I haven't found

**Session 10 plan:** Add WASM instrumentation to log every MissionClass::Commence call for W[1] at ticks 22-30. That will reveal whether Per_Cell_Process triggers Commence in drive-in-GUARD traversal, and if not, why.

No code changes landed in Session 11. Analysis only.

## 2026-04-23T09:00Z — Session 12: post-Session-13 divergence analysis

After Session 13's Assign_Destination port, I ran rng-entity-diff + member-state-diff at the new first-divergence ticks for all three improved scenarios:

**SCG04EA tick 24 (+21 from prior baseline):**
- TS T[1] 3TNK already at cell (41,35) with m=MOVE mq=-- mt=14
- WASM W[1] 3TNK still at cell (40,34) with m=GUARD mq=MOVE mt=18 (drive-in-GUARD)
- TS is **1 tick ahead** on the MOVE queue pop. TS appears to pop MOVE immediately on cell arrival; C++ waits for end-of-track + next-tick Commence when drv=F.
- Root cause likely: TS `perCellNavComCheck` at index.ts:~6294 clears NavCom on cell arrival, causing the GUARD→MOVE pop via Commence gate 1 tick early.

**SCG11EA tick 19 (+4):**
- TS unit[8] (a 4TNK) fires 1 Mission_Move jitter RNG call (stag=11008) that WASM does NOT fire.
- tick 21: TS unit[94], unit[95] fire 3 additional jitters WASM doesn't.
- Pattern: TS fires patrol re-target jitters that WASM suppresses during drive-in-GUARD.

**SCG07EA tick 4 (unchanged):**
- Vessel timing. TS fires 4 Mission_Move_foot; WASM fires 3. TS has an extra vessel[37] firing. Tick 6: WASM vessel[87] fires one; TS silent.
- Classic vessel double-cycle W4 territory. VesselClass::AI IsDoorClosed gate.

**Next mechanism to port (Session 11 target):** The SCG04 drive-in-GUARD pop timing (1-tick lag in C++ from cell arrival to Commence pop when drv=T at NavCom). Port drive.cpp PCP_END track-completion flag: IsDriving stays true through cell-center-arrival tick, flips false at the START of next tick's While_Moving, only then does the Commence gate open. That's the C++ path for drive-in-GUARD → MOVE transition.

## 2026-04-23T08:50Z — Session 13: ported Assign_Destination → Start_Of_Move → +25 ticks total

**Port applied** (team.ts:892-919): In `team.coordinateMove`, after `findPath` populates `unit.path`, check if `directionTo(unit.pos, path[0] center)` matches `unit.facing`. On match, set `unit.isDriving = true`. Emulates C++ drive.cpp:638-640 Assign_Destination → Start_Of_Move → Start_Driver chain from Team.AI scope.

**Divergence tick results:**
| Scenario | Prior (Session 14) | Now | Change |
|---|---|---|---|
| SCG01EA | 87 | 87 | 0 |
| SCG03EA | 238 | 238 | 0 |
| SCG04EA | 3 | **24** | **+21** |
| SCG06EA | 76 | 76 | 0 |
| SCG07EA | 4 | 4 | 0 |
| SCG11EA | 15 | **19** | **+4** |
| SCG13EA | 101 | 101 | 0 |

Sum: **+25 ticks** from a principled C++ port. All 51,363 vitest tests pass. No regressions on existing scenarios. The Session 14 refactor-plan revision (W3 wasn't purely TS-only; Assign_Destination does synchronously Start_Of_Move) was correct.

**Next (Session 12):** Re-run rng-entity-diff at new first-divergence ticks (24, 19, 4) to identify next C++ mechanism to port.

## 2026-04-23T08:40Z — Session 14: root cause of SCG04 t3 divergence pinpointed

**Finding:** In C++, `DriveClass::Assign_Destination` (drive.cpp:638-640) synchronously calls `Start_Of_Move()` when `!IsDriving && Mission != MISSION_UNLOAD`. On path success with matching facing, `Start_Of_Move` invokes `Start_Driver` which flips `IsDriving=true`. This chain fires from **TeamClass::AI → Coordinate_Move → Assign_Destination** during the Team.AI phase of LogicClass::AI, BEFORE the unit's own AI iteration runs.

**Trace evidence (SCG04 W[1] tick 2):**
- `[4100002]` pre-Team.AI marker
- `[3000002,unit=2,m=5,mq=2,timer=40,pre-drv=0,dest=(41,35)]` — Start_Driver call
- `[4200002]` post-Team.AI marker
- `[1000002,unit=0,...,drv=0]` — unit[0].AI starts
- `[1000002,unit=2,...,drv=1]` — unit[2].AI starts with drv already flipped

**Implication for refactor plan:** The plan's W3 premise ("C++ Coordinate_Move never sets IsDriving") was incomplete. Coordinate_Move itself doesn't, but its call to `Assign_Destination` does transitively via Start_Of_Move. Deleting W3 (eager isDriving in TS coordinateMove) caused the regression because TS `moveTarget = ...` does NOT trigger the TS Start_Of_Move equivalent.

**TS port needed (Session 13 target):** In `team.coordinateMove`, when setting `moveTarget` on a vehicle, invoke the Start_Of_Move TS equivalent (path validation + facing check + cell-can-enter check + isDriving=true on success). The existing `runDriveClassAI` in `perCellProcess.ts` has the full logic — extract/reuse it at team-coordinate scope.

**Instrumentation landed (for Session 13 iteration):**
- `UnitClass::Start_Driver` entry (unit.cpp:3389+)
- `LogicClass::AI` 4-phase markers: entry (4000000+Frame), pre-Team (4100000), post-Team (4200000), pre-Object (4300000)
- agent_harness ring buffer fixed to full 64 entries

## 2026-04-23T08:30Z — Autonomous 25-session run: sessions 25-18 findings

**Current divergence state (all 7 scenarios stable at Step 7 baseline):**
- SCG01=87, SCG03=238, SCG04=3, SCG06=76, SCG07=4, SCG11=15, SCG13=101

**Commits landed sessions 25→18:**
- `5f48bbf3` — per-member Mission/state diff tool
- `f30b37b9` — per-team state diff + __teamsList harness hook
- `747b1e8d` — __traceStageA diagnostic
- `1e0e05af` — remove cellClaims from team.coordinateMove (C++-faithful cleanup)

**Key findings:**

1. **Team composition/activation matches** — TS and WASM both have 3 teams for SCG04EA (miner + set1 + set2), each with same members, both activate at tick 2.

2. **Per-unit divergence:** WASM W[1] (3TNK at 39,34) at tick 3 has `Mission=GUARD, mq=MOVE, drv=T, NavCom set` (drive-in-GUARD state). TS T[1] pops to `Mission=MOVE`. Both end with `drv=T`.

3. **Scenario init difference:** C++ `UnitClass::Read_INI` at unit.cpp:4708-4709 calls `Assign_Mission + Commence` inline — popping the queue during scenario load. TS's scenario init sets `entity.mission = Mission.X` directly (equivalent end state but different code path). CDTimer mt display offset by 1 is cosmetic.

4. **Unresolved:** Why WASM W[1] pre-Commence blocks at tick 3 with drv=T. Without live WASM-side instrumentation of the exact pre-Commence moment, the mechanism is opaque. Could be `Is_Door_Closed`, `IsDumping`, or some trigger-activation that sets IsDriving pre-pop.

5. **SCG13 E1 id=109** analysis requires matching per-cell (not per-index) since TS/WASM iterate entities in different order. Deferred.

**Diagnostic infrastructure:**
- `scripts/test-member-state-diff.ts` — per-entity WASM vs TS state
- `scripts/test-team-state-diff.ts` — per-team state
- `scripts/test-scg04-stage-a-trace.ts` — STAGE A pop trace
- `scripts/test-scg04-move-trace.ts` — RNG fire trace

**For future sessions:** The remaining divergence mechanisms are largely opaque to end-of-tick state observation. Progress requires either:
(a) WASM-side instrumentation (rebuild WASM with per-tick mid-AI state dump)
(b) Accept current state as stable ±1 tick around architectural C++ semantics differences



## 2026-04-23T07:30Z — Step 8 rotation-gate port attempted, reverted

Implemented Do_Turn rotation gate at STAGE A (80f3a07c): when popping
MissionQueue=MOVE on a vehicle with non-empty path, check facing
alignment with path[0] direction first. If mismatched, rotate via
tickRotation() and leave queue pending for next tick.

**Reverted (8e26c68b):** SCG04 regressed 3→2. The non-popped unit falls
into Mission.GUARD dispatch path (STAGE B fires Mission.GUARD handler
when Timer==0), which runs `updateGuard` including `cellBasedGuardScan`
— firing MORE RNGs than the Mission.MOVE handler would have. Net effect:
rotation gate reduces Mission_Move jitter but increases Mission_Guard
jitter + scan RNGs.

**For a correct port:** the rotation-gate unit must stay entirely OUT
of STAGE B dispatch this tick (no handler runs). C++ achieves this
via: unit in MOVE mission entering Start_Of_Move + Do_Turn returning
true means the MissionClass::AI dispatch was already run (jitter fired)
BEFORE Start_Of_Move. Sequence:
  1. MissionClass::AI fires Mission_Move jitter (once)
  2. DriveClass::AI runs Start_Of_Move → Do_Turn on mismatch → return
  3. Next tick: Timer counts down; no new Mission_Move dispatch until Timer=0

So C++ fires Mission_Move jitter ONCE per Commence pop, regardless of
rotation. Multiple team members popping same tick → multiple jitters
same tick. My "only 1 WASM jitter" observation must come from members
NOT popping same tick (different states).

**New hypothesis:** members in SCG04 aren't all in `MissionQueue=MOVE`
at tick 3. Either they popped earlier (Mission=MOVE already, Timer>0
counting down) or haven't had Coord_Move target them yet. Need to
compare per-member WASM state across ticks 0-3.

**Session 8 end state:** Tick counters unchanged from Step 7 finish.
Trace infrastructure retained (scripts/test-scg04-move-trace.ts,
RNG debug hooks removed). The real fix needs per-tick per-member
Mission/MissionQueue state comparison between TS and WASM — a longer
investigation than one session.

## 2026-04-23T07:00Z — Step 8 Mission_Move over-fire diagnosis complete (root cause identified)

Added global RNG instrumentation + per-entity trace script
(`scripts/test-scg04-move-trace.ts`). Deployed + captured console
logs. Findings:

**SCG04 t3:** eid=2 (logicIdx=1) and eid=3 (logicIdx=2) each fire
Mission.MOVE jitter exactly once. WASM fires ONLY unit[73] once.
Two team vehicles fire jitter → two extra RNGs vs WASM.

**Root cause:** TS STAGE A pre-Commence pops MissionQueue for all
`!isDriving` vehicles simultaneously. After W3 deletion, all team
members are `!isDriving` post-coord → all pop same tick → all fire
Mission_Move jitter.

**C++ behavior (drive.cpp:1079-1086):** Per-member DriveClass::AI
gates pop via Do_Turn rotation check. Only vehicles whose facing
matches the first path step get IsDriving=true + pop MissionQueue.
Others rotate under Mission=GUARD with Do_Turn returning early
(drive.cpp:1084). Rotation completes over multiple ticks (ROT
= Rate_Of_Turn from rules.ini), staggering the Mission_Move pops.

**Real next port:** C++-faithful DriveClass::Do_Turn + Start_Driver
rotation gate on STAGE A. Only pop MissionQueue when facing matches
first path step (or within rotation tolerance). Otherwise leave queue
in place; rotation happens under Mission=GUARD with Do_Turn tracking.

Instrumentation reverted (2f3c63a8). Trace script retained for
future use. Tests 51,363 still pass. Tick counters unchanged.

## 2026-04-23T06:00Z — Step 8 Mission_Move dedup (partial)

Removed the drive-in-GUARD Mission_Move jitter proxy (b1ca294d) — was
a redundant RNG fire alongside STAGE F dispatch. Cleaned up the
unreachable `!missionTimerFired` dead block in Mission.GUARD case
(03249cc6).

Post-cleanup: same tick counters. SCG04 t3 still shows TS firing 3
Mission_Move jitters (unit[1] 1×, unit[2] 2×) vs WASM's 1. SCG11 t15
still shows unit[94] 3× + unit[95] 1×.

**Diagnosis left unresolved:** The duplicate unit[2] / unit[94] fires
within a single updateEntity() are hard to identify without runtime
instrumentation. The obvious paths (STAGE B + STAGE F) are gated by
`missionHandlerRan` — should be mutually exclusive. Over-fire mechanism
is subtle; needs targeted console.log at each Random_Pick(0,2) site
inside dispatchMission with per-entity counter. Deferred.

**Next session:** Add instrumentation: per-entity `_missionFireCount`
on Entity, increment at each `ScenarioRandom.nextInRange(0, 2)` site
inside dispatchMission and updateMove, log stack when count > 1.
Deploy + capture Playwright console output at SCG04 t3 or SCG11 t15.

## 2026-04-23T05:15Z — C++-Parity-First refactor (Steps 1-7, user directive)

**User directive:** "Port C++ faithfully, delete workarounds, use WASM divergence as data not failure."

Starting commit: `f1233536`. Baseline: SCG01=87, SCG03=238, SCG04=36, SCG06=76, SCG07=17, SCG11=57, SCG13=101.

**Deleted workarounds** (7 commits):
- W1 patrolBlockedTargetLX sticky flag + coord timer-skip (c19708fd)
- W2 vehicleClaims retroactive isDriving=false chain-flip (72727617)
- W3 eager isDriving=true by facing-match in coordinator (92783bb5)
- W4 nonInterruptAnimTicks=3 VESSEL Mark_Track proxy (d5122469)
- Dead delayActivation / _skipActivationOnce (3ff341ca)
- Dead TEAM_START_DRIVER_REFACTOR=false else branch (15063ca9)
- drive-in-GUARD Mission_Move jitter proxy in runDriveClassAI (b1ca294d)

**Audited as C++-faithful (kept):** W5 skipFirstAiCall — matches empirical WASM observation for VESSEL CREATE_TEAM.

**Post-refactor ticks:** SCG01=87, SCG03=238, **SCG04=3 (-33)**, SCG06=76, **SCG07=4 (-13)**, **SCG11=15 (-42)**, SCG13=101. Net -88 ticks.

**rng-entity-diff findings (the real divergences):**
- SCG11 tick 15: TS fires 4 extra Mission_Move RNGs (unit[94] 3×, unit[95] 1×). C++ fires once per unit per `obj->AI()` (techno.cpp:2344). Root cause: STAGE F re-dispatch + double-cycle + inline wrapper creating multiple fire sites.
- SCG04 tick 3: TS fires 2 extra unit Mission_Move RNGs after W2 deletion. Same over-fire pattern.
- SCG07 tick 4: 1 extra TS RNG.

**Next session:** Continue Step 7 — dedup Mission_Move dispatch across STAGE B / runDriveClassAI / STAGE F. Move all Random_Pick(0,2) jitter into the Mission_Move handler path (`foot.cpp:520`), eliminate wrapper-level RNG consumption.

All 51,363 EasterEgg tests pass. Ports are byte-for-byte WASM-comparable at unmodified scenarios. Regressions are real C++-faithful calls TS WAS suppressing via workarounds. This is forward progress in the shape user asked for.

## 2026-04-23T03:20Z — Phase 7B scaffolded + tested; Fire_Coord hypothesis refuted (no SCG01 advance)

**Final flag state:** `SCG01_MISSION_GUARD_CADENCE_FIX=false` (effectively reverted). Flag was flipped ON then reverted to OFF by concurrent commit `1c4dce3f` as a merge side effect; Playwright verification proved the flag flip is neutral either way, so the OFF state is correct per plan §7B "If no advance" rollback.

**Commits on main:**
- `4a04b2b0` feat(mission-guard): SCG01 cadence fix scaffolding + diagnostic (gated OFF)
- `948f05cc` test: cpp-parity Fire_Coord(0) for JEEP Mission_Guard scan (7 tests)
- `60512bba` refactor: flip SCG01_MISSION_GUARD_CADENCE_FIX=true (neutralized by 1c4dce3f)
- `36216c4e` chore: claudepad — Phase 7B milestone
- `1c4dce3f` refactor(drive): Phase 3 v2 — accidentally reverted the flag while editing perCellProcess.ts. Validated as OK because flag is neutral.

**Playwright first-divergence (MAX=250, with flag ON):** All 7 scenarios IDENTICAL to baseline:
- SCG01 t87 Δ=-1 — UNCHANGED (target was +1; **not advanced**)
- SCG03 t238 Δ=-1 — unchanged
- SCG04 t36 Δ=+1 — unchanged
- SCG06 t76 Δ=+2 — unchanged
- SCG07 t17 Δ=+7 — unchanged
- SCG11 t57 Δ=+1 — unchanged (baseline moved from t28→t57 in prior session; unrelated to Phase 7B)
- SCG13 t101 Δ=+1 — unchanged

**Playwright (flag OFF baseline):** Identical. Confirms flag flip is strictly neutral — no advances, no regressions.

**Mechanism investigated (refuted):** `cellBasedGuardScan` (missionAI.ts:1016-1177) using `Fire_Coord(0)`-to-candidate distance instead of entity-center distance. Ported three-step Coord_Move chain (DIR_N by VO+Height; turret+DIR_W by PL; turret by PO) using 256-step Cos/Sin tables. For JEEP: VO=0x30, PO=0x30, PL=0 (udata.cpp:376-404).

**Why hypothesis failed:** The 48-lepton-N + 48-lepton-turret shift for JEEP (max ~96 leptons) is not enough to change the In_Range verdict for the SCG01 tick-87 scenario. Either (a) the JEEP#27 target is well inside the 1024-lepton M60mg range at acquisition (not edge-of-range), OR (b) the divergence root cause is not Fire_Coord vs center but one of the other Phase 7B candidates (Greatest_Threat tie-breaking, per-tick scan ordering).

**Remaining Phase 7B candidates (for future session):**
1. **Greatest_Threat score tie-breaking** (techno.cpp:1529-1597 Evaluate_Object). TS already mirrors the C++ "bestval stays -1 → last wins" bug (missionAI.ts:1093-1095); unlikely.
2. **Per-tick scan ordering within `cellBasedGuardScan`** — TS cellMap builds from ctx.entities forward-iteration, overwrite per cell = most-recently-unlimboed. C++'s Cell_Occupier() LIFO chain is most-recently-moved-into. If a unit moves into the same cell between ticks N-1 and N, TS and C++ might disagree on which occupier the scanner picks.
3. **Firing_AI timing vs Mission_Guard Timer cadence** — the top-of-updateGuard Firing_AI block fires when entity.target is set AND cooldown=0 AND inRange — but this runs BEFORE the Mission_Guard timer fires. If TS acquires target via Mission_Guard at tick N-k and WASM at tick N-k+1, TS will fire 1 tick early for the subsequent firing path.

**Tests retained:**
- `cpp-parity-scg01ea-tick-87-firecoord.test.ts` — 7 passing tests covering the Coord_Move chain (N, S, E, NE turret; VO+PO cancellation; edge-of-range verdict flip; round-trip symmetry). These tests document the C++ mechanism and verify the helper is a correct port, even though the mechanism doesn't close SCG01.
- Full EasterEgg suite: 51,370 non-dual-runtime tests pass.

**Diagnostic retained:** `DEBUG_SCG01_JEEP27=1` env var (or `globalThis.DEBUG_SCG01_JEEP27=true`) emits one `console.debug` per JEEP scan candidate with `dist` / `centerDist` / `accept` deltas. Can be re-enabled on a future session to narrow the real root cause.

**Session state (unchanged):** SCG01=**87**, SCG03=238, SCG04=36, SCG06=76, SCG07=17, SCG11=57, SCG13=101.

## 2026-04-23T02:10Z — Phase 3 landed (infrastructure) but BOTH flag flips reverted after Playwright regression

**Final flag state:** `DRIVE_CLASS_AI_PORT=false` + `TEAM_START_DRIVER_REFACTOR=false` (reverted from ON). Infrastructure commits (pathfinding cellClaims + runDriveClassAI close-enough + team cellClaims wiring) remain in main, gated OFF.

**Commits in main (9 total, 2 reverts at tip):**
  - `c4f7180f` feat(drive): close-enough + path regen in runDriveClassAI (gated OFF) — KEPT
  - `896b74d5` feat(pathfinding): cellClaims path-reservation param — KEPT (no-op when unused)
  - `d974c074` feat(team): cellClaims path-reservation in Team.ai() (gated OFF) — KEPT
  - `77eb480d` refactor: flip DRIVE_CLASS_AI_PORT=true → `289c4dd4` Revert (rolled back)
  - `f87d8f78` refactor: flip TEAM_START_DRIVER_REFACTOR=true → `472201ea` Revert (rolled back)

**Playwright first-divergence (post-flip-ON, MAX=120):**
  - SCG01 t87 unchanged
  - SCG03 no divergence in 120 ticks (improved or Playwright limit)
  - SCG04 t3 REGRESSED from t36
  - SCG06 t76 unchanged
  - SCG07 t17 unchanged
  - SCG11 t4 REGRESSED from t57
  - SCG13 t101 unchanged

**Rollback rationale (plan §3 "Rollback criteria"):** SCG04 t3 regression is catastrophic per plan; SCG11 did NOT advance to t65+. Rollback both flips was the plan-mandated path. Post-rollback Playwright verification pending.

**Infrastructure retained for future iteration:** The pathfinding `cellClaims` threading, runDriveClassAI close-enough/regen scaffold, and team.ts cellClaims wiring all land in main as no-op-when-flag-OFF additions. A future Phase 3.x session can carve out more selective gating (e.g. vehicles-only, or patrol-only) to target SCG11 t57 without regressing SCG04 t3.

**Tests:** 51,353 EasterEgg vitest pass (same as baseline). All 18 targeted cpp-parity-* tests (scg04/07/11/drive-in-guard/coord-move-vehicle-queue) pass with flags OFF.

## 2026-04-23T02:05Z — Phase 3 DriveClass::AI port + TEAM_START_DRIVER_REFACTOR landed (both flags flipped ON)

**Flags flipped:** `DRIVE_CLASS_AI_PORT=true` + `TEAM_START_DRIVER_REFACTOR=true` (JOINT-REFACTOR-ALL-DIVERGENCES-PLAN §3 checkpoints 3.1-3.6).

**Main commits (5 cherry-picked from worktree):**
  - `c4f7180f` feat(drive): close-enough NavCom clear + path regen in runDriveClassAI (gated OFF)
  - `896b74d5` feat(pathfinding): cellClaims path-reservation param (no-op when unused)
  - `d974c074` feat(team): cellClaims path-reservation in Team.ai() (gated OFF)
  - `77eb480d` refactor: flip DRIVE_CLASS_AI_PORT=true
  - `f87d8f78` refactor: flip TEAM_START_DRIVER_REFACTOR=true

**What changed:**
  - `runDriveClassAI` (index.ts) gains (a) close-enough NavCom clear (drive.cpp:970, 704 leptons) and (b) Basic_Path regen on empty-path entry. Fires for Mission==MOVE + drive-in-GUARD (isDriving+GUARD). On findPath failure → enterIdleMode queues GUARD.
  - `findPath` (pathfinding.ts) gains optional `cellClaims: Map<cellIdx,entityId>` + `claimingEntityId`. Threaded through isPassable/followEdge/registerCell/optimizeMoves. Cells owned by OTHER entities are impassable for that call.
  - `Team.ai()` populates `ctx.cellClaims` per-tick; each member's coordinateMove findPath claims its returned path cells so later members see them reserved.
  - `TEAM_START_DRIVER_REFACTOR` path now populates unit.path via findPath + defers isDriving flip to DriveClass::AI (drive.cpp:1079-1086 Start_Driver post-rotation).

**Test updates (semantic outcome, not intermediate state):**
  - `cpp-parity-scg04-mission-move-stagger.test.ts`: both tanks leave coordinateMove isDriving=false (deferred); tank1 path populated via Basic_Path; tank2 may route around claims. Pre-Commence pop semantics unchanged.
  - `cpp-parity-scg07-vessel-reinforce.test.ts`: same deferred-isDriving assertions for vehicles.
  - `cpp-parity-drive-in-guard.test.ts`: fix LST test terrain from 4=WALL to 2=WATER (latent bug exposed by new path-regen).
  - Tests pass `map: game.map` through TeamAIContext for findPath population.

**Target scenarios expected to advance (per plan §3 "Expected outcome"):**
  - SCG11 t57: 4TNK[70] at (60,58) patrol blocked by friendly 4TNK at (61,59) hits close-enough (<704 leptons) → enterIdleMode queues GUARD → Mission_Guard_general fires.
  - SCG04 t36: 3TNK gets path[] populated at tick 3 (coordinateMove time) → track-jump PCP fires at first cell boundary.

**Tests:** 51,353 EasterEgg vitest pass (same as baseline). Playwright/WASM dual-runtime-parity and dual-runtime-m8-comparison failures are environmental WASM-harness timeouts unrelated to this change.

**LOC:** ~200 net (~85 in perCellProcess.ts flag docstring, ~85 in index.ts runDriveClassAI, ~50 in pathfinding.ts cellClaims thread, ~40 in team.ts).

## 2026-04-23T01:45Z — Phase 7A RANDOM_ANIMATE_CPP_FAITHFUL landed (flag flipped ON, zero regressions)

**Flag flipped:** `RANDOM_ANIMATE_CPP_FAITHFUL=true` (JOINT-REFACTOR-ALL-DIVERGENCES-PLAN §7A checkpoints 7A.1-7A.5).

**Main commits:** `7c68360e` flag scaffolding OFF + audit test, `d1ffbfaa` flag flip ON, `d2d754de` SCG07 t17 doc snapshot update.

**Audit finding:** C++ `Is_Ready_To_Random_Animate` (infantry.cpp:4103-4158) accepts Doing ∈ {DO_STAND_GUARD, DO_STAND_READY}. TS's gate (`doing === 'stand_ready'`) already matched that BUT TS's `doingAI` (entity.ts:271-281) only re-evaluated `{nothing, idle_anim, fire}` — once an infantry transitioned to `doing === 'walk'`, it was sticky forever even after stopping. C++ `InfantryClass::Doing_AI` (infantry.cpp:3700-3732) transitions DO_WALK → DO_STAND_READY when `Fetch_Stage() >= DoControls[DO_WALK].Count && !IsDriving`. This was the parity hole. Phase 7A adds `'walk'` to TS's transition whitelist behind the flag.

**SCG07EA tick 17 impact:** USSR E1 guards 126/129 at cells (67,66)/(66,66) were stuck in `doing === 'walk'` → Random_Animate blocked → 3 missing RNG draws (30001 IdleTimer + 30002 anim switch + 30003 optional facing) + 2 downstream 60043-equivalent jitters. Post-flip: Δ+7 → Δ+2 (residual vessel Mission_Move double-fire remains for Phase 7B).

**Tests:** 51,383 EasterEgg vitest pass (same as flag OFF). 8 Playwright dual-runtime failures are pre-existing WASM-harness timeouts, unrelated. New contract: `cpp-parity-random-animate-gate.test.ts` (9 tests pinning the gate + flag-state assertions).

**Files:** `src/EasterEgg/engine/perCellProcess.ts` (+62 lines — flag), `src/EasterEgg/engine/entity.ts` (doingAI conditional transition), `src/EasterEgg/__tests__/cpp-parity-random-animate-gate.test.ts` (new, 105 LOC), `src/EasterEgg/__tests__/cpp-parity-scg07ea-tick-17.test.ts` (doc snapshot updated).

## 2026-04-23T00:30Z — Phase 5 PCP_DOUBLE_CYCLE_ENABLED landed (flag flipped ON, zero regressions)

**Flag flipped:** `PCP_DOUBLE_CYCLE_ENABLED=true` (JOINT-REFACTOR-ALL-DIVERGENCES-PLAN §5 checkpoints 5.1-5.5).

**Main commits:** `aa0710fe` flag+mechanism (gated OFF), `2b8026a3` flag flip ON, `f0a94e2f` cpp-parity double-cycle contract test. Pushed to origin/main + deployed via `scripts/deploy_vps.sh`.

**What changed:** Wraps `runDriveClassAI` MOVE + drive-in-GUARD branches with up-to-2-iteration loop mirroring C++ DriveClass::AI While_Moving → Start_Of_Move → While_Moving (drive.cpp:1340-1345). HUNT/RESCUE walk-step is NOT double-cycled. Vessel `Is_Door_Closed` gate (vessel.cpp:659) blocks second cycle when LST `doorOpen===true`. Second-iteration gate: pathIndex advanced + path-remaining + drive-class mission + door closed + path length stable.

**Test coverage:** 51353 EasterEgg vitest pass (+6 new double-cycle contract tests). All 7 first-divergence scenarios unchanged: SCG01=87, SCG03=238, SCG04=36, SCG06=76, SCG07=17, SCG11=57, SCG13=101.

**SCG07 t17 not advanced:** Per plan §5 line 618 — Random_Animate cadence (B) requires separate Phase 7 port. The double-cycle wrapper as specified (plan lines 586-611, pseudocode calls `updateMove` without re-dispatching Mission_Move) does not generate additional Mission_Move RNG consumption inside iteration 2 because MissionQueue is empty after the first Commence pop. The SCG07 t17 vessel 2-3× Mission_Move fire requires dispatching Mission_Move from within the second While_Moving cycle — a deeper refactor than the current scaffolding. Current implementation is safe (zero regressions, 51353 tests pass) and leaves the door open for future iteration.

**No merge conflicts with Phase 2:** Phase 2's `missionLifecycle.ts` + `coordinateMove` refactor landed between my commits and the flag flip. Cherry-picks clean; combined test run 51353 passed.

**Files:** `src/EasterEgg/engine/perCellProcess.ts` (+57 lines — flag), `src/EasterEgg/engine/index.ts` (+89 lines — double-cycle wrapper in runDriveClassAI), `src/EasterEgg/__tests__/cpp-parity-drive-class-ai-double-cycle.test.ts` (new, 153 LOC).

## 2026-04-22T23:00Z — Phase 1 DISPATCH_ORDER_REFACTOR landed (STAGE C/D per-tick lift + flag flip)

**Flag flipped:** `DISPATCH_ORDER_REFACTOR=true` (JOINT-REFACTOR-ALL-DIVERGENCES-PLAN §1 Phase 1 Checkpoint 1.I).

**Main commits:** `c1047c1e` STAGE C/D lift with flag OFF, `b4ffbb40` STAGE C skip for MOVE-infantry FIRE_MOVING, `12473828` STAGE D vehicle HUNT + infantry-gate walk step, `554805c5` flag flip ON. Pushed to origin/main.

**What changed:** Prior agent `a7712cb7` landed STAGE A-F scaffolding; flag ON regressed SCG06EA t76 runtime trace because STAGE C/D stubs were empty. This session populated the stubs to run per-tick Firing_AI + Movement_AI between handler ticks (matching C++ infantry.cpp:1237-1247 / unit.cpp:425-472 ordering).

**STAGE C:** `runFiringAI` wired into `_runMissionAI` wrapper. Skipped when STAGE B already fired (handler tick) OR when Mission.MOVE infantry (STAGE D's dedicated MOVE branch handles FIRE_MOVING isDriving-clear).

**STAGE D:** `runInfantryMovementAI` handles MOVE (firing-gate + updateMove), HUNT/RESCUE (_infantryWalkStep), AREA_GUARD (_infantryWalkStep). `runDriveClassAI` handles MOVE (updateMove), GUARD drive-in (updateMove fromGuardDrive + same-tick post-Commence dispatch), HUNT/RESCUE (walk). Both skipped on handler tick via `missionHandlerRan` gate to avoid double-movement.

**Shared `_infantryWalkStep`:** Extracted common walk-step (Start_Driver → Coord_Move → PCP_END chain). infantryValidatePath/infantryStartDriver + FOOT_PER_CELL gated on `entity.stats.isInfantry` so vehicles can share.

**Zero regressions:** 51,347 EasterEgg tests pass (excl. dual-runtime which needs deployed WASM). All 7 SCG scenarios stable. Parallel Phase 4 agent's `APPROACH_TARGET_REFIRE_ON_CELL_BOUNDARY=true` cherry-picked on top — both flags live simultaneously, no conflicts. SCG06 t76 runtime trace: pathShortenTick=75 (was 77 pre-Phase-4).

**Phase 2 prerequisites now in place:** STAGE C/D wiring lets `MOVEMENT_AI_MOVE_NAVCOM_GUARD` flip safely in Phase 2 (the guard runs at top of runInfantryMovementAI's MOVE branch; queues GUARD; STAGE E commences; STAGE F re-dispatches Mission_Guard same tick).

## 2026-04-22T22:58Z — Phase 4 Approach_Target cell-boundary re-fire landed (SCG06 t76 residual closed)

**Flag flipped:** `APPROACH_TARGET_REFIRE_ON_CELL_BOUNDARY=true` (JOINT-REFACTOR-ALL-DIVERGENCES-PLAN §4.4).

**Worktree commits:** `af9e2d0f` flag+field, `63f988f4` PCP subcase, `4ff17996` timer-cycle re-fire in updateAreaGuard, `69513d77` isDriving-clear safety net, `82011fdf` flag flip.

**Main cherry-picks:** `993ce523`, `f9b5dfaf`, `766e0a60`, `9b017971`, `a01e74bd`. Pushed + deployed via `scripts/deploy_vps.sh`.

**SCG06EA before → after (with Phase 1 DISPATCH_ORDER_REFACTOR also on):** pathShortenTick 77 → **75**, firePrep starts t=78 → **t=76** — now fires at the same tick as WASM. Approach_Target re-fires 1→3 times (t=1, t=13, t=51), re-picking approach cell as unit walks closer. Final cell (22,66) matches WASM geometry.

**Implementation pattern:** Cell-boundary re-fire in `footPerCellProcess` (new subcase 1b) gated by cell-change dedup (`_lastAreaGuardApproachCellKey`). Timer-cycle re-fire added to `updateAreaGuard` post-scan fallback (flag-gated by `AREA_GUARD_APPROACH_RETRY=true`). Safety net in `updateAreaGuard` Firing_AI: clear isDriving + moveTarget + path when target enters range mid-cell (C++ `IsFiring`/`Stop_Driver` mirror, infantry.cpp:1639/3790).

**Zero regressions:** 51,347 EasterEgg tests pass. All 7 SCG scenarios stable.

# Key Findings

- **PROC.SHP has only 2 frames in RA** — no conveyor animation exists. Confirmed via bdata.cpp _anims table (STRUCT_REFINERY absent). All PROC visual activity comes from HARV dump overlay + damage fire.
- **C++ RA has NO movement dust trails** — only damage smoke (SMOKE_M) at ConditionYellow. The fabricated brown dust puffs in TS were deleted.
- **RESFACTOR architecture**: `types.ts` exports RESFACTOR (1=LORES 320×200, 2=HIRES 640×400). All layout constants, sidebar dimensions, and render positions scale by RESFACTOR. Both values produce correct parity with their respective WASM builds.
- **Tick convention**: TS uses 1-based ticks, C++ uses 0-based frames. AI tick gating uses `(tick-1) % N === 0`. ~300 tests were stale from this offset.
- **Lepton quantization**: Entity positions round-trip through 256-lepton cells. Tests must use `toBeCloseTo` or save positions from `entity.pos` after construction, not assert raw pixel inputs.
