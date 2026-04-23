/**
 * C++ parity scaffolding: UnitClass::Per_Cell_Process hook.
 *
 * ## What this module is
 *
 * A single, well-typed entry point for cell-boundary processing during
 * vehicle/vessel movement. It is called from the track-advance loop in
 * `index.ts` each time a vehicle finishes entering a new cell (PCP_END),
 * each time it crosses a mid-track midpoint (PCP_DURING), or each time
 * it finishes a stationary rotation (PCP_ROTATION).
 *
 * The long-term goal is full behavioral parity with C++
 * `UnitClass::Per_Cell_Process` (unit.cpp:1610-1884) which handles:
 *   - Deploy trigger for MCVs mid-rotation (unit.cpp:1623-1626)
 *   - Transport / building entry + IM_IN radio (unit.cpp:1636-1665)
 *   - Tether scatter / unload radio (unit.cpp:1672-1719)
 *   - Edge-of-world cull (unit.cpp:1726-1729)
 *   - Look()/Shroud_Regen (unit.cpp:1737-1750)
 *   - **Commence() — pop MissionQueue mid-drive (unit.cpp:1756)**
 *   - Flag pickup / flag-home scoring (unit.cpp:1771-1802)
 *   - Land-mine trigger (unit.cpp:1807-1838)
 *   - Impassable-cell suicide (unit.cpp:1846-1852)
 *   - Crushable-overlay destruction (unit.cpp:1858-1870, PCP_END + PCP_DURING)
 *   - Overrun_Square infantry crush (unit.cpp:1876, PCP_END + PCP_DURING)
 *   - DriveClass::Per_Cell_Process (drive.cpp:858-879) — NavCom-at-dest clear
 *
 * ## Current scope (as of SCG04/11/13 architectural-blocker session)
 *
 * The Commence sub-case — the load-bearing piece for SCG04 tick-36, SCG11
 * tick-28, and SCG13 tick-101 first-divergences — is **gated behind the
 * `PER_CELL_COMMENCE_ENABLED` feature flag**, which defaults to `false`.
 *
 * Why gated, not shipped:
 *   1. Prior naive port (commit-branch investigation, documented in
 *      `cpp-parity-scg11ea-tick-28.test.ts`) produced off-by-one Mission_Move
 *      jitter timing (tick 29 not 28) AND failed to explain WASM MCV-157's
 *      double-fire within a single tick. Introduced 5 new divergent ticks in
 *      the 29-33 range as a cascade.
 *   2. DriveClass::AI (drive.cpp:1340-1345) can re-enter Start_Of_Move +
 *      While_Moving within a single tick when the current track completes
 *      with more path/NavCom remaining. This double-cycle may be the
 *      mechanism for the unexplained second Mission_Move RNG draw — but
 *      requires C++ single-step instrumentation to confirm.
 *   3. The fix touches `updateMove`, `updateGuard`, `team.ts coordinateMove`,
 *      and every vehicle-move code path — 7 scenarios, 55k+ tests at risk.
 *
 * The scaffolding here establishes the hook point, documents each sub-case
 * with its C++ line reference, and preserves current behavior byte-for-byte.
 * It exists specifically so future fixes can flip the flag scenario-by-scenario
 * instead of landing a cross-cutting refactor in one go.
 *
 * ## C++ call-path refs (authoritative)
 *
 *   drive.cpp:661-834          DriveClass::While_Moving (per-cell trigger loop)
 *   drive.cpp:735-742          PCP_DURING dispatch (mid-track midpoint)
 *   drive.cpp:773              PCP_END during track-jump (Stop_Driver → Commence)
 *   drive.cpp:816              PCP_END on track completion (Stop_Driver → Commence)
 *   drive.cpp:858-879          DriveClass::Per_Cell_Process (NavCom-at-dest clear)
 *   drive.cpp:1304-1399        DriveClass::AI (TrackNumber dispatch; double-cycle path)
 *   unit.cpp:397-474           UnitClass::AI (pre/post Commence bookends)
 *   unit.cpp:1610-1884         UnitClass::Per_Cell_Process (full sub-case list)
 *   unit.cpp:1756              Commence() — pops MissionQueue → Mission + Timer=0
 *   mission.cpp:343-359        MissionClass::Commence (Timer=0, Status=0)
 *   mission.cpp:213-321        MissionClass::AI (Timer==0 dispatch)
 *   foot.cpp:492-539           FootClass::Mission_Move (tag 60010 jitter)
 */

// ============================================================================
// Phase 0 instrumentation — DEBUG_PCP_TRACE (plan §0 line 136).
//
// Self-contained block: env-gated PCP call trace. When
// `process.env.DEBUG_PCP_TRACE === "1"`, every unit/foot per-cell-process call
// logs `(tick, entityId, why, beforeState, afterState)` to the global buffer.
// When the env var is unset, _PCP_TRACE_ENABLED is `false` and `pcpTrace()` is
// a single boolean-check early-return — zero allocation, zero behavior change.
//
// Consumers: scripts/test-dispatch-order.ts reads globalThis.__pcpTraceBuffer.
// Reset via globalThis.__pcpTraceReset().
//
// Placed at top of file as a self-contained block so it merges cleanly against
// the Phase 1 agent's edits further down in unitPerCellProcess/footPerCellProcess.
// ============================================================================
const _PCP_TRACE_ENABLED: boolean =
  typeof process !== 'undefined' &&
  typeof process.env !== 'undefined' &&
  process.env.DEBUG_PCP_TRACE === '1';

export interface PCPTraceEntry {
  tick: number;
  entityId: number | string;
  why: number; // PCPType value
  beforeState: {
    mission: string | number | null;
    missionQueue: string | number | null;
    missionTimer: number;
    cx: number;
    cy: number;
    moveTargetLX?: number;
    moveTargetLY?: number;
  };
  afterState: {
    mission: string | number | null;
    missionQueue: string | number | null;
    missionTimer: number;
    cx: number;
    cy: number;
    moveTargetLX?: number;
    moveTargetLY?: number;
  };
  navComCleared: boolean;
  commenceFired: boolean;
}

// Lazily attach buffer to globalThis so test scripts can read it regardless of
// bundler scope. No-op at import time; only touched when the env flag is set.
function _pcpTraceBuffer(): PCPTraceEntry[] {
  const g = globalThis as any;
  if (!Array.isArray(g.__pcpTraceBuffer)) g.__pcpTraceBuffer = [];
  return g.__pcpTraceBuffer as PCPTraceEntry[];
}

if (_PCP_TRACE_ENABLED) {
  (globalThis as any).__pcpTraceReset = () => {
    (globalThis as any).__pcpTraceBuffer = [];
  };
  (globalThis as any).__pcpTraceEnabled = true;
}

/**
 * Snapshot an entity's PCP-relevant state for before/after comparison.
 * Called only from the trace path (when _PCP_TRACE_ENABLED is true).
 */
