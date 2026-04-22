/**
 * PCP refactor Session 1 — per-tick debug/dedup fields on Entity.
 *
 * Exercises the instrumentation added by plan §5 (speedBudgetConsumed,
 * cellBoundaryCrossings) and §6 (_commenceFiredThisTick,
 * _commenceFiredBoundaries). These fields are prerequisites for the
 * track-jump PCP wiring in step 1.2/1.3 — they must exist, default to
 * zero/false/empty, and be reset at the top of each updateEntity tick.
 *
 * C++ ref: drive.cpp:481-490 per-tick drive telemetry; mission.cpp:213-321
 * MissionClass::AI (Commence runs once per obj->AI() — no loop).
 */

import { describe, it, expect } from 'vitest';
import { Entity } from '../engine/entity';
import { UnitType, House } from '../engine/types';

describe('PCP debug/dedup fields on Entity (plan §5, §6)', () => {
  const makeE = () => new Entity(UnitType.E1, House.Greece, { x: 100, y: 100 });

  it('declares speedBudgetConsumed=0, cellBoundaryCrossings=0 by default', () => {
    const e = makeE();
    expect(e.speedBudgetConsumed).toBe(0);
    expect(e.cellBoundaryCrossings).toBe(0);
  });

  it('declares _commenceFiredThisTick=false by default', () => {
    const e = makeE();
    expect(e._commenceFiredThisTick).toBe(false);
  });

  it('declares _commenceFiredBoundaries as empty Set<string>', () => {
    const e = makeE();
    expect(e._commenceFiredBoundaries).toBeInstanceOf(Set);
    expect(e._commenceFiredBoundaries.size).toBe(0);
  });

  it('per-boundary dedup key "${trackIndex}-${pathIndex}" round-trips', () => {
    // Plan §6 dedup key format — a Set<string> keyed by the PCP boundary
    // moment, so a second PCP_END in the same tick at the same boundary
    // doesn't double-fire Commence.
    const e = makeE();
    e._commenceFiredBoundaries.add('3-5');
    expect(e._commenceFiredBoundaries.has('3-5')).toBe(true);
    expect(e._commenceFiredBoundaries.has('3-6')).toBe(false);
    e._commenceFiredBoundaries.clear();
    expect(e._commenceFiredBoundaries.size).toBe(0);
  });

  it('fields are writable (not getters) — supports per-tick mutation', () => {
    const e = makeE();
    e.speedBudgetConsumed = 40;
    e.cellBoundaryCrossings = 2;
    e._commenceFiredThisTick = true;
    expect(e.speedBudgetConsumed).toBe(40);
    expect(e.cellBoundaryCrossings).toBe(2);
    expect(e._commenceFiredThisTick).toBe(true);
  });
});
