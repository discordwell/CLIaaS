/**
 * Tests for movement jitter fixes — overshoot prevention, path stability.
 * Verifies: units don't oscillate at waypoints, moveToward clamps to distance.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { Entity, resetEntityIds } from '../engine/entity';
import { Dir, UnitType, House, CELL_SIZE } from '../engine/types';

beforeEach(() => resetEntityIds());

describe('moveToward — overshoot prevention', () => {
  it('clamps movement to remaining distance when speed > distance', () => {
    const tank = new Entity(UnitType.V_2TNK, House.Spain, 100, 100);
    tank.facing = Dir.E;
    // Target is only 2px away but speed would move 5+px
    const target = { x: 102, y: 100 };

    tank.rotTickedThisFrame = false;
    const arrived = tank.moveToward(target, 10);

    // Should arrive at lepton-quantized target, not overshoot
    // Lepton quantization: Math.trunc(102/LP)*LP = 101.8125, Math.trunc(100/LP)*LP = 99.9375
    expect(tank.pos.x).toBeCloseTo(102, 0);
    expect(tank.pos.y).toBeCloseTo(100, 0);
    expect(arrived).toBe(true);
  });

  it('snaps to target when within 0.5px threshold', () => {
    // Use lepton-aligned coordinates: 96/LP=1024 (exact), so pos matches exactly.
    // Entity at 96.3, target at 96. Distance 0.3 < 1.5 (infantry snap=16 leptons).
    const inf = new Entity(UnitType.I_E1, House.Spain, 96.3, 96.2);
    const target = { x: 96, y: 96 }; // lepton-aligned: 96/LP = 1024

    inf.rotTickedThisFrame = false;
    const arrived = inf.moveToward(target, 1);

    expect(inf.pos.x).toBe(96);
    expect(inf.pos.y).toBe(96);
    expect(arrived).toBe(true);
  });

  it('does not overshoot when speed exceeds remaining distance', () => {
    const tank = new Entity(UnitType.V_1TNK, House.Spain, 100, 100);
    tank.facing = Dir.S;
    const target = { x: 100, y: 101 }; // 1px away

    tank.rotTickedThisFrame = false;
    const arrived = tank.moveToward(target, 5);

    // Should be at or very close to target, NOT past it
    expect(tank.pos.y).toBeLessThanOrEqual(101);
    expect(tank.pos.y).toBeGreaterThanOrEqual(100);
    expect(arrived).toBe(true);
  });

  it('infantry direct Coord_Move can overshoot until the pre-move snap radius is reached', () => {
    const inf = new Entity(UnitType.I_E1, House.Spain, 100, 100);
    const target = { x: 103, y: 100 };

    inf.rotTickedThisFrame = false;
    // C++ infantry: pre-movement snap at Distance < 16 leptons (about 1.5px).
    // Distance 3px ≈ 32 leptons > 16, so first call moves but doesn't snap.
    const arrived1 = inf.moveToward(target, 5);
    expect(arrived1).toBe(false);

    // C++ infantry.cpp applies Coord_Move without a post-move clamp. Low-level
    // direct movement can overshoot a nearby target instead of reporting arrival.
    inf.rotTickedThisFrame = false;
    const arrived2 = inf.moveToward(target, 5);
    expect(arrived2).toBe(false);
    expect(inf.pos.x).toBeLessThan(103);
  });
});

describe('moveToward — no oscillation at boundaries', () => {
  it('unit does not jitter when repeatedly moving to nearby target', () => {
    const tank = new Entity(UnitType.V_2TNK, House.Spain, 100, 100);
    tank.facing = Dir.E;
    const target = { x: 105, y: 100 };

    const positions: number[] = [];
    for (let i = 0; i < 10; i++) {
      tank.rotTickedThisFrame = false;
      tank.moveToward(target, 2);
      positions.push(tank.pos.x);
    }

    // Position should monotonically increase (no backtracking)
    for (let i = 1; i < positions.length; i++) {
      expect(positions[i]).toBeGreaterThanOrEqual(positions[i - 1]);
    }
  });

  it('infantry position monotonically approaches target', () => {
    const inf = new Entity(UnitType.I_E1, House.Spain, 50, 50);
    const target = { x: 80, y: 50 };

    const distances: number[] = [];
    for (let i = 0; i < 20; i++) {
      inf.rotTickedThisFrame = false;
      const arrived = inf.moveToward(target, 2);
      const dist = Math.abs(inf.pos.x - target.x);
      distances.push(dist);
      if (arrived) break;
    }

    // Distance should monotonically decrease
    for (let i = 1; i < distances.length; i++) {
      expect(distances[i]).toBeLessThanOrEqual(distances[i - 1]);
    }
  });
});