function _pcpSnapshot(entity: any): PCPTraceEntry['beforeState'] {
  return {
    mission: entity?.mission ?? null,
    missionQueue: entity?.missionQueue ?? null,
    missionTimer: entity?.missionTimer ?? 0,
    cx: entity?.cell?.cx ?? -1,
    cy: entity?.cell?.cy ?? -1,
    moveTargetLX: entity?.moveTarget?.lx,
    moveTargetLY: entity?.moveTarget?.ly,
  };
}

/**
 * Record a single PCP trace entry. Hot-path guard: when the env flag is
 * unset, `_PCP_TRACE_ENABLED` is `false` and this is a single boolean check.
 */
function _pcpTraceRecord(
  entity: any,
  why: number,
  beforeState: PCPTraceEntry['beforeState'],
  result: { navComCleared: boolean; commenceFired: boolean }
): void {
  if (!_PCP_TRACE_ENABLED) return;
  const g = globalThis as any;
  const tick = typeof g.__agentTick === 'function' ? g.__agentTick() : (g.__currentTick ?? -1);
  _pcpTraceBuffer().push({
    tick,
    entityId: entity?.id ?? entity?.logicIdx ?? -1,
    why,
    beforeState,
    afterState: _pcpSnapshot(entity),
    navComCleared: result.navComCleared,
    commenceFired: result.commenceFired,
  });
}

/**
 * Per-cell-process boundary type. Mirrors C++ `PCPType` (defsg.h:122 or
 * drive.h depending on build — the three-value enum).
 */
export enum PCPType {
  /**
   * Mid-track boundary: vehicle crossed an intermediate midpoint during
   * a 2-cell (long) track. C++ drive.cpp:735-742 — triggers Overrun_Square
   * + crushable-overlay destruction only. Does NOT fire Commence.
   */
  PCP_DURING = 0,

  /**
   * End-of-track boundary: vehicle finished entering the target cell (or
   * performed a track-jump hand-off). C++ drive.cpp:773, 816 — this is
   * where UnitClass::Per_Cell_Process fires Commence (unit.cpp:1756),
   * clears NavCom at destination (drive.cpp:869-873), triggers mine blow,
   * picks up flags, and does the full Look() pass.
   */
  PCP_END = 1,

  /**
   * Stationary rotation finish: vehicle was rotating in place (no track)
   * and just finished. C++ drive.cpp:1365 — used by MCV deploy-after-turn
   * (unit.cpp:1623-1626). Does NOT fire Commence (MCV branches into
   * Try_To_Deploy instead).
   */
  PCP_ROTATION = 2,
}

/**
 * Feature gate for the per-cell Commence port.
 *
 * When `true` (current), `unitPerCellProcess(entity, PCP_END)` calls Commence()
 * equivalent logic (pop MissionQueue → Mission + Timer=0 + Status=0),
 * matching C++ `UnitClass::Per_Cell_Process` line 1756 — fired at EVERY
 * track-end cell boundary, not just at destination arrival.
 *
 * ## Enabled rationale (partial port, SCG11EA tick-28 investigation)
 *
 * C++ `UnitClass::Per_Cell_Process` at unit.cpp:1756 unconditionally calls
 * `Commence()` at every PCP_END (drive.cpp:773, 816) during a vehicle's
 * drive. `Commence()` pops `MissionQueue` if it is not `MISSION_NONE`,
 * zeroing Timer so the next `MissionClass::AI` dispatch fires the new
 * mission's handler on the FOLLOWING tick.
 *
 * For a reinforcement MCV that spawns with `Mission=GUARD` and
 * `MissionQueue=MOVE` (via `team.cpp` Coordinate_Move), Commence at the
 * first track boundary mid-drive pops MissionQueue → Mission=MOVE,
 * Timer=0. The following tick's `MissionClass::AI` sees Mission=MOVE,
 * Timer=0, `!Target_Legal(NavCom)==false` (still en route), so
 * `Mission_Move()` runs the normal path:
 *   - `g_rng_source_tag = 60010;`
 *   - `Random_Pick(0, 2);`  // tag-60010 jitter
 *   - returns `Normal_Delay + jitter` → Timer set.
 *
 * This is the RNG consumption WASM logs at SCG11EA tick 28 (see
 * `cpp-parity-scg11ea-tick-28.test.ts`). Before this port, TS only fired
 * `perCellNavComCheck` on final destination arrival, after which
 * Mission_Move took the `Enter_Idle_Mode` early-return (no RNG).
 *
 * ## What is still NOT ported (documented limitations)
 *
 * 1. **MCV-157 double-fire at SCG11 tick 28** — WASM consumes 2 RNG calls
 *    for the east MCV vs 1 for the west. This remains unexplained without
 *    single-step C++ instrumentation. Most plausible mechanism is the
 *    `DriveClass::AI` re-entrant path at drive.cpp:1340-1345 where
 *    `Start_Of_Move` + `While_Moving` fire a second time within one tick
 *    when the current track completes and NavCom/Path still has remaining
 *    moves. A TS port of that double-cycle would need to invoke Commence
 *    TWICE in one tick but only when the second While_Moving also crosses
 *    a cell boundary — a narrow path geometry condition. Not yet modeled.
 *
 * 2. **`team.ts` coordinateMove eager `isDriving=true`** — the TS team
 *    code sets `isDriving=true` pre-emptively when facing already matches
 *    the path (team.ts:922). C++ sets IsDriving only after Start_Driver
 *    succeeds within DriveClass::AI. The TS path works for 6 of 7 scenarios
 *    but may produce off-by-one Commence timing for edge cases with
 *    impossible-turn initial facings.
 *
 * 3. **Mid-track PCP_DURING crushable/Overrun_Square dispatch** — already
 *    handled inline by `followTrackStep` in `index.ts`. This module's
 *    PCP_DURING branch remains a no-op stub for future consolidation.
 *
 * ## Regression acceptance criteria
 *
 *   - Flipping this flag MUST NOT cascade SCG01/03/06/07 first-divergence
 *     timings. Those scenarios have already reached tick 80+/238/76/17
 *     with the flag false; the flag enable must advance or leave them
 *     unchanged.
 *   - The SCG04EA tick-36, SCG11EA tick-28, SCG13EA tick-101 docs tests
 *     record the pre-port divergence; they must be updated to reflect
 *     the new post-port behavior (and mark which parts are now matching
 *     WASM vs which parts remain architectural blockers).
 *
 * See `cpp-parity-scg11ea-tick-28.test.ts` and
 * `cpp-parity-per-cell-process-enabled.test.ts` for the contract.
 */
export const PER_CELL_COMMENCE_ENABLED = true;

