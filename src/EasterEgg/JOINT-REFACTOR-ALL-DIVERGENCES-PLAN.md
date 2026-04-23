# JOINT-REFACTOR-ALL-DIVERGENCES-PLAN

**Status:** Design specification for the next major engineering push.

**Execution log (2026-04-23):** Phase 0, 1, 2A/B, 4, 5, 7A, 7B all landed behind flags. Phase 3 v1 flipped ON → cascaded (SCG04 36→3, SCG11 57→4) → reverted. Phase 3 v2 (this repo at `1c4dce3f`) is a C++-faithful rewrite verified against in-repo `drive.cpp:906-1066`. Flipping v2 ON regressed SCG11 57→19 because the v2 path-regen conflicts with the existing W16 sticky-flag close-enough in `updateMove` (~line 6000). A complete Phase 3 v3 must (a) port `drive.cpp:1102` Can_Enter_Cell-failure reactive close-enough, AND (b) disable W16 simultaneously. Flag left OFF.

**C++ source constraint correction:** Full Westwood RA source IS in-repo at `src/EasterEgg/CnC_and_Red_Alert/RA/` (drive.cpp, foot.cpp, team.cpp, findpath.cpp, techno.cpp, infantry.cpp, unit.cpp, mission.cpp, coord.cpp, facing.cpp, cell.cpp, bullet.cpp, etc.). Prior "not in repo" agent claims were based on a narrow `*.cpp` glob miss. Future sessions should read C++ directly instead of relying on training-knowledge reconstructions.



**Scope:** All 7 first-divergences (SCG01=87, SCG03=238, SCG04=36, SCG06=76, SCG07=17, SCG11=57, SCG13=101) in a single coordinated engineering push. Assumes 6-10 engineering sessions. Designed to break the "narrow fix → cascade regression" pattern documented over 20+ prior sessions.

**Brutal honesty upfront:** The 7 divergences do NOT form a single, cleanly resolvable unit. They partition into **three genuinely coupled sub-groups** and **two outliers**. Expect the refactor to eliminate **4-5** of the 7 divergences, meaningfully advance the remaining 2-3, but NOT solve all 7 simultaneously. Every prior session that promised "just one more fix" has regressed because the workaround-fix graph is cyclic. This plan's job is to break the cycles, not to promise the impossible.

---

## Section 1: Architecture audit — the workaround ledger

Every TS workaround listed below was added to close a specific tick-level gap. Each has been documented as "correct for scenario X, blocking for fix Y." These are the ones that must be touched in coordinated groups during the refactor.

### 1.1 Timer-model workarounds (CDTimer semantics)

| # | Workaround | File:line | Patching-over hole |
|---|---|---|---|
| W1 | `missionTimer` decremented at START of `updateEntity` | `index.ts:4068-4070` | C++ `CDTimerClass<FrameTimerClass>` is lazy-computed `Value = DelayTime - (Frame - Started)`. Frame++ runs ONCE at end-of-Main_Loop (conquer.cpp:2542). TS fires when `mt<=0 after --`; C++ fires when `mt===0 before Frame++`. 1-tick internal-semantic offset. |
| W2 | `attackCooldown` / `attackCooldown2` decremented at START | `index.ts:4053-4054` | Same as W1 but for weapon Arm. Cross-entity reads (one entity's Mission_Guard scan reads another's `arm` to score threats) see progressive intra-loop state differing from WASM's batched-at-end Frame++. |
| W3 | `armBeforeScan = attackCooldown` (post-decrement capture) | `missionAI.ts` Mission_Guard Arm-return path | Compensates W2. Correctly reproduces WASM's end-of-tick display `Value` BUT the internal "ticks remaining until fire" is 1 less than WASM's. Manifest: SCG03 t238 Arm-return short-circuit collapses the usually-hidden 1-tick buffer. |
| W4 | `idleAnimTimer`, `nonInterruptAnimTicks` decrement at START | `index.ts:4049, 4074` | Companions to W1/W2. Random_Animate gate reads these; mis-synced decrement order affects which tick Random_Animate fires on. |
| W5 | Two CDTimer end-of-tick refactor attempts reverted | commits `d6db5f97`, `2effbea4` | Both were structurally correct for their target scenario but regressed 3 others because W3/W5.5-style workarounds compensated for the start-of-tick placement. |
| W6 | `triggerRetaliation` team-member early-return | `combat.ts` teamRef branch | Patches around TS firing a rogue Mission_Move jitter when team-member retaliation sets `target`. C++ equivalent: `Team->Took_Damage` only sets team-level target, no individual Assign_Target — different path, same net behavior. |

### 1.2 Movement-dispatch order workarounds

| # | Workaround | File:line | Patching-over hole |
|---|---|---|---|
| W7 | `missionTimerFired` captured BEFORE `updateMove`/`updateAttack` | `index.ts:4071` | C++ `InfantryClass::AI` runs `Firing_AI() → Movement_AI() → MissionClass::AI()` in order (infantry.cpp:1237-1247). TS captures `missionTimerFired` at top of `updateEntity`, BEFORE movement/attack, then dispatches Mission_X handlers AFTER. Means mid-tick PCP_END that pops MissionQueue → Timer=0 is not seen by this-tick's `missionTimerFired` check. |
| W8 | Same-tick post-Commence dispatch in Mission.GUARD case | `index.ts` drive-in-GUARD block (added commit `79b13cb3`) | Fixes SCG11 tick 28 (MCV same-tick Mission_Move jitter). Works ONLY for Mission.GUARD case. Mission.MOVE/AREA_GUARD don't have equivalent post-Commence re-dispatch. |
| W9 | Pre-Commence gate `!isInfantry && !isAirUnit && missionQueue !== null && !isDriving` | `index.ts:4084-4091` | Ports C++ `UnitClass::AI` unit.cpp:406 pre-Commence. Correct for vehicles. But the `!isDriving` gate depends on W13 (team.ts eager isDriving=true) being correct; they are tangled. |
| W10 | Drive-in-GUARD `updateMove(entity, fromGuardDrive=true)` | `index.ts:~4210` | Ports C++ drive.cpp:1376 drives-in-GUARD condition. The `fromGuardDrive` flag suppresses A2-scan and retargets arrival to stay in GUARD. Correct but adds a second `updateMove` path with subtly different invariants. |
| W11 | Mission.MOVE `!moveTarget && !isDriving && missionQueue===null` direct transition to GUARD | `index.ts:4153-4155` | Direct `Mission=GUARD, Timer=0`, not via `missionQueue=GUARD + Commence`. Semantically-equivalent for single tick but misses the Commence `Timer=0` reset guarantee that Section 2 will rely on. |
| W12 | Mission.MOVE infantry Firing_AI-before-updateMove block | `index.ts:4109-4133` | Ports `InfantryClass::AI` infantry.cpp:1237's Firing_AI-before-Movement_AI. Works but locally clears `isDriving` during `updateAttack` then restores — fragile. |

### 1.3 Team-coordinator workarounds

| # | Workaround | File:line | Patching-over hole |
|---|---|---|---|
| W13 | `coordinateMove` eager `unit.isDriving = true` for vehicles | `team.ts:899-965` | C++ Start_Driver sets IsDriving only inside DriveClass::AI AFTER rotation completes (drive.cpp:1079-1086). TS has no drive-in-GUARD → DriveClass::AI equivalent that flips it. This eager set masks the gap. |
| W14 | `vehicleClaims` 2nd-team chain-flip | `team.ts:898-900` | Emulates C++ Basic_Path transient cell reservation for SCG04 tick-3 set1/set2 staggered Mission_Move. Load-bearing for SCG04; vehicle-only; vessels explicitly excluded (W14.5). |
| W14.5 | Vessel exclusion from vehicleClaims | `team.ts:898, 872` | Fixes SCG07 tick 3 LST+PT reinforcement. Vessels use `Is_Door_Closed()` gate instead of `!IsDriving`; vehicleClaims flip doesn't apply. |
| W15 | `coordinatePatrol` infantry direct-assign `mission=MOVE` + `missionTimer=0` | `team.ts:1104-1113` | Should be queue-based (mirror coordinateMove infantry branch) but direct-assign was kept because SCG11EA tick 57 4TNK patrol depends on it (see pinning test). Inconsistency with the infantry MOVE-queue path; cause of SCG11 t57 block. |
| W16 | `coordinatePatrol` `sameBlockedTarget` check skipping `missionTimer=0` reset | `team.ts:1106-1111` | Patches over `updateMove` friendly-blocker clearing moveTarget → re-assignment loop. Load-bearing for SCG11 patrol-blocked 4TNK, but the proper fix is coordinator-level re-entry, not this sticky flag. |
| W17 | `coordinateRegroup` direct `mission = Mission.MOVE` for infantry (`team.ts:801-802`) vs queue for coordinateMove (`team.ts:863-864`) | team.ts | Three different Assign_Mission-equivalent semantics in three coordinators. C++ uses ONE function `Assign_Mission` that always queues. |
| W18 | `skipFirstAiCall` for vessel CREATE_TEAM | `team.ts`, `index.ts` CREATE_TEAM handler | Fixes SCG07 tick 3 — empirical-only (no C++ source found for the vessel-first-tick skip). Documented as fragile. |

### 1.4 Scan / Mission handler workarounds

