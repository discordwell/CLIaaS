/**
 * Tests for C++ RA-style rotation accumulator system.
 * Verifies: Mammoth (rot=5) ~6 ticks/facing, infantry snaps, turret 2x body.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { Entity, resetEntityIds } from '../engine/entity';
import { Dir, UnitType, House } from '../engine/types';

beforeEach(() => resetEntityIds());

describe('tickRotation — accumulator system', () => {
  it('infantry (rot=8) snaps to desired facing instantly', () => {
    const inf = new Entity(UnitType.I_E1, House.Spain, 100, 100);
    inf.facing = Dir.N;
    inf.desiredFacing = Dir.SE;
    const done = inf.tickRotation();
    expect(done).toBe(true);
    expect(inf.facing).toBe(Dir.SE);
  });

  it('Mammoth Tank (rot=5) takes ~7 ticks to advance one facing', () => {
    // rot=5: accumulator += 5 each tick, needs >= 32 to step
    // ceil(32/5) = 7 ticks for first facing step
    const mammoth = new Entity(UnitType.V_4TNK, House.Spain, 100, 100);
    expect(mammoth.stats.rot).toBe(5);
    mammoth.facing = Dir.N;
    mammoth.desiredFacing = Dir.E; // 2 steps clockwise

    let ticksForFirst = 0;
    while (mammoth.facing === Dir.N && ticksForFirst < 20) {
      mammoth.rotTickedThisFrame = false; // simulate frame reset
      mammoth.tickRotation();
      ticksForFirst++;
    }
    // 32 / 5 = 6.4 → first step at tick 7 (accumulator: 5,10,15,20,25,30,35 → step)
    expect(ticksForFirst).toBe(7);
    expect(mammoth.facing).toBe(Dir.NE);
  });

  it('Artillery (rot=2) rotates very slowly — ~16 ticks per facing', () => {
    const arty = new Entity(UnitType.V_ARTY, House.Spain, 100, 100);
    expect(arty.stats.rot).toBe(2);
    arty.facing = Dir.N;
    arty.desiredFacing = Dir.NE;

    let ticks = 0;
    while (arty.facing === Dir.N && ticks < 30) {
      arty.rotTickedThisFrame = false;
      arty.tickRotation();
      ticks++;
    }
    // ceil(32/2) = 16 ticks
    expect(ticks).toBe(16);
    expect(arty.facing).toBe(Dir.NE);
  });

  it('prevents double-accumulation in the same frame', () => {
    const tank = new Entity(UnitType.V_2TNK, House.Spain, 100, 100);
    tank.facing = Dir.N;
    tank.desiredFacing = Dir.E;
    tank.rotTickedThisFrame = false;

    // First call accumulates
    tank.tickRotation();
    expect(tank.rotTickedThisFrame).toBe(true);

    // Second call in same frame does nothing
    const accBefore = tank.rotAccumulator;
    tank.tickRotation();
    expect(tank.rotAccumulator).toBe(accBefore);
  });

  it('resets accumulator when facing matches desired', () => {
    const tank = new Entity(UnitType.V_1TNK, House.Spain, 100, 100);
    tank.facing = Dir.N;
    tank.desiredFacing = Dir.N;
    tank.rotAccumulator = 15; // leftover from previous rotation

    const done = tank.tickRotation();
    expect(done).toBe(true);
    expect(tank.rotAccumulator).toBe(0);
  });

  it('rotates via shortest path (counter-clockwise when diff > 4)', () => {
    const tank = new Entity(UnitType.V_1TNK, House.Spain, 100, 100);
    tank.facing = Dir.N; // 0
    tank.desiredFacing = Dir.NW; // 7 — diff is 7, should go counter-clockwise

    // Force enough ticks to see one step
    for (let i = 0; i < 7; i++) {
      tank.rotTickedThisFrame = false;
      tank.tickRotation();
    }
    // Should have rotated N(0) → NW(7) via counter-clockwise
    expect(tank.facing).toBe(Dir.NW);
  });
});

describe('tickTurretRotation — 2x body speed', () => {
  it('turret rotates at 2x body speed for rot=5 tank', () => {
    const tank = new Entity(UnitType.V_2TNK, House.Spain, 100, 100);
    expect(tank.stats.rot).toBe(5);
    tank.turretFacing = Dir.N;
    tank.desiredTurretFacing = Dir.NE;

    let ticks = 0;
    while (tank.turretFacing === Dir.N && ticks < 10) {
      tank.turretRotTickedThisFrame = false;
      tank.tickTurretRotation();
      ticks++;
    }
    // Turret: rot*2 = 10 per tick, ceil(32/10) = 4 ticks
    expect(ticks).toBe(4);
    expect(tank.turretFacing).toBe(Dir.NE);
  });

  it('turret rotation is roughly 2x faster than body for same unit', () => {
    const tank = new Entity(UnitType.V_2TNK, House.Spain, 100, 100);

    // Body rotation: rot=5, one step = ceil(32/5) = 7 ticks
    tank.facing = Dir.N;
    tank.desiredFacing = Dir.NE;
    let bodyTicks = 0;
    while (tank.facing === Dir.N && bodyTicks < 20) {
      tank.rotTickedThisFrame = false;
      tank.tickRotation();
      bodyTicks++;
    }

    // Turret rotation: rot*2=10, one step = ceil(32/10) = 4 ticks
    tank.turretFacing = Dir.N;
    tank.desiredTurretFacing = Dir.NE;
    let turretTicks = 0;
    while (tank.turretFacing === Dir.N && turretTicks < 20) {
      tank.turretRotTickedThisFrame = false;
      tank.tickTurretRotation();
      turretTicks++;
    }

    // Turret should be roughly 2x faster (7 vs 4 ticks)
    expect(turretTicks).toBeLessThan(bodyTicks);
    expect(bodyTicks / turretTicks).toBeGreaterThanOrEqual(1.5);
  });
});
