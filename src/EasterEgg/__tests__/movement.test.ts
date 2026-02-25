/**
 * Tests for stop-rotate-move behavior.
 * Verifies: vehicles stop during rotation, infantry moves while rotating.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { Entity, resetEntityIds } from '../engine/entity';
import { Dir, UnitType, House, CELL_SIZE } from '../engine/types';

beforeEach(() => resetEntityIds());

describe('moveToward — stop-rotate-move', () => {
  it('vehicle does NOT move while rotating to face target', () => {
    const tank = new Entity(UnitType.V_2TNK, House.Spain, 100, 100);
    tank.facing = Dir.N;
    // Target is to the east — needs to rotate from N to E
    const target = { x: 200, y: 100 };

    const startX = tank.pos.x;
    const startY = tank.pos.y;

    // First tick: vehicle should rotate but not move
    tank.rotTickedThisFrame = false;
    tank.moveToward(target, tank.stats.speed * 0.5);

    // Vehicle should NOT have moved (still rotating from N toward E)
    expect(tank.pos.x).toBe(startX);
    expect(tank.pos.y).toBe(startY);
  });

  it('vehicle moves once facing is aligned', () => {
    const tank = new Entity(UnitType.V_2TNK, House.Spain, 100, 100);
    // Pre-align facing to target direction
    tank.facing = Dir.E;
    const target = { x: 200, y: 100 };

    const startX = tank.pos.x;
    tank.rotTickedThisFrame = false;
    tank.moveToward(target, tank.stats.speed * 0.5);

    // Should have moved toward target
    expect(tank.pos.x).toBeGreaterThan(startX);
  });

  it('infantry moves while rotating (nimble)', () => {
    const inf = new Entity(UnitType.I_E1, House.Spain, 100, 100);
    inf.facing = Dir.N; // Will snap to E instantly (rot=8)
    const target = { x: 200, y: 100 };

    const startX = inf.pos.x;
    inf.rotTickedThisFrame = false;
    inf.moveToward(target, inf.stats.speed * 0.5);

    // Infantry should have moved (rot=8 snaps facing, then moves)
    expect(inf.pos.x).toBeGreaterThan(startX);
  });

  it('vehicle completes stop-rotate-move sequence correctly', () => {
    const tank = new Entity(UnitType.V_1TNK, House.Spain, 100, 100);
    expect(tank.stats.rot).toBe(5);
    tank.facing = Dir.N;
    // Target is to the south-east
    const target = { x: 200, y: 200 };
    const speed = 4;

    let movedTick = -1;
    // Run for enough ticks to rotate and start moving
    for (let t = 0; t < 30; t++) {
      tank.rotTickedThisFrame = false;
      const startX = tank.pos.x;
      tank.moveToward(target, speed);
      if (tank.pos.x !== startX && movedTick < 0) {
        movedTick = t;
      }
    }

    // Should have eventually moved
    expect(movedTick).toBeGreaterThan(0);
    // Should NOT have moved on tick 0 (was facing wrong direction)
    expect(movedTick).toBeGreaterThan(1);
  });

  it('vehicle arrives at target when already facing correct direction', () => {
    const tank = new Entity(UnitType.V_2TNK, House.Spain, 100, 100);
    tank.facing = Dir.E;
    // Target very close — within one speed step
    const target = { x: 103, y: 100 };
    tank.rotTickedThisFrame = false;
    const arrived = tank.moveToward(target, 5);
    expect(arrived).toBe(true);
    expect(tank.pos.x).toBe(target.x);
    expect(tank.pos.y).toBe(target.y);
  });
});
