/**
 * Per_Cell_Process scaffolding: behavioral contract for the hook module.
 *
 * This test validates the scaffolding (src/EasterEgg/engine/perCellProcess.ts)
 * that hooks into the vehicle track-advance loop. It is the landing-pad
 * for a future full port of C++ `UnitClass::Per_Cell_Process` — when that
 * port flips `PER_CELL_COMMENCE_ENABLED` to `true`, the tests below are
 * designed to FAIL, forcing the porter to update both the scaffolding
 * and the per-scenario expected-behavior tests (SCG04/11/13) together.
 *
 * See also:
 *   - `cpp-parity-scg11ea-tick-28.test.ts`  — WASM contract for MCV Commence
 *   - `cpp-parity-scg13ea-tick-101.test.ts` — WASM contract for MOVE→GUARD
 *   - `cpp-parity-scg04-mission-move-stagger.test.ts` — vehicle queue + pre-Commence gate
 */

import { describe, it, expect } from 'vitest';
import {
  PCPType,
  PER_CELL_COMMENCE_ENABLED,
  unitPerCellProcess,
  type PCPEntity,
} from '../engine/perCellProcess';

type M = 'GUARD' | 'MOVE' | 'ATTACK';

function makeEntity(overrides: Partial<PCPEntity<M>> = {}): PCPEntity<M> {
  return {
    moveTarget: null,
    cell: { cx: 0, cy: 0 },
    path: [],
    pathIndex: 0,
    missionQueue: null,
    mission: 'GUARD',
    missionTimer: 10,
    isDriving: false,
    ...overrides,
  };
}