| # | Workaround | File:line | Patching-over hole |
|---|---|---|---|
| W19 | `cellBasedGuardScan` + weapon `Allowed_Threats` mask | `missionAI.ts:690-870` | Ports C++ subclass Greatest_Threat override. Correct but — E1/E3 mask is ambiguous in source (doc session 2026-04-21T03:30Z). WASM assigns TarCom to regular infantry in some unexplained path; TS now matches behaviorally for 6/7 scenarios. |
| W20 | Random_Animate gated by `entity.isReadyToRandomAnimate()` requiring `doing === 'stand_ready'` | `missionAI.ts` updateGuard / updateAreaGuard | Correct for SCG01/03/06 which depend on the gate. Regresses SCG07 tick 17 where WASM fires Random_Animate unconditionally via foot.cpp:642. |
| W21 | `deferInvisibleScatter` flush at TOP of `Game.update()` | `index.ts` update() entry | Deferred Coord_Scatter RNG from invisible-bullet fires flushes at start of next tick. Correct for SCG03 t267, SCG06. Fragile around `_sourceTag` leak (SCG01 t87 turret fix adds `_sourceTag = 50002` reset before each flush call). |
| W22 | `UnitClass::Can_Fire` FIRE_ROTATING gate | `missionAI.ts updateAttack` | Fixes JEEP#30 non-facing turret at SCG01 t87. Blocks that fire; JEEP#27 (pre-aligned turret) still fires — residual 1-tick divergence. |
| W23 | `updateAreaGuard` temporarily swaps to ATTACK to run Firing_AI | `missionAI.ts:1414-1437` | Ports infantry.cpp:1237 Firing_AI-always. Landed for SCG01 +7. Approach_Target re-call (SCG06 t76) still missing. |
| W24 | `updateAreaGuard` `!other.isPlayerUnit` → `other.house !== ctx.playerHouse` (strict) | `missionAI.ts:1168, 1215` | Fixes SCG07 IsOwnedByPlayer per techno.cpp:624. Left as-is for HUNT/GUARD because applying there regresses SCG04. |
| W25 | `patrolBlockedTargetLX/LY` stickiness | `entity.ts`, `team.ts:1107-1108` | SCG11 patrol 4TNK friendly-blocker → silently sticky moveTarget. Real fix: drive.cpp:970 CloseEnoughDistance NavCom clear with Mission==MOVE gate. |

### 1.5 PCP / Commence workarounds already ported

These are in place but interact with each planned refactor step; documented so the plan can reason about them.

| # | Workaround / Infrastructure | Flag | File:line |
|---|---|---|---|
| I1 | `unitPerCellProcess(PCP_END)` Commence | `PER_CELL_COMMENCE_ENABLED=true` | `perCellProcess.ts:166` |
| I2 | Vehicle track-jump PCP_END | `PER_CELL_TRACK_JUMP_ENABLED=true` | `perCellProcess.ts:190`, dedup via `_commenceFiredBoundaries` |
| I3 | Infantry cell-arrival `footPerCellProcess` | `FOOT_PER_CELL_ENABLED=true` | `perCellProcess.ts:229` |
| I4 | PCP path-shorten for attack missions | `PCP_PATH_SHORTEN_ENABLED=true` | `perCellProcess.ts:253` |
| I5 | AREA_GUARD Approach_Target retry | `AREA_GUARD_APPROACH_RETRY=true` | `perCellProcess.ts:296` |
| I6 | Mission_Move path-failure short-circuit | `MISSION_MOVE_PATH_FAILURE=true` | `perCellProcess.ts:413` |
| I7 | Team Start_Driver refactor (populate path via findPath) | `TEAM_START_DRIVER_REFACTOR=false` | `perCellProcess.ts:352` |
| I8 | Movement_AI MOVE+!NavCom guard | `MOVEMENT_AI_MOVE_NAVCOM_GUARD=false` | `perCellProcess.ts:526` |

---

## Section 2: Unified port sequence

The refactor proceeds in **phases**, each of which atomically touches a workaround cluster and its dependents. Each phase ships as its own commit (or small commit sequence) behind feature flags for fast rollback.

### Sub-grouping of the 7 divergences

Before ordering the phases, identify which divergences share root causes:

**Cluster A — Mission-dispatch ordering + Commence semantics** (4 scenarios):
- SCG01 t87: Mission_Guard JEEP#27 cadence (residual after turret gate fix)
- SCG07 t17: vessel double-Mission_Move + Random_Animate gate + Mission_Guard_E1E3 60043 jitter cadence
- SCG11 t57: 4TNK patrol Coordinate_Move queuing + Commence `!IsDriving && Is_Door_Closed` gate semantics
- SCG13 t101: infantry Movement_AI Mission==MOVE+!NavCom Enter_Idle_Mode guard (tick 99 root cause)

**Cluster B — Approach_Target re-call cadence** (1 scenario):
- SCG06 t76: USSR E1 AREA_GUARD Approach_Target re-firing as unit moves / target moves

**Cluster C — Vehicle Start_Of_Move + track-jump** (1 scenario):
- SCG04 t36: 3TNK track-jump never fires, `path[]` never populates because `updateMove` lazy-path-generates from `moveTarget` not from a proper Start_Driver → Basic_Path chain at coordinateMove time

**Outlier D — CDTimer Arm-return short-circuit** (1 scenario):
- SCG03 t238: ARTY Mission_Guard `Arm != 0` early-return timing. Pure CDTimer-semantic divergence.

---

### Phase Ordering Rationale

The phases MUST be ordered to satisfy these constraints:

1. **Cluster A (SCG01/07/11/13) is the dominant group** — it covers 4 of 7 scenarios and centers on a single architectural concept: Commence-vs-MissionClass::AI dispatch ordering within a single tick. Land it first.
2. **Cluster B (SCG06)** depends on Cluster A's Commence infrastructure for its "Approach_Target re-call at cell-boundary" wiring.
3. **Cluster C (SCG04)** is vehicle-specific and hits the eager-`isDriving=true` workaround (W13). Can be done in parallel with Cluster B but conflicts with the team-coordinator refactor in Cluster A. Must be ordered AFTER Cluster A's team refactor.
4. **Outlier D (SCG03)** CDTimer refactor is isolated from the other clusters if it is done CORRECTLY (single batched end-of-tick pass, not per-entity). But it is hazardous: two prior attempts regressed 3+ scenarios each. Do it LAST, only if time permits, behind a flag.

The proposed order:

```
Phase 0 — Instrumentation + sanity baseline         (all scenarios: no change)
Phase 1 — Mission-dispatch reorder                  (sets up A/B)
Phase 2 — Commence / Enter_Idle_Mode unification    (enables A: SCG13, sets up SCG01/07/11)
Phase 3 — Team coordinator refactor                 (enables A: SCG11, SCG07; conflicts with SCG04)
Phase 4 — Approach_Target re-call                    (enables B: SCG06)
Phase 5 — Vehicle Start_Of_Move / track-jump path-populate (enables C: SCG04)
Phase 6 — CDTimer batched decrement                 (enables D: SCG03, HIGH RISK)
Phase 7 — Residual cleanup + regression tightening
```

---

### PHASE 0 — Instrumentation + baseline

**Goal:** All diagnostic hooks in place before any behavioral change.

**Touches:**
- `scripts/test-rng-entity-diff.ts` — fix `tagName()` to disambiguate tag ranges 200-1999 (house AI) vs 2000-9999 (terrain) vs 10000+ (logic idx fallback). Documented need since 2026-04-20T07:00Z.
- `src/EasterEgg/engine/entity.ts` — already has `speedBudgetConsumed`, `cellBoundaryCrossings`, `_commenceFiredThisTick`, `_commenceFiredBoundaries`. Add:
  - `_missionDispatchTick: number` — logged when mission handler dispatches, for trace.
  - `_commenceTrace: Array<{tick, from, to, reason}>` (DEBUG only) — gated by env flag.
- `src/EasterEgg/engine/perCellProcess.ts` — add `DEBUG_PCP_TRACE` env-gated dump of every call with `(tick, entityId, why, beforeState, afterState)`.
- New WASM instrumentation tags in `agent_harness.cpp`:
  - `g_pcp_call_tag` — set to 80000+pcp_type before every `Per_Cell_Process` call. TS mirror already exists (per entity `_commenceFiredBoundaries`).
  - `g_commence_pop_tag` — set to 80100+popped_mission before every `Commence()` call that actually pops.
  - `g_mission_dispatch_tag` — set to 80200+mission before every `MissionClass::AI` that hits `Timer == 0` branch.
  - `g_enter_idle_tag` — set to 80300 before every `Enter_Idle_Mode` call.
- New TS dump scripts:
  - `scripts/test-dispatch-order.ts` — dumps per-tick sequence of (Commence, MissionClass::AI, Firing_AI, Movement_AI, PCP_END) for a given entity id.
  - `scripts/test-cdtimer-cross-entity-read.ts` — logs every cross-entity `other.attackCooldown` / `other.missionTimer` read during `cellBasedGuardScan`.

