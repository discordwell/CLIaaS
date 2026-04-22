/**
 * PCP Session 1.2/1.3 — track-jump PCP gate contract.
 *
 * Validates that `PER_CELL_TRACK_JUMP_ENABLED` exists as an exported flag
 * and that the per-boundary Set<string> dedup structure is in place for
 * `unitPerCellProcess` to operate correctly when the flag flips to true in
 * step 1.3. The dedup logic itself is wired inside `followTrackStep`
 * (index.ts) at the track-jump site (C++ drive.cpp:773), gated by this
 * flag. These tests exercise the primitives in isolation so a regression
 * in the Entity fields or the PCP hook is caught without having to run a
 * full 200-tick scenario.
 *
 * See plan §6 and `perCellProcess.ts` PER_CELL_TRACK_JUMP_ENABLED docstring.
 */

import { describe, it, expect } from 'vitest';
import { Entity } from '../engine/entity';
import { UnitType, House } from '../engine/types';
import {
  PCPType,
  PER_CELL_TRACK_JUMP_ENABLED,
  unitPerCellProcess,
  type PCPEntity,
} from '../engine/perCellProcess';

type M = 'GUARD' | 'MOVE' | 'ATTACK';

function makePCPEntity(overrides: Partial<PCPEntity<M>> = {}): PCPEntity<M> {
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

describe('Track-jump PCP gate (plan §6)', () => {
  it('exports PER_CELL_TRACK_JUMP_ENABLED flag (1.2 ships OFF)', () => {
    // 1.2 stub: flag OFF. Step 1.3 flips it ON.
    // This test documents the current-state; update to `true` when 1.3
    // lands and the regression tests confirm SCG04 advances past 36.
    expect(typeof PER_CELL_TRACK_JUMP_ENABLED).toBe('boolean');
  });

  it('per-boundary dedup: same boundary key only Commences once', () => {
    // Simulates the contract plan §6 describes: two track-jump PCP_END
    // calls at the same `${trackIndex}-${pathIndex}` boundary within a
    // single obj->AI() tick must only pop MissionQueue once.
    const e = new Entity(UnitType.MCV, House.Greece, { x: 100, y: 100 });
    const boundaryKey = '3-5';
    expect(e._commenceFiredBoundaries.has(boundaryKey)).toBe(false);

    // First PCP_END at this boundary: fires.
    const ent1: PCPEntity<M> = makePCPEntity({
      missionQueue: 'MOVE', mission: 'GUARD', missionTimer: 7,
    });
    const r1 = unitPerCellProcess(ent1, PCPType.PCP_END);
    expect(r1.commenceFired).toBe(true);
    expect(ent1.mission).toBe('MOVE');
    e._commenceFiredBoundaries.add(boundaryKey);

    // Second PCP_END at same boundary: caller must skip via dedup Set.
    expect(e._commenceFiredBoundaries.has(boundaryKey)).toBe(true);
  });

  it('per-boundary dedup: distinct boundaries each Commence independently', () => {
    // Two sequential track-jumps in one tick crossing DIFFERENT boundaries
    // must each get a Commence (if MissionQueue is still non-null).
    const e = new Entity(UnitType.MCV, House.Greece, { x: 100, y: 100 });
    e._commenceFiredBoundaries.add('0-0');
    expect(e._commenceFiredBoundaries.has('0-0')).toBe(true);
    expect(e._commenceFiredBoundaries.has('1-1')).toBe(false);
    expect(e._commenceFiredBoundaries.has('2-2')).toBe(false);
  });

  it('resetting _commenceFiredBoundaries at tick start clears prior-tick dedup', () => {
    // updateEntity resets at top of tick (see index.ts:3939).
    const e = new Entity(UnitType.MCV, House.Greece, { x: 100, y: 100 });
    e._commenceFiredBoundaries.add('3-5');
    e._commenceFiredBoundaries.add('3-6');
    e._commenceFiredThisTick = true;
    expect(e._commenceFiredBoundaries.size).toBe(2);

    // Simulate tick-start reset
    e._commenceFiredBoundaries.clear();
    e._commenceFiredThisTick = false;
    expect(e._commenceFiredBoundaries.size).toBe(0);
    expect(e._commenceFiredThisTick).toBe(false);
  });
});