describe('Per_Cell_Process scaffolding (src/EasterEgg/engine/perCellProcess.ts)', () => {
  it('has Commence gate ENABLED (SCG11EA tick-28 partial port)', () => {
    // Partial port landed: Commence fires at every PCP_END, matching
    // C++ unit.cpp:1756. See `cpp-parity-per-cell-process-enabled.test.ts`
    // for the full behavioral contract and `perCellProcess.ts` docstring
    // for documented-but-not-ported limitations.
    expect(PER_CELL_COMMENCE_ENABLED).toBe(true);
  });

  it('exposes three PCPType values (C++ PCP_DURING, PCP_END, PCP_ROTATION)', () => {
    expect(PCPType.PCP_DURING).toBe(0);
    expect(PCPType.PCP_END).toBe(1);
    expect(PCPType.PCP_ROTATION).toBe(2);
  });

  it('PCP_END clears NavCom when entity cell matches moveTarget cell', () => {
    // Legacy perCellNavComCheck behavior: when the entity has arrived at
    // its moveTarget cell, clear moveTarget + path. Matches C++
    // DriveClass::Per_Cell_Process (drive.cpp:869-873).
    const e = makeEntity({
      moveTarget: { lx: 10 * 256 + 128, ly: 20 * 256 + 128 },
      cell: { cx: 10, cy: 20 },
      path: [{ cx: 10, cy: 20 }],
      pathIndex: 0,
    });
    const r = unitPerCellProcess(e, PCPType.PCP_END);
    expect(r.navComCleared).toBe(true);
    expect(e.moveTarget).toBe(null);
    expect(e.path).toEqual([]);
    expect(e.pathIndex).toBe(0);
  });

  it('PCP_END does NOT clear NavCom mid-drive (before arrival)', () => {
    const e = makeEntity({
      moveTarget: { lx: 15 * 256 + 128, ly: 25 * 256 + 128 },
      cell: { cx: 12, cy: 20 }, // not at dest
      path: [{ cx: 13, cy: 20 }, { cx: 14, cy: 22 }, { cx: 15, cy: 25 }],
      pathIndex: 1,
    });
    const r = unitPerCellProcess(e, PCPType.PCP_END);
    expect(r.navComCleared).toBe(false);
    expect(e.moveTarget).not.toBe(null);
    expect(e.path.length).toBe(3);
    expect(e.pathIndex).toBe(1);
  });

  it('PCP_END fires Commence mid-drive when MissionQueue is non-null (C++ unit.cpp:1756)', () => {
    // Matches C++ UnitClass::Per_Cell_Process Commence branch: pop
    // MissionQueue → Mission, zero Timer. Fires at EVERY PCP_END, not
    // just destination arrival.
    const e = makeEntity({
      moveTarget: { lx: 20 * 256 + 128, ly: 30 * 256 + 128 },
      cell: { cx: 12, cy: 20 }, // mid-drive — not at dest
      missionQueue: 'MOVE',
      mission: 'GUARD',
      missionTimer: 7,
    });
    const r = unitPerCellProcess(e, PCPType.PCP_END);
    expect(r.commenceFired).toBe(true);
    expect(e.mission).toBe('MOVE'); // popped from queue
    expect(e.missionQueue).toBe(null); // cleared
    expect(e.missionTimer).toBe(0); // C++ mission.cpp:354
    // NavCom clear does NOT fire at mid-drive (cell != dest)
    expect(r.navComCleared).toBe(false);
    expect(e.moveTarget).not.toBe(null);
  });

  it('PCP_END Commence is a no-op when MissionQueue is empty', () => {
    // C++ mission.cpp:347: Commence returns false when MissionQueue==NONE.
    const e = makeEntity({
      moveTarget: { lx: 20 * 256 + 128, ly: 30 * 256 + 128 },
      cell: { cx: 12, cy: 20 },
      missionQueue: null,
      mission: 'MOVE',
      missionTimer: 7,
    });
    const r = unitPerCellProcess(e, PCPType.PCP_END);
    expect(r.commenceFired).toBe(false);
    expect(e.mission).toBe('MOVE'); // untouched
    expect(e.missionTimer).toBe(7); // untouched
  });

  it('PCP_END Commence fires BEFORE NavCom-at-destination clear (C++ unit.cpp:1756 → 1882 order)', () => {
    // When a vehicle arrives at destination with MissionQueue=MOVE queued,
    // both Commence AND NavCom-clear fire in one PCP_END call. Commence
    // runs first (UnitClass::Per_Cell_Process line 1756), then NavCom
    // clear (DriveClass::Per_Cell_Process line 869 via the base-class
    // call at line 1882).
    const e = makeEntity({
      moveTarget: { lx: 10 * 256 + 128, ly: 20 * 256 + 128 },
      cell: { cx: 10, cy: 20 }, // at destination
      missionQueue: 'MOVE',
      mission: 'GUARD',
      missionTimer: 5,
    });
    const r = unitPerCellProcess(e, PCPType.PCP_END);
    expect(r.commenceFired).toBe(true);
    expect(r.navComCleared).toBe(true);
    expect(e.mission).toBe('MOVE');
    expect(e.missionQueue).toBe(null);
    expect(e.missionTimer).toBe(0);
    expect(e.moveTarget).toBe(null);
    expect(e.path).toEqual([]);
  });

  it('PCP_DURING is a no-op (mid-track midpoint — crush/overlay handled in followTrackStep)', () => {
    const e = makeEntity({
      moveTarget: { lx: 5 * 256 + 128, ly: 5 * 256 + 128 },
      cell: { cx: 5, cy: 5 },
      missionQueue: 'MOVE',
    });
    const r = unitPerCellProcess(e, PCPType.PCP_DURING);
    // No NavCom clear on DURING (C++ drive.cpp:735-742 only runs
    // Overrun_Square and crushable-overlay destruction — no NavCom check)
    expect(r.navComCleared).toBe(false);
    expect(r.commenceFired).toBe(false);
    expect(e.moveTarget).not.toBe(null);
    expect(e.missionQueue).toBe('MOVE');
  });

  it('PCP_ROTATION is a no-op (MCV-deploy branch not yet ported)', () => {
    const e = makeEntity({
      moveTarget: { lx: 10 * 256 + 128, ly: 10 * 256 + 128 },
      cell: { cx: 10, cy: 10 },
      missionQueue: 'MOVE',
    });
    const r = unitPerCellProcess(e, PCPType.PCP_ROTATION);
    expect(r.navComCleared).toBe(false);
    expect(r.commenceFired).toBe(false);
  });

  it('PCPResult shape: { navComCleared: boolean, commenceFired: boolean }', () => {
    const e = makeEntity();
    const r = unitPerCellProcess(e, PCPType.PCP_END);
    expect(typeof r.navComCleared).toBe('boolean');
    expect(typeof r.commenceFired).toBe('boolean');
  });
});