**Files changed:** entity.ts, perCellProcess.ts, scripts/*, agent_harness.cpp
**LOC:** ~200 (mostly instrumentation).
**Pinning tests update:** none (flag/env-gated; default behavior unchanged).
**Rollback:** trivial — all gated behind env flags.
**Verification:** all 7 first-divergences unchanged.

---

### PHASE 1 — Mission-dispatch order reorder

**Goal:** Move Firing_AI → Movement_AI → MissionClass::AI in exactly that order, same semantics as C++ `InfantryClass::AI` (infantry.cpp:1237-1247) and `UnitClass::AI` (unit.cpp:425) — with `missionTimerFired` recomputed AFTER movement, not before.

**Root cause coverage:**
- Removes W7 (premature `missionTimerFired` capture). Sets up the mid-tick Commence (from PCP_END) to properly trigger `missionTimerFired` on the same tick.
- Enables SCG13 t101 (because Movement_AI → PCP_END → Enter_Idle_Mode → Commence → MissionQueue=GUARD → next-tick Mission_Guard dispatch works ONLY if the `missionTimerFired` recheck happens AFTER PCP_END).
- Prerequisite for SCG07 t17 vessel double-Mission_Move (VesselClass::AI runs Commence at :593 AND :659 with DriveClass::AI between them — the second Commence can only fire Mission_Move same-tick if dispatch runs after each Commence).

**Design:**

```ts
// updateEntity new structure:
private updateEntity(entity: Entity): void {
  // ... reset per-tick counters (unchanged)

  // Team AI, aircraft state machine, idle timers — unchanged.

  // CDTimer decrement (temporarily unchanged — moved in Phase 6).
  if (entity.missionTimer > 0) entity.missionTimer--;
  if (entity.attackCooldown > 0) entity.attackCooldown--;
  // ... etc

  // STAGE A: Pre-MissionClass::AI Commence (vehicles only, unit.cpp:406).
  if (!entity.stats.isInfantry && !entity.isAirUnit &&
      entity.missionQueue !== null && !entity.isDriving &&
      !entity.isFiringAnim && entity.nonInterruptAnimTicks <= 0) {
    runCommence(entity, 'pre-MissionClass::AI');  // mission=queue, queue=null, mt=0
  }

  // STAGE B: MissionClass::AI — dispatch if Timer==0.
  // This replaces the old top-level `missionTimerFired` capture.
  let missionHandlerRan = false;
  if (entity.missionTimer === 0) {  // C++: if (Timer == 0) Timer = Mission_X()
    dispatchMission(entity);  // routes to updateGuard/updateMove/updateAttack/updateAreaGuard
    missionHandlerRan = true;
  }

  // STAGE C: Firing_AI (every tick, all missions — C++ infantry.cpp:1237 / unit.cpp:425)
  // Currently scattered across missionAI handlers. Lift to per-tick call here.
  runFiringAI(entity);

  // STAGE D: Movement_AI — runs every tick when applicable.
  if (entity.isAirUnit) {
    // aircraft handled by _runAircraft above
  } else if (entity.stats.isInfantry) {
    runInfantryMovementAI(entity);  // includes cell-arrival PCP_END chain
  } else if (!entity.isAirUnit) {  // vehicle/vessel
    runDriveClassAI(entity);  // includes PCP_DURING/PCP_END via While_Moving
  }

  // STAGE E: Post-Movement_AI Commence (vehicles, unit.cpp:472; vessels :658).
  // Infantry: the only Commence point (infantry.cpp:1208-1211).
  runPostMovementCommence(entity);

  // STAGE F: re-dispatch if Commence just popped and Timer is now 0.
  // This is the same-tick post-Commence dispatch extraction from current
  // drive-in-GUARD Mission.GUARD block (commit 79b13cb3) — generalized to
  // all missions.
  if (!missionHandlerRan && entity.missionTimer === 0) {
    dispatchMission(entity);
  }
}
```

**Details:**
- `dispatchMission(entity)` is a new function that routes on current `entity.mission` to the existing `updateMove`/`updateGuard`/`updateAttack`/`updateAreaGuard` handlers. It encapsulates the old switch block.
- `runFiringAI(entity)` is lifted from the inline Mission.MOVE Firing_AI-before-updateMove block (W12) and generalized to run for all missions. When `firePrepActive` is set, it ticks `firePrepStage` (already done) and flushes on FireLaunch.
- `runInfantryMovementAI` invokes the existing `updateMove` path for `Mission.MOVE` OR the drive-in-GUARD equivalent for `Mission.GUARD` with `moveTarget`. Critically, it wires `footPerCellProcess(PCP_END)` at cell-arrival with the four Enter_Idle_Mode guards.
- `runDriveClassAI` invokes the existing `updateMove(entity, fromGuardDrive=?)` path with the correct `fromGuardDrive` flag.

**What this removes:**
- W7 (top-level `missionTimerFired` capture)
- W8 (special-case Mission.GUARD post-Commence dispatch — now generalized to all missions via STAGE F)
- W11 (direct Mission=GUARD transition — replaced by proper queue+Commence path)
- W12 (inline Firing_AI-in-MOVE — replaced by STAGE C)

**What this depends on (keep as-is, gated):**
- I1, I2, I3, I4, I5, I6 (all PCP flags remain ON; their wire points move into STAGE D's PCP chains)

**What this enables (for later phases):**
- Phase 2's MOVEMENT_AI_MOVE_NAVCOM_GUARD flag flip is now safe because the guard runs at the TOP of STAGE D (runInfantryMovementAI); when it queues GUARD, STAGE E's post-Commence pops it, STAGE F re-dispatches Mission_Guard same-tick.

**Files touched:**
- `src/EasterEgg/engine/index.ts` — major rewrite of `updateEntity` switch block. ~200-300 LOC restructured.
- `src/EasterEgg/engine/missionAI.ts` — lift Firing_AI check into standalone function. ~50 LOC.
- `src/EasterEgg/engine/perCellProcess.ts` — docstring updates; no behavior change.

**Pinning tests to update:**
- `cpp-parity-same-tick-post-commence-dispatch.test.ts` — update assertions to reflect generalization (not just Mission.GUARD).
- `cpp-parity-scg11ea-tick-28.test.ts` — already asserts same-tick post-Commence; should pass.
- `cpp-parity-scg13ea-tick-99-pcp.test.ts` — add assertion that STAGE F re-dispatches Mission_Guard when MOVEMENT_AI_MOVE_NAVCOM_GUARD flips on in Phase 2.
- `cpp-parity-scg06ea-tick-68.test.ts` — Firing_AI-in-MOVE moves from inline to STAGE C; assertion about `firePrepActive` firing at tick 66 should still hold.
- `cpp-parity-scg01ea-tick-80.test.ts` — FIRE_MOVING gate in infantry Can_Fire; moves into `runFiringAI`; assertions should still hold.

**Feature flag:** `DISPATCH_ORDER_REFACTOR` — ships OFF. Flipped ON in a single commit once STAGE A-F all behave correctly.

**Rollback criteria:**
- Any scenario regresses > 2 ticks → flip flag OFF.
- `cpp-parity-drive-in-guard.test.ts` must pass.
- `cpp-parity-scg04-mission-move-stagger.test.ts` must still pass (Stage A pre-Commence reads vehicleClaims-flipped isDriving correctly).

**Expected outcome:**
- SCG13 t101: advances (tick 99 guard fires via MOVEMENT_AI_MOVE_NAVCOM_GUARD flip in Phase 2).
- SCG01/03/04/06/07/11: unchanged (reorder is semantically equivalent for their current paths).

**LOC:** ~400 touched, ~250 net new/modified.

**Risk:** HIGH. This is the largest structural change in the plan.

---

### PHASE 2 — Commence / Enter_Idle_Mode unification

**Goal:** Make all `Assign_Mission`-equivalent calls go through a single `assignMission()` that queues via `missionQueue`, never direct-writes `mission`. Make all `Commence()` calls go through a single helper that also resets `missionTimer=0` and `Status=0`-equivalents. Make `Enter_Idle_Mode` a proper function that queues GUARD or AREA_GUARD based on `guardOrigin`.

**Root cause coverage:**
- Removes W11 (direct Mission=GUARD transition).
- Removes W15 (coordinatePatrol direct-assign).
- Removes W17 (coordinateRegroup direct-assign inconsistency).
- Partially removes W19 (dispatchMission now consistent across scan types).
- Enables flipping `MOVEMENT_AI_MOVE_NAVCOM_GUARD` → true (SCG13 t101).

**Design:**

```ts
// engine/missionLifecycle.ts (NEW module)
export function assignMission(entity: Entity, mission: Mission): void {
  // C++ mission.cpp:379-390 Assign_Mission — queues via MissionQueue.
  if (entity.mission === mission) {
    entity.missionQueue = null;  // no-op if already in that mission
    return;
  }
  entity.missionQueue = mission;
}

export function commence(entity: Entity, reason: string): boolean {
  // C++ mission.cpp:343-359 Commence — pops queue, Timer=0, Status=0.
  if (entity.missionQueue === null) return false;
  entity.mission = entity.missionQueue;
  entity.missionQueue = null;
  entity.missionTimer = 0;
  // Status equivalent: for infantry, Doing=0 for MOVE? Check infantry.cpp:912-914
  // NOT reset in Commence — only after entering idle. Skip for now.
  // DEBUG_TRACE
  if (DEBUG_COMMENCE_TRACE) entity._commenceTrace?.push({tick, from, to: entity.mission, reason});
  return true;
}

export function enterIdleMode(entity: Entity): void {
  // C++ infantry.cpp:1663-1721 — pick GUARD vs AREA_GUARD, queue via assignMission.
  // NOT a direct mission write.
  const target = entity.guardOrigin != null ? Mission.AREA_GUARD : Mission.GUARD;
  assignMission(entity, target);
}
```

All existing sites that do `entity.mission = X; entity.missionTimer = 0;` are replaced with `assignMission(entity, X); commence(entity, 'site-description');` — or, where the semantic intent is "Commence only when eligible per Phase 1 STAGE A gate," just `assignMission`.

**Team coordinator updates (foundation for Phase 3):**

```ts
// team.ts coordinateMove (replaces W13+W14+W15 partially):
coordinateMove(...) {
  for (const unit of this._members) {
    if (!unit.alive || unit.mission === Mission.RETREAT) continue;
    const dist = ...;
    if (dist > stray) {
      assignMission(unit, Mission.MOVE);  // queue
      unit.moveTarget = { ...targetLepton };
      // DO NOT set isDriving. Let DriveClass::AI (Phase 5) handle.
      // vehicleClaims retained for Phase 5.
    }
  }
}

coordinatePatrol(...) {
  for (const unit of this._members) {
    ...
    if (dist > stray) {
      assignMission(unit, Mission.MOVE);  // queue, not direct.
      unit.moveTarget = { ...targetLepton };
    }
  }
}

coordinateRegroup(...) {
  // Same assignMission pattern.
}
```

**Flip:** `MOVEMENT_AI_MOVE_NAVCOM_GUARD = true` in `perCellProcess.ts`. This is the top-of-Movement_AI guard for `Mission === MOVE && !Target_Legal(NavCom)` that queues GUARD via Enter_Idle_Mode.

**Gate the flip:** requires Phase 1 landed, all 7 scenarios pass current pins.

**Expected outcome:**
- SCG13 t101: **advances to at least ~120** (tick 99 guard fires MOVEMENT_AI_MOVE_NAVCOM_GUARD, queue GUARD, STAGE E Commence pops, STAGE F dispatches Mission_Guard at tick 100, Arm_Delay Random_Pick at tick 101 matches WASM).
- SCG11 t57: partial improvement — Coordinate_Move queue now correct, but still missing drive.cpp:970 close-enough clear (Phase 3).
- SCG01/03/04/06/07: unchanged or marginally improved (some previously eager-direct-assign sites no longer fire stale RNG).

**What this breaks (temporary regression risk):**
- Any test that asserts `mission === X` immediately after team coordinator call — must update to assert `missionQueue === X` OR wait one dispatch cycle.
- `cpp-parity-coord-move-vehicle-queue.test.ts` — should still pass (it already asserts queue).
- SCG04 t3 stagger: W14 vehicleClaims retained; should still pass.

**Files touched:**
- NEW `src/EasterEgg/engine/missionLifecycle.ts` (~100 LOC).
- `src/EasterEgg/engine/team.ts` — coordinateMove, coordinatePatrol, coordinateRegroup all use `assignMission`. (-30 LOC cleanup, +10 LOC callthrough.)
- `src/EasterEgg/engine/index.ts` — all `entity.mission = X; entity.missionTimer = 0;` → `assignMission + commence`. ~40 sites.
- `src/EasterEgg/engine/missionAI.ts` — `setMissionIdle()` helper routes through `enterIdleMode`. ~5 sites.
- `src/EasterEgg/engine/perCellProcess.ts` — flip `MOVEMENT_AI_MOVE_NAVCOM_GUARD = true`.

**Pinning tests to update:**
- `cpp-parity-scg13ea-tick-99-pcp.test.ts` — flip `expect(MOVEMENT_AI_MOVE_NAVCOM_GUARD).toBe(false)` → `.toBe(true)`. Update the "TS: entity id=109 end-of-tick-99 currently has MissionQueue=null (pre-fix)" test to assert `MissionQueue='GUARD'` post-fix.
- `cpp-parity-scg13ea-tick-101-fix.test.ts` — similar: assertions about TS post-tick-99 state transition to match WASM.
- `cpp-parity-coordinate-do-assign-mission.test.ts` (if exists) — all team coordinators now queue.

**Feature flag:** `MISSION_LIFECYCLE_UNIFIED` plus the flipped `MOVEMENT_AI_MOVE_NAVCOM_GUARD`. Initial commit ships with `MISSION_LIFECYCLE_UNIFIED = true` but `MOVEMENT_AI_MOVE_NAVCOM_GUARD = false`. Second commit flips NAVCOM_GUARD.

**Rollback criteria:**
- SCG01 t87 regresses — document then flip NAVCOM_GUARD back to false.
- SCG03 / SCG06 / SCG07 regress > 2 ticks → revert commits in this phase.
- The unified `assignMission` itself should be regression-free (semantically-equivalent dispatch + queue) — if it isn't, it's a bug not a design issue.

**LOC:** ~300 net.
**Risk:** MEDIUM-HIGH. Multi-site change. Main risk is breaking team coordinator tests.

---

### PHASE 3 — Team coordinator + Drive-in-GUARD NavCom-clear

**Goal:** Port C++ `DriveClass::AI`'s full per-tick handling:
- (a) `Start_Of_Move` + `Basic_Path` generation for vehicles with NavCom (SCG04 root cause).
- (b) drive.cpp:970 "close-enough" NavCom clear when `Mission == MISSION_MOVE` (SCG11 t57 patrol-blocked).
- (c) Path-reservation semantics replacing W14 vehicleClaims.

**Root cause coverage:**
- Removes W13 (eager isDriving=true) — now DriveClass::AI sets it via Start_Driver after rotation completes.
- Replaces W14 (vehicleClaims chain-flip) with proper path-reservation via per-cell occupancy-claim map that resolves in a way that matches C++ Basic_Path's friendly-blocker behavior.
- Removes W16 (patrolBlockedTargetLX sticky flag) — close-enough NavCom clear does the right thing.
- Removes W25 (same as W16).
- Enables SCG04 t36: vehicle track-jump PCP fires correctly because `path[]` is populated at coordinateMove time.
- Enables SCG11 t57: patrol 4TNK hits close-enough, NavCom clears, Mission_Guard_general fires at expected tick.

**Design:**

```ts
// team.ts coordinateMove final:
coordinateMove(...) {
  for (const unit of this._members) {
    if (!unit.alive || unit.mission === Mission.RETREAT) continue;
    if (dist > stray) {
      assignMission(unit, Mission.MOVE);
      unit.moveTarget = { ...targetLepton };

      // C++ Basic_Path precomputation — mirrors Start_Driver path allocation.
      if (unit.path.length === 0 && ctx?.map) {
        const destCell = { cx: tcx, cy: tcy };
        const path = findPath(ctx.map, unit.cell, destCell, ...);
        if (path.length > 0) {
          unit.path = path;
          unit.pathIndex = 0;
        }
      }
      // NO isDriving flip. DriveClass::AI will set it.
    }
  }
}
```

```ts
// index.ts runDriveClassAI (called from STAGE D in Phase 1):
function runDriveClassAI(entity: Entity) {
  if (!entity.moveTarget) return;
  
  // Close-enough clear (drive.cpp:970): if distance to NavCom < CloseEnoughDistance
  // AND Mission == MOVE, clear NavCom and setMissionIdle. Does NOT fire jitter.
  if (entity.mission === Mission.MOVE) {
    const dist = leptonDist(entity.leptonX, entity.leptonY, entity.moveTarget.lx, entity.moveTarget.ly);
    const closeEnough = CLOSE_ENOUGH_DISTANCE; // 0x180 leptons = 1.5 cells
    if (dist < closeEnough) {
      entity.moveTarget = null;
      entity.path = [];
      entity.pathIndex = 0;
      // Enter_Idle_Mode via standard path (queue GUARD, Commence pops).
      enterIdleMode(entity);
      return;
    }
  }

  // Path regeneration if empty or blocked.
  if (entity.path.length === 0 || entity.pathIndex >= entity.path.length) {
    const path = findPath(this.map, entity.cell, destCell, ...);
    if (path.length === 0) {
      // Basic_Path failed — Enter_Idle_Mode.
      enterIdleMode(entity);
      return;
    }
    entity.path = path; entity.pathIndex = 0;
  }

  // Call existing followTrackStep-style movement, which flips isDriving=true
  // when rotation aligns.
  updateMove(entity, fromGuardDrive=false);

  // PCP_END fires at cell-boundary in followTrackStep.
}
```

**What this removes:**
- W13, W14 (eager isDriving)
- W14.5, W15, W16, W25 (patch flags)
- SCG04-specific stagger workaround — replaced by path-reservation check at `findPath` that treats recently-claimed cells by other team members as blocked.

**Path-reservation design (replaces W14 chain-flip):**

In `findPath(map, start, dest, ...)`, add an optional `cellClaims: Map<number, entityId>` parameter. When set, cells in the map are treated as impassable (like friendly-blocker) UNLESS `start` is the claiming entity's cell. This matches C++ Basic_Path's transient reservation: each team member's pathfinding sees a slightly different map depending on order of processing.

Populate `cellClaims` at the start of each Team's `ai()` call; each member's pathfinding claims its destination cell. Second-team members target the same cell; their findPath sees the first member's claim and picks a different (or empty) path.

**Flip:** `TEAM_START_DRIVER_REFACTOR = true`.

**Expected outcome:**
- SCG04 t36: **advances to ≥38** — 3TNK at (42,35) with speed=7% now has `path[]` populated at tick 3 (coordinateMove time). Track-jump PCP fires at first cell boundary. Mission_Move_foot jitter fires at tick 3 matching WASM.
- SCG11 t57: **advances to ≥65** — 4TNK patrol: move to (62,59) blocked by friendly 4TNK, drive.cpp:970 close-enough clears NavCom at distance < 384 leptons, setMissionIdle → GUARD, Mission_Guard_general Random_Pick fires at tick 57 matching WASM.
- SCG07 t17: vessel Mission_Move + Random_Animate + 60043 cadence — may advance if vessel double-Commence in DriveClass::AI re-entrant loop is modeled here.

**What this risks:**
- SCG04 t3 stagger — depends on vehicleClaims chain-flip being replaced with path-reservation correctly. The first-team-succeeds, second-team-blocked semantics MUST match exactly. Expect test failures on `cpp-parity-scg04-mission-move-stagger.test.ts` and update assertions once behavior verified.
- SCG05 LST+SPY delivery — LST is a vessel, exempt from vehicleClaims; but the `path[]` population at coordinateMove time is new and LST pathfinding with water-only speedClass needs to work correctly.
- Any vehicle that used to depend on `eager isDriving=true` from coordinateMove suppressing pre-Commence now needs STAGE A pre-Commence to pop normally.

**Files touched:**
- `src/EasterEgg/engine/team.ts` — coordinateMove cleanup, path-population. ~60 LOC.
- `src/EasterEgg/engine/index.ts` — runDriveClassAI close-enough clear + path-regen. ~80 LOC.
- `src/EasterEgg/engine/pathfinding.ts` (or wherever findPath lives) — cellClaims param. ~30 LOC.
- `src/EasterEgg/engine/entity.ts` — remove `patrolBlockedTargetLX/LY` fields (deprecated).

**Pinning tests to update:**
- `cpp-parity-scg04-mission-move-stagger.test.ts` — update assertions from `tank2.isDriving=true` (eager) to `tank2.isDriving=false` with `tank2.path.length === 0` (second-team path-reservation-blocked). The semantic outcome (second tank's Mission_Move fires at the correct tick via proper path-blocked → retry cycle) must still hold.
- `cpp-parity-scg07-vessel-reinforce.test.ts` — similar update. Vessels already excluded.
- `cpp-parity-scg11ea-t57.test.ts` — flip docstring "architectural blocker" → pass.
- `cpp-parity-coord-move-vehicle-queue.test.ts` — assertions may need update.
- `cpp-parity-drive-in-guard.test.ts` — new drive-in-GUARD flow via runDriveClassAI.

**Feature flag:** `TEAM_START_DRIVER_REFACTOR` flipped ON. `DRIVE_CLASS_AI_PORT` is a new flag gating the close-enough + path-regen logic.

**Rollback criteria:** This phase has the highest cascade risk. If SCG04 t3 regresses AT ALL, revert the vehicleClaims change and keep the flipped flag only for the subset of coordinators (infantry/patrol) where it doesn't touch vehicleClaims.

**LOC:** ~200 net.
**Risk:** HIGH. Vehicle movement is the most-heavily-used code path.

---

### PHASE 4 — Approach_Target re-call (SCG06 t76)

**Goal:** Implement C++ `foot.cpp:1082-1084` — every Mission_Guard_Area timer cycle, if `Target_Legal(TarCom)`, call `Approach_Target()` which regenerates the approach-cell destination based on current entity + target positions.

**Root cause coverage:**
- Enables SCG06 t76 (and future AREA_GUARD scenarios): unit walks toward moving target, approach cell drifts as target moves.

**Design:**

```ts
// missionAI.ts updateAreaGuard — ALREADY has Approach_Target call (landed e552d0c7).
// Gap: currently only re-fires on initial scan (when no moveTarget).

// Post-Phase 1/2/3, with AREA_GUARD_APPROACH_RETRY = true (already on),
// the re-fire logic is wired at cell-boundary in footPerCellProcess PCP_END
// AND at Mission_Guard_Area timer cycle.

// Add new sub-case in footPerCellProcess Phase 1: re-fire Approach_Target
// when:
//   1. entity.mission === AREA_GUARD
//   2. entity.target?.alive === true
//   3. entity crossed a cell boundary this tick (tracked via cellBoundaryCrossings)
//   4. entity.cell !== entity._lastApproachCellKey
function footPerCellProcess_approachRefire(entity, ctx) {
  if (!AREA_GUARD_APPROACH_RETRY) return;
  if (entity.mission !== Mission.AREA_GUARD) return;
  if (!entity.target?.alive) return;
  const cellKey = `${entity.cell.cx},${entity.cell.cy}`;
  if (entity._lastAreaGuardApproachCellKey === cellKey) return;
  entity._lastAreaGuardApproachCellKey = cellKey;
  // Re-invoke approachTarget with current entity+target positions.
  approachTarget(ctx, entity, entity.target);
}
```

Also add the same re-fire at the top of `updateAreaGuard` when `missionTimerFired` AND `hadTargetAtEntry`, independent of whether a new target was scanned.

**Additional concern (SCG06 t76 specific):**

Per `cpp-parity-scg06ea-tick-76-path.test.ts`, the sweep math at initial call correctly produces cell (20,66). WASM's tick-76 fire cell (22,65) has distance 608 > 585 (out of range) — it cannot be an initial sweep result. WASM must be re-calling Approach_Target after the entity has walked (lepton position changed → dir256 rotated → new sweep selects different cell).

The re-fire at cell-boundary changes `entity.leptonX/Y`, which shifts `dir256` computation (`directionToLeptons256(target → entity)`). Expected: after USSR E1 walks from (24,67)→(23,67), dir256 rotates ~8 ticks, sweep at range=585 angle +24 might now be valid and select a cell closer to (22,65). This needs empirical validation via a SCG06 re-run with PCP_APPROACH_REFIRE flag on.

**Expected outcome:**
- SCG06 t76: **advances to ≥85** if the re-fire geometry matches WASM. Could advance to 100+ if the whole AREA_GUARD walk alignment holds.
- Others: unchanged (AREA_GUARD-only code path; gated by mission).

**Files touched:**
- `src/EasterEgg/engine/perCellProcess.ts` — new `footPerCellProcess_approachRefire` sub-case in the FOOT_PER_CELL_ENABLED chain.
- `src/EasterEgg/engine/missionAI.ts updateAreaGuard` — timer-fire-time re-fire path.
- `src/EasterEgg/engine/entity.ts` — ensure `_lastAreaGuardApproachCellKey` field exists (already does).

**Pinning tests to update:**
- `cpp-parity-scg06ea-tick-76-path.test.ts` — should continue to pass (sweep geometry unchanged).
- `cpp-parity-scg06ea-tick-76.test.ts` — may need update if first-fire tick shifts from 80 to 76.
- `cpp-parity-scg06ea-t76-trace-runtime.test.ts` — may need update.
- New test: `cpp-parity-approach-target-refire.test.ts` — pins the cell-boundary re-fire behavior.

**Feature flag:** `AREA_GUARD_APPROACH_RETRY` already ON. Add `APPROACH_TARGET_REFIRE_ON_CELL_BOUNDARY` for the new cell-boundary path.

**Rollback criteria:** If SCG06 actually regresses OR if SCG01/07 (which also use AREA_GUARD) regress, flip the new flag off.

**LOC:** ~60 net.
**Risk:** MEDIUM. Narrow scope but geometry-sensitive.

---

### PHASE 5 — Vehicle Start_Of_Move + track-jump path populate + vessel double-Commence

**Goal:** Port the remaining vehicle-specific C++ drive.cpp behaviors not covered in Phase 3:
- (a) `drive.cpp:1340-1345` double-cycle: when current track completes with more path remaining, re-enter While_Moving within the same tick.
- (b) Vessel-specific `Is_Door_Closed()` gate that allows two Commence calls per VesselClass::AI tick (vessel.cpp:593, 659).

**Root cause coverage:**
- SCG07 t17 vessel double Mission_Move (vessels 182 + 183 firing 2-3× per tick).
- SCG11 t28 MCV double-fire (already advanced to tick 32/57 via earlier fixes, but residual double-fire unexplained).

**Design:**

```ts
// index.ts runDriveClassAI — add double-cycle:
function runDriveClassAI(entity: Entity) {
  // ... close-enough + path-regen (Phase 3)

  let cyclesThisTick = 0;
  while (cyclesThisTick < 2) {  // C++ max 2 cycles per drive.cpp:1340-1345
    const prevPathIndex = entity.pathIndex;
    updateMove(entity, fromGuardDrive=isDrivingInGuard);
    cyclesThisTick++;
    
    // Track-complete condition: pathIndex advanced AND still has path left.
    // C++: While_Moving returns true when TrackNumber != -1 and vehicle
    // continues; when current sub-track ends with more path, Start_Of_Move
    // re-engages.
    if (entity.pathIndex > prevPathIndex &&
        entity.pathIndex < entity.path.length &&
        /* cell-boundary just crossed */) {
      // PCP_END already fired inside updateMove. Second cycle allowed.
      // For vessels with IsDoorClosed=true, second Commence is ADDITIONAL.
      continue;
    }
    break;
  }
}
```

For vessels, add the Is_Door_Closed gate: vessels maintain `doorState` (not yet ported). When doors are closed, VesselClass::AI fires two Commence bookends per tick. When open (unloading), only pre-Commence fires.

**Expected outcome:**
- SCG07 t17: vessels now fire Mission_Move up to 2-3× per tick via the double-cycle. This alone closes (A) from the tick-17 test (the 5 extra vessel Mission_Move RNG). Partial advance expected.
- Random_Animate cadence (tick-17 (B)): NOT covered by this phase — requires separate Random_Animate gate refactor in Phase 7.
- SCG11: unchanged past current t57 (tick 32 → 57 already landed).
- SCG04 t36: further advance if 3TNK has a short 2-cell track that chain-engages.

**Files touched:**
- `src/EasterEgg/engine/index.ts` — `runDriveClassAI` double-cycle wrapping.
- `src/EasterEgg/engine/perCellProcess.ts` — `PCP_DOUBLE_CYCLE_ENABLED` flag.
- `src/EasterEgg/engine/entity.ts` — vessel `doorState` field (if needed).

**Pinning tests:**
- `cpp-parity-scg11ea-tick-28.test.ts` + `cpp-parity-scg11ea-tick-28-proxy.test.ts` — may need assertion update from "TS fires 0 at tick 28" to "TS fires 3 at tick 28".
- `cpp-parity-scg07ea-tick-17.test.ts` — update the "TS fires 3 vessel jitters instead of 5" assertion to reflect the double-cycle fix.
- NEW test `cpp-parity-drive-class-ai-double-cycle.test.ts` — pins the two-cycle-per-tick contract.

**Feature flag:** `PCP_DOUBLE_CYCLE_ENABLED` — OFF initially; flip ON once Phase 1-4 baseline is verified.

**Rollback criteria:** Any non-SCG07/11 scenario regression → flip off.

**LOC:** ~80 net.
**Risk:** MEDIUM. Narrow scope, clear C++ reference.

---

### PHASE 6 — CDTimer batched end-of-tick decrement (SCG03 t238)

**Goal:** Match C++ `CDTimerClass<FrameTimerClass>` lazy-compute + single-Frame++ at end-of-Main_Loop. The two prior attempts regressed 3 scenarios each; this attempt succeeds ONLY if Phase 1-5 have removed the workarounds (W3 etc.) that compensated for start-of-tick decrement.

**CRITICAL:** Do not attempt this phase until Phase 1-3 are fully landed and all 7 scenarios are verified green. The workarounds this is "patching over" are in fact the mechanism that lets other scenarios work with start-of-tick semantics.

**Root cause coverage:**
- SCG03 t238 Arm-return short-circuit.
- Potential advance on other scenarios if current Arm/Timer reads happen to be off-by-one.

**Design:**

```ts
// Game.update():
//   ... entity loop (Phase 1-5 ordering)
//   ... post-entity processing (deaths, team cleanup)
//   
//   // BATCHED CDTimer decrement — C++ Frame++ equivalent (conquer.cpp:2542).
//   decrementAllTimers();