/**
 * PCP Session 1 — track-jump PCP_END gate.
 *
 * C++ drive.cpp:773 fires a full `UnitClass::Per_Cell_Process(PCP_END)` when a
 * vehicle performs a track-jump (`Stop_Driver()` → `IsDriving=true` →
 * `Per_Cell_Process(PCP_END)` → `IsDriving=false` → `Start_Driver(c)`). This
 * is in addition to the track-completion PCP_END at drive.cpp:816.
 *
 * Current TS (`index.ts` track-jump site) skips the PCP and only does
 * `pathIndex++`. Result: one missing Commence per track-jump, which blocks
 * SCG04 tick 36 (reinforcement MCV still has `MissionQueue=MOVE` after a
 * curved track-jump; never pops it mid-drive, so Mission_Move never re-fires).
 *
 * **Gate rationale** — a naive ON flip regressed SCG04 36→24 AND SCG11 32→21
 * because the second Commence on the same tick fires Mission_Move RNG a
 * second time via the same-tick post-Commence dispatch (commit 79b13cb3).
 * The fix requires PER-BOUNDARY dedup keyed by `${trackIndex}-${pathIndex}`
 * to match C++'s single Commence-per-obj->AI() contract (mission.cpp:213-321
 * — no loop inside MissionClass::AI). Plan §6 spec'd this design; step 1.3
 * now has it ON behind the per-boundary `_commenceFiredBoundaries` Set<string>
 * on Entity, reset at top of `updateEntity` each tick. Step 1.2 shipped OFF.
 */
export const PER_CELL_TRACK_JUMP_ENABLED = true;

/**
 * PCP Session 2 — Infantry cell-arrival `Per_Cell_Process(PCP_END)`.
 *
 * C++ infantry.cpp:3992-4010 triggers `Per_Cell_Process(PCP_END)` at
 * `Distance(Head_To_Coord()) < 0x0010` — i.e. when an infantry arrives at
 * the center of a cell. The PCP chain then runs (in order):
 *   1. FootClass::Per_Cell_Process path-shorten (foot.cpp:1471-1483) — if a
 *      target is in weapon range and mission is RESCUE/GUARD_AREA/ATTACK/HUNT,
 *      clear NavCom + zero Path[0] so the unit stops and engages.
 *   2. InfantryClass::Per_Cell_Process Enter_Idle_Mode probe
 *      (infantry.cpp:911) — when the FOUR guards hold:
 *        - `MissionQueue == MISSION_NONE`
 *        - `!Target_Legal(NavCom)`   (moveTarget === null)
 *        - `!Target_Legal(TarCom)`   (target === null && targetStructure === null)
 *        - `!In_Radio_Contact()`     (TS infantry have no radio — DROP and DOCUMENT)
 *      → call `Enter_Idle_Mode()` which sets `MissionQueue = MISSION_GUARD` (or
 *      `MISSION_GUARD_AREA` when a guard origin is set). NOT `Mission = GUARD`.
 *   3. Commence() (infantry.cpp:914) — pops MissionQueue → Mission + Timer=0.
 *
 * Both step (2)-assigned queue AND any pre-existing `MissionQueue` (e.g.
 * `Coordinate_Move` queued a MOVE) are popped by the same Commence call at
 * step (3). The next tick's `MissionClass::AI` fires the new handler.
 *
 * ## Gate rationale
 *
 * A prior narrow port of Enter_Idle_Mode cascaded SCG01/03/06/07 (likely
 * dropped one of the four guards — see plan §8 S2.3 note). All four MUST
 * hold, and when the `In_Radio_Contact` check is absent, it is documented
 * explicitly here as a TS-always-false simplification.
 *
 * Session 2.1 ships the stub with `FOOT_PER_CELL_ENABLED=false` — wires the
 * hook but does NOT alter behavior. Session 2.3 flips ON after the
 * cell-arrival sites are wired (Session 2.2) so the activation is atomic.
 *
 * Session 3 will enable the path-shorten sub-case via a separate
 * `PCP_PATH_SHORTEN_ENABLED` flag (kept off here for Session 2 isolation).
 */
export const FOOT_PER_CELL_ENABLED = true;

/**
 * PCP Session 3 — FootClass path-shorten when target is in range.
 *
 * C++ foot.cpp:1471-1483: at every PCP_END for a foot, if `Target_Legal(TarCom)`
 * and the unit is on an attack-type mission (RESCUE, GUARD_AREA, ATTACK, HUNT)
 * and the target is within primary-weapon range, `Assign_Destination(TARGET_NONE)`
 * + `Path[0] = FACING_NONE` — stopping further pathwalk and letting Firing_AI
 * engage the target on the next tick.
 *
 * TS previously had an inline version of this at `index.ts:4184-4188` (HUNT only).
 * Session 3.1 moves it into `footPerCellProcess` so AREA_GUARD + ATTACK + RESCUE
 * also benefit — the load-bearing piece for SCG06 tick 76 where a USSR E1 in
 * AREA_GUARD walking toward a Greek E1 target needs to stop moving the instant
 * the target enters weapon range (C++ stops at cell-arrival, TS was walking past
 * the range boundary to the approach cell).
 *
 * The caller supplies `pathShortenEligible` (mission ∈ {HUNT, AREA_GUARD, ATTACK,
 * RESCUE}) and `targetInRange` (inRange check on live TarCom) via ctx so this
 * module stays loosely typed. When ON, the sub-case fires before Enter_Idle_Mode
 * so NavCom is cleared prior to the four-guard check — but in practice the live
 * target means TarCom guard still fails and Enter_Idle_Mode is skipped anyway.
 */
export const PCP_PATH_SHORTEN_ENABLED = true;

/**
 * PCP Session 3.2 — Mission_Guard_Area Approach_Target re-fire gate.
 *
 * C++ foot.cpp:1082-1084: every Mission_Guard_Area timer cycle when
 * `Target_Legal(TarCom)`, call `Approach_Target()`. This re-assigns NavCom
 * toward the current target EVEN when moveTarget is already set (drifting the
 * approach cell as the target moves / as the unit moves).
 *
 * TS `updateAreaGuard` currently calls `approachTarget` only when the scan
 * finds a target AND `!entity.moveTarget`. This misses:
 *   1. `hadTargetAtEntry && !scanFound`: target still alive but out of scan
 *      range this tick — C++ would still fire Approach_Target on the existing
 *      TarCom. Rare in practice (TarCom usually stays in scan range while the
 *      unit is closing distance) but possible at the scan radius edge.
 *   2. `hadTargetAtEntry && scanFound && moveTarget`: unit is already moving
 *      toward an approach cell but target has moved — C++ re-picks approach
 *      cell each timer. TS sticks with the stale cell forever.
 *
 * Both cases contribute to SCG06 tick 76: USSR E1 at (24,67) closes toward
 * Greek E1 at (20,64). At cell boundaries, moveTarget stays stale until the
 * next timer fire (up to 70+ ticks apart at Area Guard Normal_Delay=70 +
 * Random_Pick(1,5)). The path-shorten from 3.1 clears moveTarget on cell
 * arrival with in-range, but when still out of range the unit may stop
 * moving (end of path) without re-calling approachTarget.
 *
 * ## Gate-by-cell-change rationale
 *
 * C++ re-calls Approach_Target every timer fire without regard to cell
 * identity. TS could theoretically match that, but:
 *   - approachTarget in TS calls findPath (expensive) and can produce
 *     different results than C++'s Basic_Path due to pathfinder nuances.
 *   - Re-firing every timer even when nothing has changed (cell, target pos)
 *     is potentially a cascade risk — so we gate by `entity.cell` change
 *     since last approach call. This is TS-specific guard noted in the plan
 *     (§8 S3.2 "Gate by cell-change since last approach call").
 *
 * Session 3.2 ships with the flag ON (initial infrastructure was gated OFF
 * here so the re-fire can be backed out by flipping the flag if regressions
 * appear). Tracked via `_lastAreaGuardApproachCellKey` on Entity (reset
 * never — persists across ticks).
 */
