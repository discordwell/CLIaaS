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

  // PCP_ROTATION: MCV-deploy branch and nothing else. Not currently used
  // by the TS engine's rotation path (rotation is decoupled from track
  // movement). Placeholder for future MCV-deploy parity work.
  if (why === PCPType.PCP_ROTATION) {
    // TODO(MCV deploy): invoke deploy-after-rotation path when IsDeploying
    // is set. C++ unit.cpp:1623-1626.
    return result;
  }

  // PCP_DURING: mid-track midpoint. C++ runs Overrun_Square and
  // crushable-overlay destruction here. The TS engine already handles
  // these inside `followTrackStep`'s mid-cell branch (index.ts:6481-6495),
  // so we intentionally no-op. A future refactor should move those calls
  // here for a cleaner one-to-one mapping with C++ sub-cases.
  if (why === PCPType.PCP_DURING) {
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

  return result;
}