function decrementAllTimers() {
  for (const entity of this.entities) {
    if (!entity.alive) continue;
    if (entity.missionTimer > 0) entity.missionTimer--;
    if (entity.attackCooldown > 0) entity.attackCooldown--;
    if (entity.attackCooldown2 > 0) entity.attackCooldown2--;
    if (entity.idleAnimTimer > 0) entity.idleAnimTimer--;
    if (entity.nonInterruptAnimTicks > 0) entity.nonInterruptAnimTicks--;
    // Repair_AI timer decrement — already at this phase (from SCG06 prior fix).
  }
}

// updateEntity — REMOVE all timer decrements at start.
// Fire conditions flip from `mt<=0 after --` to `mt===0 before --`:
let missionHandlerRan = false;
if (entity.missionTimer === 0) {  // ← was "entity.missionTimer <= 0 after --"
  dispatchMission(entity);
}
```

Every Firing_AI / cooldown check that reads another entity's `attackCooldown` during cellBasedGuardScan now sees the **pre-decrement** value consistently. This matches WASM's `Arm.Value()` at Logic.AI time (pre-Frame++).

**Expected outcome:**
- SCG03 t238: **advances to ≥260** — Arm-return short-circuit now fires at tick 239 with Arm=64, matching WASM.
- Other scenarios: MAY advance further if hidden off-by-one bugs are exposed, OR MAY regress if W3-style post-decrement-capture workarounds in other files are now incorrect. Need exhaustive audit.

**Files touched:**
- `src/EasterEgg/engine/index.ts` — remove timer decrements at top of `updateEntity`. Add `decrementAllTimers` call after entity loop. Flip fire conditions to `=== 0`.
- `src/EasterEgg/engine/aircraft.ts` — ensure Arm decrement moves to batched pass.
- `src/EasterEgg/engine/missionAI.ts` — `armBeforeScan` captures the live (pre-decrement) value directly; remove `+1` adjustments if any.
- Every test asserting intermediate timer values: review ~50 tests, possibly update.

**Pinning tests to update:**
- `cpp-parity-scg03ea-tick-238.test.ts` — flip "currently diverges" assertions to "matches WASM".
- `cpp-parity-cdtimer-end-of-tick.test.ts` — re-enable (was reverted).
- `cpp-parity-cdtimer-batched-decrement.test.ts` — re-enable.
- 40-50 other tests that may assert specific timer values at specific ticks.

**Feature flag:** `CDTIMER_BATCHED_DECREMENT` — OFF initially. Only flip ON after a focused 3-day effort validating all pinned tests.

**Rollback criteria:** If ANY scenario regresses > 5 ticks, revert. The prior attempts regressed 3 scenarios by 65-228 ticks each. This time should be cleaner because Phase 1-3 eliminated the start-of-tick-decrement compensating workarounds; but "should" is not "will."

**LOC:** ~50 net (deletion + relocation).
**Risk:** VERY HIGH. Two prior reverts.

---

### PHASE 7 — Residual cleanup

**Goal:** Tackle the remaining SCG07 t17 (B) Random_Animate gate divergence and SCG01 t87 residual, both of which are not covered by prior phases.

#### 7A — Random_Animate gate (SCG07 t17)

**C++ reference:** `FootClass::Mission_Guard` foot.cpp:642-644 — unconditional Random_Animate when no target found.

**TS gate:** `entity.isReadyToRandomAnimate()` requires `doing === 'stand_ready'`.

**Design:**

Port `InfantryClass::Is_Ready_To_Random_Animate` exactly from C++ (which appears looser). Per infantry.cpp:1742-1838 Random_Animate is called with specific `Doing` state checks that may not be as restrictive as TS's `stand_ready`. Audit the exact C++ gate conditions and replicate.

**Expected outcome:**
- SCG07 t17: closes (B), should advance to ≥25.
- SCG01/03/06 risk: these scenarios depend on the current gate being restrictive. Audit each to confirm that the C++-faithful gate produces the same outcome.

**Rollback criteria:** Any scenario regresses → revert.

#### 7B — SCG01 t87 residual (JEEP#27 turret-pre-aligned fire)

**Current state:** `cpp-parity-scg01ea-tick-87-turret.test.ts` documents that JEEP#27 has turret pre-aligned from prior acquisition and fires at tick 87; WASM's JEEP[22] does NOT fire at tick 87 but at tick 88 (Greatest_Threat / In_Range / TarCom-assign cadence).

Per session 2026-04-22T08:30Z: the JEEP's Mission_Guard scan cadence differs. C++ fires at tick 88 on `bullet[76]`. TS fires same-tick when JEEP#27 acquires DOG target. The mechanism is upstream Mission_Guard scan cadence, not the fire path.

**Design:** Instrument Mission_Guard per-tick to find the exact tick WASM's JEEP[22] first acquires DOG as TarCom. Likely involves either:
- Greatest_Threat score tie-breaking (Evaluate_Object in techno.cpp:1529-1597)
- `In_Range` vs `entity.inRange` numerical rounding difference
- Per-tick scan ordering within `cellBasedGuardScan`

**LOC for both 7A and 7B:** ~80-100 net.
**Risk:** MEDIUM. Narrow scope.

---

## Section 3: Risk matrix

Per scenario, what will break during each phase and how to recover.

| Scenario | Phase 1 | Phase 2 | Phase 3 | Phase 4 | Phase 5 | Phase 6 | Phase 7 |
|---|---|---|---|---|---|---|---|
| SCG01 t87 | Neutral | +0..+3 | Neutral | Neutral | Neutral | **HIGH RISK** (Firing_AI+turret timing shifts) | Target (+1..+20 if 7B succeeds) |
| SCG03 t238 | Neutral | Neutral | Neutral | Neutral | Neutral | **Target (+20..+50)** OR **catastrophic (-200)** | Neutral |
| SCG04 t36 | Neutral | Neutral | **Target (+2..+30)** OR **regression at t3** | Neutral | +2..+5 | Low risk | Neutral |
| SCG06 t76 | Neutral | Neutral | Neutral | **Target (+5..+30)** | Neutral | Low risk | Neutral |
| SCG07 t17 | Neutral | Neutral | +2..+5 | Neutral | +2..+5 (vessel double-cycle) | Low risk | **Target +5..+15 (Random_Animate gate)** |
| SCG11 t57 | Neutral | +1..+5 | **Target (+5..+50)** | Neutral | Neutral | Low risk | Neutral |
| SCG13 t101 | +1..+5 | **Target (+5..+30)** | Neutral | Neutral | Neutral | Low risk | Neutral |

**Mid-flight regressions that MUST be accepted:**
- During Phase 3, SCG04 tick 3 may temporarily regress while vehicleClaims → path-reservation migrates. Acceptable IF Phase 3 completes within same session.
- During Phase 6 flip, multiple scenarios may regress by 1-5 ticks; must hold commit for re-verification.

**Steps that CANNOT happen mid-flight without the full sequence:**
- Phase 6 (CDTimer) CANNOT be attempted until Phase 1-3 are landed. Running it earlier re-hits the W3/W5 cascade documented in 2 prior reverts.
- Phase 3 (team + drive-in-GUARD) CANNOT be completed until Phase 2 (mission lifecycle) is landed; the unified `assignMission` is what allows team coordinators to stop direct-assigning.
- Phase 5 (vessel double-cycle) depends on Phase 1's STAGE F re-dispatch to fire Mission_Move same-tick on the second Commence.

---

## Section 4: Measurement protocol

### 4.1 Per-phase RNG verification tags

Each phase must verify byte-identity of the RNG stream at these tags:

| Phase | WASM tags to verify | TS verification method |
|---|---|---|
| 0 | All — baseline | Full 500-tick sweep unchanged |
| 1 | 60010 (Mission_Move_foot), 60040/60041/60043 (Mission_Guard) | Per-tick count match for SCG01/03/06/07 |
| 2 | 60043 (Mission_Guard_E1E3), 80200+ (dispatch) | SCG13 tick 101: TS fires 7 RNG (was 6) |
| 3 | 60010 @ SCG11 tick 57 | WASM 2 calls (60040 + 60010); TS matches |
| 4 | 50002 (Coord_Scatter) @ SCG06 tick 76 | WASM bullet[115] fires from cell (22,65); TS matches |
| 5 | 60010 vessel double @ SCG07 tick 17 | WASM vessel[182] 2×, vessel[183] 3×; TS matches |
| 6 | 60040 @ SCG03 tick 239 (not 238) | WASM Mission_Guard_general at tick 239; TS matches |
| 7A | 30001/30002/30003 (Random_Animate) @ SCG07 tick 17 | WASM fires 3 RandomAnim for infantry[126,129]; TS matches |
| 7B | 50002 @ SCG01 tick 88 (not 87) | WASM bullet[76] Coord_Scatter; TS matches |

### 4.2 Per-scenario first-divergence advance thresholds

| Scenario | Baseline | Phase 1-3 target | Phase 4-5 target | Phase 6-7 target |
|---|---|---|---|---|
| SCG01EA | 87 | 87 | 87 | **≥130** |
| SCG03EA | 238 | 238 | 238 | **≥260** |
| SCG04EA | 36 | 36 | **≥40** | ≥40 |
| SCG06EA | 76 | 76 | **≥85** | ≥85 |
| SCG07EA | 17 | 17 | **≥25** | **≥40** |
| SCG11EA | 57 | **≥65** | ≥65 | ≥65 |
| SCG13EA | 101 | **≥120** | ≥120 | ≥120 |

**Total target: 632 → 940+ first-divergence ticks (approximately +300).**

### 4.3 Pinning test verification

After each phase, run the full `src/EasterEgg/__tests__/cpp-parity-*.test.ts` suite (51,300+ tests). Expected behavior:

- Tests currently PASSING must continue to PASS unless explicitly listed in that phase's "Pinning tests to update" section.
- Tests currently DOCUMENTING divergence (like `cpp-parity-scg13ea-tick-101-fix.test.ts`) are EXPECTED to break. Update assertions to reflect new C++-parity behavior.
- Tests added in the phase PIN the new behavior.

### 4.4 Playwright end-of-phase verification

```bash
SCENARIOS=SCG01EA,SCG03EA,SCG04EA,SCG06EA,SCG07EA,SCG11EA,SCG13EA \
  MAX=150 \
  BASE_URL=http://localhost:3001 \
  npx playwright test scripts/test-first-divergence.ts --reporter=list