export const AREA_GUARD_APPROACH_RETRY = true;

/**
 * PCP Session 3.3 — Team Start_Driver refactor gate.
 *
 * C++ `Team::Coordinate_Move` (team.cpp:1938) calls `Assign_Mission(MISSION_MOVE)`
 * which queues MissionQueue. It does NOT set IsDriving directly — that flip
 * happens inside `DriveClass::AI` → `Start_Driver` AFTER rotation completes
 * (drive.cpp:1079-1086).
 *
 * TS `team.coordinateMove` (team.ts:886-928) currently sets `unit.isDriving=true`
 * eagerly when the facing already matches the path direction — a proxy for
 * C++'s Start_Driver success. It's a heuristic that works for 6/7 scenarios but
 * doesn't populate `unit.path` (currently MISSING per plan §8 S3.3), leaving
 * `updateMove`/`followTrackStep` to lazily findPath on first tick of the MOVE
 * mission.
 *
 * The refactor: when flag is ON:
 *   1. Call `findPath(unit.cell, target, ...)` and store in `unit.path` +
 *      `pathIndex=0` at coordinateMove time (mirrors C++ Basic_Path).
 *   2. Do NOT set `unit.isDriving=true` eagerly. The Mission.GUARD drive-in-GUARD
 *      handler (index.ts ~4210) invokes `updateMove`, which calls
 *      `followTrackStep`, which sets isDriving=true via C++-parity semantics.
 *   3. `vehicleClaims` logic MUST STAY (plan §8 S3.3 explicit note) — it's
 *      load-bearing for SCG04 tick 3 transient Basic_Path cell reservation.
 *      When flag is ON, `vehicleClaims` still flips `prior.isDriving=false`
 *      for the second-team case, but does NOT set `unit.isDriving=true` for
 *      the current team.
 *
 * ## Rollout
 *
 * Session 3.3 ships the stub with the flag OFF (default). Session 3.4 attempted
 * to flip ON but encountered two categories of test failures:
 *   - `cpp-parity-scg04-mission-move-stagger.test.ts` (2 cases): asserts
 *     tank2.isDriving=true after the vehicleClaims prior-reset flip. With the
 *     refactor, vehicleClaims still resets prior.isDriving=false but skips the
 *     second-team isDriving=true step, breaking SCG04 tick-3 stagger parity.
 *   - `cpp-parity-scg07-vessel-reinforce.test.ts` (1 case): same assertion
 *     structure for sibling-team vehicles (SCG07 vessel mix).
 *
 * The divergence metric showed no advance with the flag ON (SCG04/06/11 all
 * unchanged), so the refactor brought cost without benefit. Per plan §8 S3.4
 * rollback priority, this flag stays OFF. The 3.3 stub infrastructure (findPath
 * path population, map plumbing, flag gating) is retained so a future session
 * can revisit with updated test expectations that encode the new refactor
 * semantics — or with a more nuanced carve-out that preserves the SCG04
 * tick-3 second-team isDriving=true while skipping the solo facing-alignment
 * shortcut.
 *
 * ## C++ refs
 *
 *   team.cpp:1938      Coordinate_Move → Assign_Mission(MISSION_MOVE)
 *   drive.cpp:1079-1086 Start_Driver returns early during rotation
 *   drive.cpp:1304-1399 DriveClass::AI TrackNumber dispatch
 *   foot.cpp:856-946    Basic_Path / Approach_Target pathfinding
 */
export const TEAM_START_DRIVER_REFACTOR = false;

/**
 * Mission_Move internal path-failure short-circuit (residual beyond Session 3).
 *
 * ## C++ reference
 *
 * `FootClass::Mission_Move` (foot.cpp:520-540) is called by MissionClass::AI
 * when the timer fires on an infantry/vehicle in MISSION_MOVE. The C++ chain
 * BEFORE Mission_Move runs is InfantryClass::Movement_AI / DriveClass::AI,
 * which may internally call `Basic_Path` when the stored `Path[]` buffer is
 * empty or the next `Path[]` cell is no longer reachable. When Basic_Path
 * fails (returns false with no path produced), `Movement_AI` invokes
 * `Stop_Driver()` and Mission_Move's top-of-handler guard at foot.cpp:524
 * (`!Target_Legal(NavCom) && !IsDriving && MissionQueue == MISSION_NONE`)
 * trips → `Enter_Idle_Mode()` queues MISSION_GUARD (or MISSION_GUARD_AREA
 * when `IsInitiated` + guardOrigin is set). Mission_Move returns 1 (no RNG
 * jitter consumed) — the GUARD timer fires on the next tick.
 *
 * TS's `updateMove` already handles the all-retries-exhausted case by
 * clearing `moveTarget`/`path` and calling `setMissionIdle()`. This shorter
 * circuit fires ONE tick earlier: when the missionTimer fires, the path is
 * non-empty, but the next path cell is blocked AND a one-shot pathfinding
 * refresh also fails. Skipping the Mission_Move jitter on that tick
 * prevents a phantom Random_Pick(0,2) call that WASM doesn't fire because
 * its Basic_Path-inside-Movement_AI chain already queued GUARD.
 *
 * ## Related blocker
 *
 * SCG13EA tick-101 — entity id=109 (USSR E1 @61,67) is in MOVE mission at
 * tick 100 with path toward cell (61,79) blocked (prior agent investigations
 * logged in `__tests__/cpp-parity-scg13ea-tick-101-fix.test.ts`). WASM fired
 * a tag 60043 GUARD Arm_Delay at tick 101; TS stayed in MOVE firing nothing.
 * The Δ=+1 RNG call is this missing short-circuit — WASM's next-tick GUARD
 * emits the 7th RNG fire, TS's stuck-in-MOVE does not.
 *
 * ## Gate rationale
 *
 * Shipping OFF (Session 3.5 stub). When flipped ON the short-circuit runs
 * only when:
 *   1. `missionTimerFired` this tick (matches C++ Mission_Move dispatch).
 *   2. `mission === MOVE` (guard against applying to HUNT/ATTACK/etc.).
 *   3. `moveTarget` present AND `path.length > pathIndex` (non-empty path).
 *   4. Next path cell is un-passable OR occupied by non-allied blocker AND
 *      a one-shot findPath from current cell to moveTarget returns empty.
 *   5. `missionQueue === null` (don't clobber a pending queue).
 *
 * When all five hold, clear moveTarget + path, and — mirroring
 * `footPerCellProcess`'s Enter_Idle_Mode sub-case — queue GUARD (or
 * AREA_GUARD when guardOrigin is set). The existing post-Commence path in
 * the engine pops the queue same-tick (vehicles) or next-tick (infantry
 * via updateEntity's missionTimerFired reset). No RNG consumed.
 *
 * ## C++ refs
 *
 *   foot.cpp:520-540      FootClass::Mission_Move handler (Enter_Idle_Mode guard)
 *   foot.cpp:313-500      Basic_Path primary entry with IsInit/Try_Again loop
 *   infantry.cpp:1663-1721 InfantryClass::Enter_Idle_Mode (GUARD vs GUARD_AREA)
 *   infantry.cpp:3780-4058 InfantryClass::Movement_AI (calls Per_Cell_Process)
 *   drive.cpp:961-996     DriveClass::AI Basic_Path failure + Try_Try_Again
 */
