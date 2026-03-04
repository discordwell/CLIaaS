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

    // Should arrive exactly at target, not overshoot
    expect(tank.pos.x).toBeCloseTo(102, 1);
    expect(tank.pos.y).toBeCloseTo(100, 1);
    expect(arrived).toBe(true);
  });

  it('snaps to target when within 0.5px threshold', () => {
    const inf = new Entity(UnitType.I_E1, House.Spain, 100.3, 100.2);
    const target = { x: 100, y: 100 };

    inf.rotTickedThisFrame = false;
    const arrived = inf.moveToward(target, 1);

    expect(inf.pos.x).toBe(100);
    expect(inf.pos.y).toBe(100);
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

  it('returns true (arrived) when movement covers remaining distance', () => {
    const inf = new Entity(UnitType.I_E1, House.Spain, 100, 100);
    const target = { x: 103, y: 100 };

    inf.rotTickedThisFrame = false;
    // Speed of 5 > distance of 3, should arrive in one step
    const arrived = inf.moveToward(target, 5);

    expect(arrived).toBe(true);
    expect(inf.pos.x).toBeCloseTo(103, 1);
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