```

Per-tick instrumentation for deeper analysis:

```bash
SCENARIO=SCG06EA START=70 END=85 DUMP_ALL=1 \
  npx playwright test scripts/test-rng-entity-diff.ts --reporter=list
```

---

## Section 5: Instrumentation gaps

Additional WASM/TS instrumentation needed before Phase 1 can reliably land.

### 5.1 WASM-side instrumentation (require C++ source access to agent_harness.cpp + rebuild)

- **`Per_Cell_Process` call logger** — log `(frame, entity_id, pcp_type, cell_before, cell_after, commence_fired_bool, navcom_cleared_bool)` for every PCP invocation. Currently no such log exists; TS cannot verify whether its PCP dedup via `_commenceFiredBoundaries` matches WASM's natural per-obj-AI single-Commence.
- **`Commence` pop logger** — tag 80100+popped_mission set before every Commence that actually pops. Allows per-tick count + source match.
- **`MissionClass::AI` dispatch logger** — tag 80200+mission set before every `if (Timer == 0)` dispatch. Correlates with `g_rng_source_tag` sub-overrides.
- **`Enter_Idle_Mode` call logger** — tag 80300 set before Enter_Idle_Mode. Verifies SCG13 t99 guard firing.
- **`Start_Driver` / `Stop_Driver` logger** — tag 80400/80401 logs IsDriving transitions for vehicles.
- **`Basic_Path` result logger** — (frame, entity_id, start_cell, dest_cell, path_length, failed_bool). Verifies pathfinding.
- **`Approach_Target` call logger** — tag 80500 logs every Approach_Target invocation + selected destination cell. Critical for SCG06 t76.
- **Per-entity state dump at arbitrary tick** — `agent_get_entity_state(entity_id)` returning `(mission, mq, mt, arm, arm2, isdriving, isfiring, navcom_lx, navcom_ly, tarcom_id, path_len, doing)`. Some exists via `agent_get_state`; expand to cover the full MissionClass state vector.

### 5.2 TS-side instrumentation

- **`_missionDispatchTick` tracking** — set on entity when handler fires. Lets post-tick diff compare "did TS handler fire same tick as WASM."
- **`_commenceTrace` circular buffer (last 20 commence events)** — per-entity DEBUG-only trace.
- **`scripts/test-dispatch-order.ts`** — new script: per tick, per entity, dump `(Commence pre, MissionClass::AI fired, Firing_AI fired, Movement_AI fired, PCP_END fired, Commence post)` as ordered events. Side-by-side with WASM equivalent.
- **`scripts/test-enter-idle-mode-trace.ts`** — dumps every Enter_Idle_Mode call with reason and resulting queue assignment.
- **`scripts/test-approach-target-trace.ts`** — dumps every approachTarget call with (entity cell, target cell, dir256, sweep result cell).
- **`scripts/test-pathfind-determinism.ts`** — verifies findPath determinism across engine revisions (load-bearing for Phase 3).

### 5.3 Blocking gap

Without WASM-side Per_Cell_Process + Commence loggers, **Phase 1's STAGE F re-dispatch cannot be verified byte-for-byte**. Currently we rely on RNG-count-match as a proxy, but RNG-count matches accidentally (as documented in SCG11 t15 where Random_Animate coincidentally covered for the missing Mission_Guard fire).

**Recommendation:** Before starting Phase 1, add the WASM loggers (a ~2-day effort including rebuild + harness integration). This is the one concrete step that isn't optional.

---

## Section 6: Explicit non-goals

Out of scope even in this full refactor:

- **Pixel rendering changes** — visuals only, not RNG. Any rendering bugs are separate.
- **Map tile parsing / terrain updates** — already validated; no divergence source here.
- **INI parsing** — already validated byte-equivalent to C++ CCINIClass.
- **Audio / FMV playback** — not on RNG path.
- **Trigger system** — already byte-validated via per-trigger tests. No known divergences.
- **Fog-of-war per-object sticky `IsDiscoveredByPlayer`** — documented at 2026-04-20T14:50Z as a partial divergence. Not in the 7 first-divergence scenarios. Defer.
- **Expert_AI** — not present in TS; not in the 7 divergences. Defer.
- **Crate pickup RNG** — validated separately; no known divergence.
- **MCV deploy animation** — not on RNG path; cosmetic only.
- **Land-mine blow on cell-entry** — would need PCP port sub-case; not in the 7 divergences.
- **Flag pickup / flag-home scoring** — MULTI mode only; not on SCG campaign path.
- **ChronoTank / MadTank / Chronal** — specialty units, covered by existing tests; not in the 7.

### Conditional non-goals

- **Phase 6 (CDTimer)** — CONDITIONAL non-goal. If Phase 1-5 completes within budget AND workarounds W3, W4 are audited clean, attempt Phase 6. If either condition fails, defer. The pinning tests for SCG03 t238 will continue to document the divergence.
- **SCG01 t87 residual fix (7B)** — CONDITIONAL non-goal. If Phase 1-6 completes with SCG01 still at 87, do a focused cellBasedGuardScan / Greatest_Threat audit. Otherwise defer.

---

## Section 7: Estimated scope

### Total LOC changed

| Phase | Net LOC | Touched LOC | Files touched |
|---|---|---|---|
| 0 (Instr) | +200 | 200 | 6 |
| 1 (Dispatch order) | +250 | 400 | 4 |
| 2 (Mission lifecycle) | +300 | 500 | 6 |
| 3 (Team + DriveClassAI) | +200 | 350 | 5 |
| 4 (Approach_Target re-call) | +60 | 80 | 3 |
| 5 (Vessel double-cycle) | +80 | 100 | 4 |
| 6 (CDTimer) | +50 | 200 (+ test churn) | 3 engine + 40-50 tests |
| 7 (Residual) | +100 | 120 | 3 |
| **Total** | **~1250** | **~2000** | **~25 unique files** |

### Pinning tests to update

- Phase 1: 5 tests.
- Phase 2: 3 tests + 1 new.
- Phase 3: 5-7 tests (SCG04 stagger variants).
- Phase 4: 2 tests + 1 new.
- Phase 5: 3 tests + 1 new.
- Phase 6: 40-50 tests (timer-sensitive).
- Phase 7: 5 tests + 2 new.

**Total test updates: ~65-80 tests, ~6 new tests.**

### Estimated engineering sessions (2-3 hours each)

- Phase 0: 1 session (instrumentation).
- Phase 1: 2-3 sessions (largest restructure).
- Phase 2: 2 sessions.
- Phase 3: 2-3 sessions (vehicleClaims replacement is delicate).
- Phase 4: 1 session.
- Phase 5: 1-2 sessions.
- Phase 6: 2-3 sessions (if attempted; highest-risk).
- Phase 7: 1-2 sessions.

**Total: 12-17 engineering sessions.** At 2-3 hours each = **24-51 hours of focused engineering time.**

### Expected post-refactor first-divergence ticks (honest estimate)

| Scenario | Baseline | Best-case post-refactor | Realistic post-refactor |
|---|---|---|---|
| SCG01EA | 87 | 130-180 (Phase 7B) | 87-100 (if 7B defers) |
| SCG03EA | 238 | 260-350 (Phase 6) | 238-245 (if Phase 6 defers) |
| SCG04EA | 36 | 40-80 (Phase 3+5) | 38-55 |
| SCG06EA | 76 | 85-150 (Phase 4) | 80-120 |
| SCG07EA | 17 | 40-80 (Phase 5+7A) | 25-50 |
| SCG11EA | 57 | 65-150 (Phase 3) | 60-100 |
| SCG13EA | 101 | 120-200 (Phase 2) | 115-175 |
| **Total** | **612** | **940-1290** | **743-995** |

Best-case assumes every phase lands cleanly. Realistic assumes Phase 6 and 7B defer. Expect +130-380 total ticks, with:
- 3 scenarios advancing >30 ticks: **likely** (SCG04, SCG06, SCG13).
- 5 scenarios advancing: **likely** (adds SCG11, SCG07).
- 6 scenarios advancing (adds SCG03 via Phase 6): **moderate** chance.
- All 7 advancing (adds SCG01 via Phase 7B): **uncertain**.

### Expected residual divergences (there WILL be some)

Even after a successful full refactor, expect:

1. **SCG01 t100-130 range**: JEEP team-retaliation cascade + Mission_Guard scan cadence. Requires a deeper techno.cpp:1987-2267 `Greatest_Threat` port including full INFANTRY/VEHICLES/BOATS/BUILDINGS mask building. Current behavioral port (W19) is approximate.
2. **SCG07 t40-80 range**: Vessel Phase 3 iteration ordering at tick 0-1 (documented at 2026-04-20T07:00Z). Requires aligning TS Logic[] array construction order with C++. Cross-cutting.
3. **SCG06 t100+ range**: TS findPath vs C++ Basic_Path sub-cell path tie-breaking. Documented in `cpp-parity-findpath-basic-path.test.ts` as byte-equivalent for the tested cases, but extended path cases may diverge.
4. **SCG13 t150+ range**: Cumulative timer drift from the W3 post-decrement-capture approximations in places Phase 6 didn't touch.
5. **Infantry team gesture rolls** (documented at 2026-04-20T06:10Z): team ordering at percentChance(50) tick — different team iteration order causes the rolls to bind to different teams. Cross-cutting team-creation sequencing.

**These residuals are expected.** They require either (a) WASM-side single-step instrumentation that this repo doesn't have, or (b) cross-cutting refactors of the Logic[] iteration order that are out of scope.

---

## Section 8: Sequencing — the coordinated-update tree

This is the most important part of the document. For reference:

```
                         Phase 0 (Instrumentation)
                                   |
                                   v
                 Phase 1 (Dispatch order reorder: STAGE A-F)
                         /         |         \
                        /          |          \
                       v           v           v
               Phase 2       Phase 3        (independent of each other
               (Mission      (Team +         IF Phase 1 + 2 complete)
               lifecycle     DriveClass
               + NAVCOM_     AI port)
               GUARD ON)
                  |              |
          (SCG13 unblocks)  (SCG04, SCG11 unblock)
                  |              |
                  v              v
               Phase 4 (Approach_Target re-call)
                     |
               (SCG06 unblocks)
                     |
                     v
               Phase 5 (Vessel double-cycle)
                     |
               (SCG07 partial unblock)
                     |
                     v
               Phase 7A (Random_Animate gate)
                     |
               (SCG07 full unblock)
                     |
                     v
               Phase 6 (CDTimer batched) — CONDITIONAL
                     |
               (SCG03 unblocks)
                     |
                     v
               Phase 7B (SCG01 turret residual) — CONDITIONAL
                     |
               (SCG01 unblocks)