export const MISSION_MOVE_PATH_FAILURE = true;

/**
 * PCP Session 4 — InfantryClass::Movement_AI MOVE+!NavCom top-of-handler
 * Enter_Idle_Mode guard.
 *
 * ## C++ reference
 *
 * `InfantryClass::Movement_AI` opens (infantry.cpp:3786-3788) with:
 *
 *   if (Mission == MISSION_MOVE && !Target_Legal(NavCom)) {
 *       Enter_Idle_Mode();
 *   }
 *
 * This is a FAILSAFE guard that runs at the very top of Movement_AI BEFORE
 * Path/Start_Driver/Per_Cell_Process. It catches the case where Mission has
 * been transitioned to MOVE (typically via pre-Commence at line 1210 popping
 * `MissionQueue=MOVE`) but `NavCom` is legal-less — either never assigned,
 * cleared by a prior Movement_AI PCP NavCom-match branch (line 4003-4006),
 * or cleared by a Basic_Path-close-enough short-circuit (line 3866, 3873).
 *
 * ## SCG13EA tick-99 divergence (the true first-divergence root cause)
 *
 * Prior investigation (`cpp-parity-scg13ea-tick-101-fix.test.ts`, Session 3.5
 * `footPerCellProcess` wiring + `MISSION_MOVE_PATH_FAILURE` short-circuit
 * both landed but neither advanced SCG13 past tick 101) concluded the
 * divergence is firmly at **tick 99** not tick 100 or 101.
 *
 * The E1 USSR patrol infantry (WASM logic[153], TS id=109) at cell (61,67):
 *   - End-of-tick-98: both engines GUARD with a pending Timer countdown.
 *   - Tick 99: team AI phase Coordinate_Patrol re-picks the next waypoint,
 *     queues MissionQueue=MOVE, and assigns NavCom toward cell (61,79).
 *   - Tick 99 object-AI phase: FootClass::AI → MissionClass::AI Commence
 *     pops MOVE → Mission=MOVE, Timer=0. InfantryClass::Movement_AI runs.
 *   - **Line 3786-3788 fires in WASM**: `Mission==MOVE && !Target_Legal(NavCom)`
 *     → Enter_Idle_Mode → order=GUARD (NavCom and TarCom both clear) →
 *     Assign_Mission(GUARD) → MissionQueue=GUARD.
 *   - End-of-tick-99 WASM state: Mission=MOVE, Timer=0, MissionQueue=GUARD.
 *   - Tick 100: Commence pops GUARD → Mission=GUARD, Timer=0. Mission_Guard
 *     runs at tick 101, fires tag-60043 Arm_Delay Random_Pick(0,2).
 *
 * TS never clears NavCom between Coordinate_Patrol (which sets moveTarget)
 * and the object-AI Mission.MOVE handler, so `Target_Legal(NavCom)` is
 * always true in this sequence. The line 3786 guard never fires, the unit
 * stays in MOVE mission, and the 60043 RNG call is missing at tick 101.
 *
 * ## Why this is NOT redundant with existing guards
 *
 *   1. `updateMove` at `index.ts:5382` — only fires when BOTH `moveTarget`
 *      is null AND `path.length === 0`. C++ line 3786 only requires
 *      `!Target_Legal(NavCom)` (moveTarget null).
 *   2. `footPerCellProcess` — fires at cell-arrival (post-`moveToward` snap).
 *      Does NOT fire at Movement_AI entry before path-walking begins.
 *   3. `MISSION_MOVE_PATH_FAILURE` — fires when `missionTimerFired` AND
 *      path-is-blocked AND findPath-refresh-fails. Requires 3 stacked
 *      conditions vs C++'s single NavCom check.
 *   4. Mission.MOVE case `!moveTarget && !isDriving && missionQueue===null`
 *      at `index.ts:4153-4155` — currently sets `Mission=GUARD, Timer=0`
 *      DIRECTLY, not via queue+Commence. Does NOT match C++ Enter_Idle_Mode
 *      semantics (which queue GUARD, letting the next Commence pop).
 *
 * None of these fire when TS's moveTarget is set (via Coordinate_Patrol's
 * `unit.moveTarget = ...` at team.ts:1088 or :1113) but WASM's NavCom
 * would have been implicitly cleared by a chain that TS doesn't model.
 *
 * ## Gate rationale
 *
 * Shipping **OFF** by default. Flipping this guard ON is cross-cutting:
 *   - Every tick for every infantry in MOVE mission, the guard runs at the
 *     top of `updateMove`. If NavCom/moveTarget is missing for ANY reason
 *     (pathfinder refresh in-progress, coord queued but waypoint not yet
 *     assigned, transport-unload race), the guard queues GUARD prematurely.
 *   - SCG01/03/06/07 patrol teams depend on Mission_Move firing 60010 jitter
 *     on the tick after Commence pop — if the guard queues GUARD before the
 *     Mission_Move handler dispatches on the same tick, the jitter is
 *     missed and those scenarios regress (cf. prior 4a7ef2aa cascade).
 *
 * When flipped ON (a future session 4.1 or later), the guard fires only
 * when ALL of:
 *   1. `entity.stats.isInfantry` (vehicles go through UnitClass::AI, different Commence path).
 *   2. `entity.mission === Mission.MOVE` (exact C++ Mission==MOVE match).
 *   3. `entity.moveTarget === null` (C++ !Target_Legal(NavCom)).
 *   4. NOT `fromGuardDrive` (drives-in-GUARD path should not re-queue).
 *
 * Enter_Idle_Mode equivalent: queue GUARD (or AREA_GUARD when `guardOrigin`
 * is set), leave `missionQueue = GUARD`, do NOT reset missionTimer or
 * Mission. The post-dispatch Commence block at `index.ts:~4380` pops the
 * queue same-tick, matching WASM's `Commence()` call at `infantry.cpp:1210`.
 *
 * ## Regression acceptance criteria
 *
 * Before flipping ON:
 *   - Confirm SCG01 tick 87, SCG03 tick 247, SCG06 tick 66, SCG07 tick 17,
 *     SCG11 tick 28 all still pass the 500-tick first-divergence run.
 *   - Confirm SCG04 tick 36 behavior is unchanged (vehicle MCV, different
 *     code path — but a prophylactic check is cheap).
 *   - Confirm SCG13 advances past tick 101.
 *
 * ## C++ refs
 *
 *   infantry.cpp:3786-3788  Movement_AI top-of-handler guard (THIS port)
 *   infantry.cpp:1663-1721  Enter_Idle_Mode (GUARD vs GUARD_AREA)
 *   infantry.cpp:1208-1211  Pre-Commence on !IsDriving && idle
 *   foot.cpp:520-540        Mission_Move top-of-handler guard (adjacent case)
 *   mission.cpp:343-359     MissionClass::Commence
 *   team.cpp:1874-2008      Coordinate_Move (queues MOVE, assigns NavCom)
 *
 * ## TS refs
 *
 *   src/EasterEgg/engine/team.ts:1083-1114   coordinatePatrol infantry branch
 *   src/EasterEgg/engine/index.ts:5358-5386  updateMove entry
 *   src/EasterEgg/engine/index.ts:4041-4160  Mission.MOVE case handler
 */
