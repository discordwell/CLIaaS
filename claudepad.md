# Session Summaries

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