```

**Coordinated co-updates** (what other systems MUST change in lock-step with each phase):

- **Phase 1 coordinated with:** `missionTimerFired` capture site. The ONLY atomic unit. Cannot be split.
- **Phase 2 coordinated with:**
  - All `entity.mission = X; entity.missionTimer = 0;` sites (40+ instances, enumerated via grep).
  - `setMissionIdle()` helper callers (~10 instances).
  - All 3 team coordinator methods (coordinateMove, coordinatePatrol, coordinateRegroup).
  - `MOVEMENT_AI_MOVE_NAVCOM_GUARD` flag flip.
- **Phase 3 coordinated with:**
  - `team.ts coordinateMove` (W13 removal).
  - `findPath` `cellClaims` param (W14 replacement).
  - `index.ts runDriveClassAI` (W16 close-enough).
  - `entity.ts` `patrolBlockedTargetLX` removal.
  - Must be done as a single commit or contiguous commit series. Any intermediate state where W13 and W14 are partially removed leaves SCG04 t3 broken.
- **Phase 6 coordinated with:**
  - ALL start-of-tick decrements in index.ts, aircraft.ts, etc. (W1-W4 removal).
  - ALL `armBeforeScan = attackCooldown` captures (W3 removal).
  - Fire-condition flips from `<=0 after --` to `===0 before --`.
  - 40-50 pinning tests.
  - Must be a single atomic commit OR a coordinated commit chain within a single session.

---

## Section 9: Critical files for implementation

- `/Users/discordwell/Projects/CLIaaS/src/EasterEgg/engine/index.ts` (9592 LOC — the main loop, `updateEntity`, `updateMove`, `updateTeamMission`, Mission.MOVE/GUARD/AREA_GUARD dispatch, PCP wire-points)
- `/Users/discordwell/Projects/CLIaaS/src/EasterEgg/engine/missionAI.ts` (2066 LOC — `updateGuard`, `updateAreaGuard`, `updateAttack`, Firing_AI, Approach_Target, `cellBasedGuardScan`)
- `/Users/discordwell/Projects/CLIaaS/src/EasterEgg/engine/team.ts` (1364 LOC — `coordinateMove`, `coordinatePatrol`, `coordinateRegroup`, Team.ai())
- `/Users/discordwell/Projects/CLIaaS/src/EasterEgg/engine/perCellProcess.ts` (848 LOC — feature flags, PCP_DURING/END/ROTATION, footPerCellProcess, unitPerCellProcess)
- `/Users/discordwell/Projects/CLIaaS/src/EasterEgg/engine/entity.ts` (1425 LOC — Entity fields including all timers, isDriving, firePrepActive, guardOrigin)

**Supporting files (referenced less frequently):**

- `/Users/discordwell/Projects/CLIaaS/src/EasterEgg/engine/combat.ts` (2012 LOC — Fire_At, damageEntity, triggerRetaliation, launchProjectile)
- `/Users/discordwell/Projects/CLIaaS/src/EasterEgg/engine/pathfinding.ts` — findPath (to be extended with cellClaims param in Phase 3)
- `/Users/discordwell/Projects/CLIaaS/src/EasterEgg/CnC_and_Red_Alert/RA/agent_harness.cpp` — WASM instrumentation (Phase 0 additions)
- `/Users/discordwell/Projects/CLIaaS/scripts/test-rng-entity-diff.ts` — per-entity RNG diff harness (needs tagName() fix)
- `/Users/discordwell/Projects/CLIaaS/scripts/test-first-divergence.ts` — 7-scenario first-divergence sweep

---

## Closing notes — what this plan honestly claims

**Claim 1:** Phases 1-5 can realistically close SCG04, SCG06, SCG11, SCG13 (4 of 7 scenarios) and partially advance SCG07. Total expected advance: +130 to +250 first-divergence ticks.

**Claim 2:** Phase 6 (CDTimer) and Phase 7B (SCG01 turret residual) are high-risk and may need to be deferred. If successful: SCG01, SCG03 close adding another +50 to +130 ticks.

**Claim 3:** Some residual divergences will remain even after a successful full refactor. The most stubborn ones (SCG07 tick-0 vessel ordering, team gesture percentChance ordering) require cross-cutting refactors of the Logic[] iteration order that are out of scope.

**Claim 4 — the sequencing thesis:** Every past narrow fix has been sound individually but regressed because the surrounding workarounds weren't co-updated. This plan's value is in identifying the coordinated co-updates (W1-W25 enumerated in Section 1) and sequencing them so each phase atomically removes a workaround cluster along with the hole it was patching. If a phase cannot be done atomically — specifically Phase 3's W13+W14+W16 removal and Phase 6's W1-W4 removal with test updates — it MUST be reverted rather than left half-done.

**Do not attempt this refactor piecemeal across multiple sessions without explicit session boundaries matching phase boundaries.** The whole reason prior sessions hit cascade regressions is that one session would ship part of a phase, land a green test pass via accidental coincidence, and the next session would build on a foundation that was actually half-missing a coordinated co-update.

---

### Critical Files for Implementation
- /Users/discordwell/Projects/CLIaaS/src/EasterEgg/engine/index.ts
- /Users/discordwell/Projects/CLIaaS/src/EasterEgg/engine/missionAI.ts
- /Users/discordwell/Projects/CLIaaS/src/EasterEgg/engine/team.ts
- /Users/discordwell/Projects/CLIaaS/src/EasterEgg/engine/perCellProcess.ts
- /Users/discordwell/Projects/CLIaaS/src/EasterEgg/engine/entity.ts