export const MOVEMENT_AI_MOVE_NAVCOM_GUARD = false;

/**
 * Phase 1 — Mission-dispatch order reorder (JOINT-REFACTOR-ALL-DIVERGENCES-PLAN).
 *
 * When `true`, `Engine.updateEntity` runs the new STAGE A-F flow:
 *   A. Pre-MissionClass::AI Commence   (vehicles, unit.cpp:406)
 *   B. MissionClass::AI                (dispatch if missionTimer==0)
 *   C. Firing_AI                       (every tick, all missions)
 *   D. Movement_AI                     (infantry / drive-class / aircraft)
 *   E. Post-Movement_AI Commence       (vehicles unit.cpp:472, vessels :658)
 *   F. Re-dispatch if Commence popped  (generalizes drive-in-GUARD 79b13cb3)
 *
 * When `false` (default), the legacy top-level `missionTimerFired` capture +
 * monolithic switch flow runs byte-for-byte the same as main.
 *
 * Ships OFF. Flag flip lives in a dedicated commit once STAGE A-F land.
 *
 * ## What this enables / removes (plan §1 workaround ledger)
 *   - W7 (premature `missionTimerFired` capture at top of updateEntity)
 *   - W8 (special-case Mission.GUARD post-Commence dispatch — generalized)
 *   - W11 (direct mission=GUARD transition — replaced by queue+Commence)
 *   - W12 (inline Firing_AI-in-MOVE — replaced by STAGE C)
 *
 * ## C++ refs
 *   infantry.cpp:1237-1247  InfantryClass::AI (Firing_AI → Movement_AI order)
 *   unit.cpp:397-474        UnitClass::AI (pre-Commence + post-Commence bookends)
 *   vessel.cpp:591-659      VesselClass::AI (double Commence across DriveClass::AI)
 *   mission.cpp:213-321     MissionClass::AI (Timer==0 dispatch)
 *
 * ## TS refs
 *   src/EasterEgg/engine/index.ts ~4010  updateEntity — new STAGE A-F flow
 */
export const DISPATCH_ORDER_REFACTOR = true;

/**
 * Minimal entity shape for the hook. We intentionally keep this loose
 * (only the fields the hook actually reads/writes) so the module stays
 * free of the full `Entity` import and can be unit-tested in isolation.
 *
 * `mission` / `missionQueue` are typed as `M` generics because the engine
 * uses a string enum (`Mission`) that is not assignable to `number`. The
 * hook's Commence branch does a generic field swap (`mission = missionQueue`)
 * that works for any enum type, so we let callers parameterize.
 */
export interface PCPEntity<M = unknown> {
  moveTarget: { lx: number; ly: number } | null;
  cell: { cx: number; cy: number };
  path: Array<{ cx: number; cy: number }>;
  pathIndex: number;
  missionQueue: M | null;
  mission: M;
  missionTimer: number;
  isDriving: boolean;
  // Optional fields that full Commence port will touch (currently unused
  // by the NavCom-clear path, but documented here for future sub-cases).
  // status?: number;     // C++ Status — set to 0 by Commence
}

/**
 * Extended entity shape for `footPerCellProcess`. Adds the fields Enter_Idle_Mode
 * needs to check (`target`, `targetStructure`, `guardOrigin`) plus path-shorten
 * bookkeeping. Missing fields on a minimal caller are tolerated; only the
 * branches whose fields are present will run.
 *
 * Keeping the shape loose mirrors `PCPEntity<M>` above — no Entity import.
 */
export interface FootPCPEntity<M = unknown> extends PCPEntity<M> {
  /** TarCom equivalent #1: live entity target. `null` when no target. */
  target?: { alive: boolean } | null;
  /** TarCom equivalent #2: structure target. `null` when no target. */
  targetStructure?: unknown | null;
  /** AREA_GUARD origin marker. `null` when GUARD. Present = pick `AREA_GUARD`. */
  guardOrigin?: { x: number; y: number } | null;
}

/**
 * Which `GUARD` flavor to assign in `Enter_Idle_Mode`. The caller supplies
 * the concrete Mission enum values because this module does not import from
 * engine/types (keeps the hook self-contained for testing).
 *
 * C++ `Enter_Idle_Mode` is virtual (infantry.cpp has InfantryClass override)
 * — for standard infantry with no guard origin it queues MISSION_GUARD; when
 * IsInitiated + guardOrigin is set (e.g. Area Guard spawn), queues
 * MISSION_GUARD_AREA. TS mirrors this via `entity.guardOrigin != null`.
 */
export interface EnterIdleModeOptions<M> {
  guardMission: M;
  areaGuardMission: M;
}

/**
 * Result of a per-cell-process call, signalling whether the caller should
 * stop further movement this tick.
 */
export interface PCPResult {
  /**
   * True when the vehicle has arrived at its NavCom destination and
   * movement for this tick must halt. Matches the legacy
   * `perCellNavComCheck` return value.
   */
  navComCleared: boolean;

  /**
   * True when Commence popped MissionQueue. Currently always `false`
   * because `PER_CELL_COMMENCE_ENABLED === false`. When the gate flips,
   * callers can use this to skip the next-tick pre-Commence gate in
   * `updateEntity` (index.ts:3997) to avoid double-pop.
   */
  commenceFired: boolean;
}

