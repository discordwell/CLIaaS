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
  it('has Commence gate DISABLED by default (preserves legacy behavior)', () => {
    // Flipping this to true requires also updating the SCG04/11/13 parity
    // tests to match the new expected behavior. See perCellProcess.ts
    // docstring for the three blocking reasons.
    expect(PER_CELL_COMMENCE_ENABLED).toBe(false);
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

  it('PCP_END does NOT fire Commence while gate is disabled (SCG04/11/13 blocker)', () => {
    // Queue a MOVE mission; hook should LEAVE it queued while the gate
    // is off. Future port flips the gate and this expectation changes.
    const e = makeEntity({
      moveTarget: { lx: 20 * 256 + 128, ly: 30 * 256 + 128 },
      cell: { cx: 12, cy: 20 }, // mid-drive — not at dest
      missionQueue: 'MOVE',
      mission: 'GUARD',
      missionTimer: 7,
    });
    const r = unitPerCellProcess(e, PCPType.PCP_END);
    expect(r.commenceFired).toBe(false);
    expect(e.mission).toBe('GUARD'); // unchanged
    expect(e.missionQueue).toBe('MOVE'); // still queued
    expect(e.missionTimer).toBe(7); // untouched
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