/**
 * C++ parity hook: `UnitClass::Per_Cell_Process(PCPType)`.
 *
 * Called from the track-advance loop each time a vehicle crosses a cell
 * boundary. For now, this is only the NavCom-at-destination clear from
 * `DriveClass::Per_Cell_Process` (drive.cpp:869-873).
 *
 * Sub-cases not yet ported (see module header for the full C++ enumeration):
 *   - TODO(SCG04/11/13 port): Commence (unit.cpp:1756) — gated by
 *     PER_CELL_COMMENCE_ENABLED.
 *   - TODO(mine port): land-mine blow (unit.cpp:1807-1838).
 *   - TODO(flag port): flag pickup / flag-home (unit.cpp:1771-1802).
 *   - TODO(transport port): RADIO_IM_IN / IM_IN (unit.cpp:1636-1665).
 *
 * The existing TS engine handles several of these (vehicle crush,
 * Look() fog reveal) directly in `followTrackStep`'s mid-cell branch
 * — they are NOT duplicated here. This hook is additive, not a
 * rewrite of the existing track loop.
 *
 * @param entity  The vehicle/vessel crossing the boundary.
 * @param why     Which kind of boundary (PCP_DURING / PCP_END / PCP_ROTATION).
 * @returns       `{ navComCleared, commenceFired }` — callers should
 *                halt movement for this tick when `navComCleared === true`.
 */
export function unitPerCellProcess<M>(entity: PCPEntity<M>, why: PCPType): PCPResult {
  const result: PCPResult = { navComCleared: false, commenceFired: false };

  // Phase 0 DEBUG_PCP_TRACE — single bool check when flag unset (zero cost).
  const _pcpBefore = _PCP_TRACE_ENABLED ? _pcpSnapshot(entity) : null;

  // PCP_ROTATION: MCV-deploy branch and nothing else. Not currently used
  // by the TS engine's rotation path (rotation is decoupled from track
  // movement). Placeholder for future MCV-deploy parity work.
  if (why === PCPType.PCP_ROTATION) {
    // TODO(MCV deploy): invoke deploy-after-rotation path when IsDeploying
    // is set. C++ unit.cpp:1623-1626.
    if (_PCP_TRACE_ENABLED && _pcpBefore) _pcpTraceRecord(entity, why, _pcpBefore, result);
    return result;
  }

  // PCP_DURING: mid-track midpoint. C++ runs Overrun_Square and
  // crushable-overlay destruction here. The TS engine already handles
  // these inside `followTrackStep`'s mid-cell branch (index.ts:6481-6495),
  // so we intentionally no-op. A future refactor should move those calls
  // here for a cleaner one-to-one mapping with C++ sub-cases.
  if (why === PCPType.PCP_DURING) {
    if (_PCP_TRACE_ENABLED && _pcpBefore) _pcpTraceRecord(entity, why, _pcpBefore, result);
    return result;
  }

  // PCP_END: the main event. Order matches C++ UnitClass::Per_Cell_Process
  // + DriveClass::Per_Cell_Process call chain (unit.cpp:1882 hands off to
  // DriveClass::Per_Cell_Process after the UnitClass-specific work).

  // ---- 1. Commence (unit.cpp:1756) — GATED ----
  // Pops MissionQueue mid-drive. This is the load-bearing piece for
  // SCG04/11/13 but is gated off by default (see PER_CELL_COMMENCE_ENABLED
  // docstring for the three blocking reasons).
  if (PER_CELL_COMMENCE_ENABLED && entity.missionQueue !== null) {
    entity.mission = entity.missionQueue;
    entity.missionQueue = null;
    entity.missionTimer = 0; // C++ mission.cpp:354
    // C++ mission.cpp:355 sets Status=0. TS engine doesn't track Status on
    // vehicles (only infantry have a small status FSM for move/attack
    // animations). Safe to skip for vehicles.
    result.commenceFired = true;
  }

  // ---- 2. DriveClass::Per_Cell_Process NavCom-at-destination clear ----
  // C++ drive.cpp:869-873: if the current cell matches As_Cell(NavCom),
  // clear NavCom and Path[0]=FACING_NONE. This is the behavior the legacy
  // inline `perCellNavComCheck` did, preserved exactly.
  if (entity.moveTarget) {
    const navCellX = Math.floor(entity.moveTarget.lx / 256);
    const navCellY = Math.floor(entity.moveTarget.ly / 256);
    if (navCellX === entity.cell.cx && navCellY === entity.cell.cy) {
      entity.moveTarget = null;
      entity.path = [];
      entity.pathIndex = 0;
      result.navComCleared = true;
    }
  }

  if (_PCP_TRACE_ENABLED && _pcpBefore) _pcpTraceRecord(entity, why, _pcpBefore, result);
  return result;
}

/**
 * C++ parity hook: `InfantryClass::Per_Cell_Process(PCPType)` (chaining to
 * `FootClass::Per_Cell_Process`). Mirrors infantry.cpp:3992-4010 +
 * :911-914.
 *
 * Called at cell-arrival when `Distance(Head_To_Coord()) < 0x0010` (the
 * infantry-snap condition) from 3 sites in `index.ts`:
 *   - Mission.MOVE updateMove infantry free-form (index.ts:5665-5667)
 *   - Mission.HUNT Stop_Driver at waypoint arrival (index.ts:4150-4155)
 *   - Mission.AREA_GUARD analogous path (index.ts:4286-4291)
 *
 * C++ ordering (all three sub-cases run in sequence at PCP_END):
 *   1. **Path-shorten** (foot.cpp:1471-1483) — if TarCom is legal AND we're
 *      on an attack-type mission AND target is in primary-weapon range,
 *      clear NavCom + Path[0]. Gated by `PCP_PATH_SHORTEN_ENABLED` (Session 3).
 *   2. **Enter_Idle_Mode** (infantry.cpp:911) — when the FOUR guards hold,
 *      queue GUARD/AREA_GUARD (NOT mission=GUARD). Gated by
 *      `FOOT_PER_CELL_ENABLED` (Session 2 — this step).
 *   3. **Commence** (infantry.cpp:914) — pop MissionQueue, mirrors
 *      `unitPerCellProcess`'s Commence sub-case, reused via `PER_CELL_COMMENCE_ENABLED`.
 *
 * ## The four Enter_Idle_Mode guards (infantry.cpp:911)
 *
 * ```cpp
 * if (MissionQueue == MISSION_NONE
 *     && !Target_Legal(NavCom)
 *     && !Target_Legal(TarCom)
 *     && !In_Radio_Contact()) { Enter_Idle_Mode(); }
 * ```
 *
 * TS mapping (ALL must hold):
 *   - `entity.missionQueue === null`
 *   - `entity.moveTarget === null`           ← NavCom cleared
 *   - `entity.target === null && entity.targetStructure === null`  ← TarCom cleared
 *   - (no In_Radio_Contact equivalent for infantry in TS) ← always true
 *
 * **On `In_Radio_Contact` — documented absence:** C++ RadioClass tracks
 * peer-to-peer IM_IN / IM_OUT radio handshakes (e.g. between a vehicle and
 * its passenger entering/exiting, a harvester and its refinery). TS infantry
 * never enter radio contact in the current engine (no transport/refinery
 * handshake at the infantry level). Dropping the check is safe because the
 * TS-side `hasLegalTarCom` / `inRadioContact` flags are passed in by the
 * caller — the caller MAY supply `inRadioContact=true` to preserve the guard
 * if a future refactor adds infantry-level radio semantics.
 *
 * ## Why `missionQueue = GUARD` (not `mission = GUARD`)
 *
 * C++ `Enter_Idle_Mode` calls `Assign_Mission(MISSION_GUARD)` which sets
 * `MissionQueue`, not `Mission`. Then Commence() (step 3 above) pops it the
 * same tick — so `Mission` does transition to GUARD mid-tick, but only
 * after the intermediate queue step. If we set `mission=GUARD` directly, the
 * subsequent Commence pop would be a no-op (MissionQueue already null) — we
 * lose the `missionTimer=0` reset that Commence produces. This breaks
 * MissionClass::AI dispatch timing. Plan §8 S2.3 note calls this out.
 *
 * @param entity  The infantry crossing a cell boundary.
 * @param why     Which kind of boundary. Only PCP_END triggers the chain.
 * @param ctx     Caller-supplied flags:
 *                - `hasLegalTarCom`: set to `true` when `entity.target?.alive` or
 *                  `entity.targetStructure` is non-null (caller computes because
 *                  the hook doesn't depend on Entity types).
 *                - `inRadioContact`: ALWAYS `false` for TS infantry; reserved.
 * @param missions  Pass the Mission enum's GUARD and AREA_GUARD values.
 * @returns       `{ navComCleared, commenceFired }` — same contract as
 *                `unitPerCellProcess` for caller uniformity.
 */
export function footPerCellProcess<M>(
  entity: FootPCPEntity<M>,
  why: PCPType,
  ctx: {
    hasLegalTarCom: boolean;
    inRadioContact: boolean;
    /**
     * Session 3.1 — whether the current mission is one of C++'s attack-type
     * missions {RESCUE, GUARD_AREA, ATTACK, HUNT} (foot.cpp:1479). Callers that
     * predate Session 3 may omit; defaults to `false` (no path-shorten).
     */
    pathShortenEligible?: boolean;
    /**
     * Session 3.1 — whether the live TarCom target is within primary-weapon
     * range. C++ uses `In_Range(TarCom, primary)` with a Likely_Coord adjustment
     * for moving Foot targets (foot.cpp:1473-1477). Callers compute this via
     * `entity.inRange(entity.target)` or similar.
     */
    targetInRange?: boolean;
  },
  missions: EnterIdleModeOptions<M>
): PCPResult {
  const result: PCPResult = { navComCleared: false, commenceFired: false };

  // Phase 0 DEBUG_PCP_TRACE — single bool check when flag unset (zero cost).
  const _pcpBefore = _PCP_TRACE_ENABLED ? _pcpSnapshot(entity) : null;

  // Only PCP_END runs the chain; PCP_DURING / PCP_ROTATION are no-ops for
  // infantry (infantry don't have rotation tracks; PCP_DURING is vehicle-only).
  if (why !== PCPType.PCP_END) {
    if (_PCP_TRACE_ENABLED && _pcpBefore) _pcpTraceRecord(entity, why, _pcpBefore, result);
    return result;
  }

  // Master gate — Session 2.1 ships OFF; Session 2.3 flips ON after wiring.
  if (!FOOT_PER_CELL_ENABLED) {
    if (_PCP_TRACE_ENABLED && _pcpBefore) _pcpTraceRecord(entity, why, _pcpBefore, result);
    return result;
  }

  // ---- 1. Path-shorten (foot.cpp:1471-1483) — Session 3.1 ----
  //
  // C++ checks `Target_Legal(TarCom)` + weapon range of primary weapon + mission
  // ∈ { RESCUE, GUARD_AREA, ATTACK, HUNT }. If ALL hold:
  //   Assign_Destination(TARGET_NONE); Path[0] = FACING_NONE;
  //
  // TS: clear moveTarget + path + pathIndex. This stops further pathwalk and
  // lets Firing_AI engage the target on the next tick. The caller supplies all
  // three checks as pre-computed ctx booleans (module stays loose-typed).
  //
  // `navComCleared` is set so callers can short-circuit subsequent movement
  // this tick (mirrors the `unitPerCellProcess` NavCom-at-dest semantics).
  if (PCP_PATH_SHORTEN_ENABLED
      && ctx.hasLegalTarCom
      && ctx.pathShortenEligible === true
      && ctx.targetInRange === true) {
    entity.moveTarget = null;
    entity.path = [];
    entity.pathIndex = 0;
    result.navComCleared = true;
  }

  // ---- 2. Enter_Idle_Mode (infantry.cpp:911) ----
  //
  // The four-guard check. ALL must hold to queue Enter_Idle_Mode.
  //
  // NOTE ON `In_Radio_Contact`: TS infantry never participate in radio
  // handshakes in the current engine (no passenger/refinery IM_IN chain at
  // the infantry level). `ctx.inRadioContact` is accepted by the hook for
  // forward compatibility but callers pass `false` today. Documenting the
  // absence so future refactors (transport load/unload, MadTank commissar)
  // can flip this without re-deriving the invariant.
  const tarComClear = !ctx.hasLegalTarCom
    && (entity.target == null || entity.target.alive === false)
    && entity.targetStructure == null;

  if (entity.missionQueue === null
      && entity.moveTarget === null
      && tarComClear
      && !ctx.inRadioContact) {
    // C++ Enter_Idle_Mode() for InfantryClass calls Assign_Mission(MISSION_GUARD)
    // which sets MissionQueue (not Mission — Commence pops it next).
    // When `guardOrigin` is set, the AREA_GUARD flavor runs instead (C++ mirrors
    // this via IsInitiated + AreaPos state on team/deploy spawn).
    entity.missionQueue = entity.guardOrigin != null
      ? missions.areaGuardMission
      : missions.guardMission;
  }

  // ---- 3. Commence (infantry.cpp:914) ----
  //
  // Reuse the same Commence logic the vehicle hook uses. `PER_CELL_COMMENCE_ENABLED`
  // is already TRUE (vehicle per-cell Commence is live), so this branch fires
  // whenever the Enter_Idle_Mode branch above queued GUARD (or some prior
  // upstream caller queued a MOVE / HUNT). Same semantics: pop → Mission,
  // null queue, Timer=0.
  if (PER_CELL_COMMENCE_ENABLED && entity.missionQueue !== null) {
    entity.mission = entity.missionQueue;
    entity.missionQueue = null;
    entity.missionTimer = 0; // C++ mission.cpp:354
    result.commenceFired = true;
  }

  if (_PCP_TRACE_ENABLED && _pcpBefore) _pcpTraceRecord(entity, why, _pcpBefore, result);
  return result;
}
