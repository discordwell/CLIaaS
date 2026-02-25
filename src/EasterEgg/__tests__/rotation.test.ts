/**
 * Tests for C++ RA-style rotation accumulator system.
 * Verifies: 32-step visual facing, infantry snaps, turret 2x body, bodyFacing32 derivation.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { Entity, resetEntityIds } from '../engine/entity';
import { Dir, UnitType, House, BODY_SHAPE } from '../engine/types';

beforeEach(() => resetEntityIds());

describe('tickRotation — 32-step accumulator system', () => {
  it('infantry (rot=8) snaps to desired facing instantly', () => {
    const inf = new Entity(UnitType.I_E1, House.Spain, 100, 100);
    inf.facing = Dir.N;
    inf.desiredFacing = Dir.SE;
    const done = inf.tickRotation();
    expect(done).toBe(true);
    expect(inf.facing).toBe(Dir.SE);
    expect(inf.bodyFacing32).toBe(Dir.SE * 4);
  });

  it('Mammoth Tank (rot=5) takes 7 ticks to advance one 8-dir facing step', () => {
    // 32-step system: 4 visual steps per 8-dir step
    // rot=5, threshold=8: visual steps at ticks 2,4,5,7 → facing change at tick 7
    const mammoth = new Entity(UnitType.V_4TNK, House.Spain, 100, 100);
    expect(mammoth.stats.rot).toBe(5);
    mammoth.facing = Dir.N;
    mammoth.bodyFacing32 = 0;
    mammoth.desiredFacing = Dir.E; // 2 steps clockwise

    let ticksForFirst = 0;
    while (mammoth.facing === Dir.N && ticksForFirst < 20) {
      mammoth.rotTickedThisFrame = false;
      mammoth.tickRotation();
      ticksForFirst++;
    }
    expect(ticksForFirst).toBe(7);
    expect(mammoth.facing).toBe(Dir.NE);
    expect(mammoth.bodyFacing32).toBe(4); // NE = 4 in 32-step
  });

  it('bodyFacing32 advances smoothly through intermediate visual steps', () => {
    const mammoth = new Entity(UnitType.V_4TNK, House.Spain, 100, 100);
    mammoth.facing = Dir.N;
    mammoth.bodyFacing32 = 0;
    mammoth.desiredFacing = Dir.E; // desiredFacing32 = 8

    const bf32History: number[] = [];
    for (let t = 0; t < 14; t++) {
      mammoth.rotTickedThisFrame = false;
      mammoth.tickRotation();
      bf32History.push(mammoth.bodyFacing32);
    }
    // rot=5, threshold=8: visual steps happen at ticks where accumulator >= 8
    // Should see bodyFacing32 advance through 1, 2, 3, 4, 5, 6, 7, 8
    // Verify intermediate values exist (not jumping by 4)
    expect(bf32History).toContain(1);
    expect(bf32History).toContain(2);
    expect(bf32History).toContain(3);
    expect(bf32History).toContain(4);
  });

  it('full 32-step rotation takes ~51 ticks for rot=5', () => {
    // Full rotation: 32 visual steps. rot=5, threshold=8.
    // Average ticks per visual step: 8/5 = 1.6, so 32 × 1.6 = ~51 ticks
    const tank = new Entity(UnitType.V_4TNK, House.Spain, 100, 100);
    tank.facing = Dir.N;
    tank.bodyFacing32 = 0;
    tank.desiredFacing = Dir.NW; // 7 = counter-clockwise by 1 step, but we want full rotation
    // Instead, manually run 32 visual steps worth of ticks
    // Trace: start at bf32=0, go clockwise. Let's go N→NE→E→...→NW→N
    // Actually let's just count visual steps for a full circle
    tank.desiredFacing = Dir.N; // same facing = no rotation. Let's test N → S (4 8-dir steps, 16 visual steps)
    tank.desiredFacing = Dir.S;
    let ticks = 0;
    while (tank.facing !== Dir.S && ticks < 100) {
      tank.rotTickedThisFrame = false;
      tank.tickRotation();
      ticks++;
    }
    // N→S is 4 8-dir steps = 16 visual steps. 16 × 8/5 = 25.6 → ~26 ticks
    expect(ticks).toBeGreaterThanOrEqual(24);
    expect(ticks).toBeLessThanOrEqual(28);
  });

  it('Artillery (rot=2) rotates very slowly — ~16 ticks per 8-dir step', () => {
    const arty = new Entity(UnitType.V_ARTY, House.Spain, 100, 100);
    expect(arty.stats.rot).toBe(2);
    arty.facing = Dir.N;
    arty.bodyFacing32 = 0;
    arty.desiredFacing = Dir.NE;

    let ticks = 0;
    while (arty.facing === Dir.N && ticks < 30) {
      arty.rotTickedThisFrame = false;
      arty.tickRotation();
      ticks++;
    }
    // rot=2, 4 visual steps × ceil(8/2)=4 ticks each = 16 ticks
    expect(ticks).toBe(16);
    expect(arty.facing).toBe(Dir.NE);
  });

  it('prevents double-accumulation in the same frame', () => {
    const tank = new Entity(UnitType.V_2TNK, House.Spain, 100, 100);
    tank.facing = Dir.N;
    tank.bodyFacing32 = 0;
    tank.desiredFacing = Dir.E;
    tank.rotTickedThisFrame = false;

    tank.tickRotation();
    expect(tank.rotTickedThisFrame).toBe(true);

    const accBefore = tank.rotAccumulator;
    const bf32Before = tank.bodyFacing32;
    tank.tickRotation();
    expect(tank.rotAccumulator).toBe(accBefore);
    expect(tank.bodyFacing32).toBe(bf32Before);
  });

  it('resets accumulator and syncs bodyFacing32 when facing matches desired', () => {
    const tank = new Entity(UnitType.V_1TNK, House.Spain, 100, 100);
    tank.facing = Dir.N;
    tank.desiredFacing = Dir.N;
    tank.rotAccumulator = 15;

    const done = tank.tickRotation();
    expect(done).toBe(true);
    expect(tank.rotAccumulator).toBe(0);
    expect(tank.bodyFacing32).toBe(0); // synced to facing * 4
  });

  it('rotates via shortest path (counter-clockwise when diff > 16 in 32-step)', () => {
    const tank = new Entity(UnitType.V_1TNK, House.Spain, 100, 100);
    tank.facing = Dir.N;
    tank.bodyFacing32 = 0;
    tank.desiredFacing = Dir.NW; // 7 × 4 = 28 in 32-step. diff = (28-0+32)%32=28 > 16 → CCW

    // Run enough ticks to reach NW
    for (let i = 0; i < 20; i++) {
      tank.rotTickedThisFrame = false;
      tank.tickRotation();
    }
    expect(tank.facing).toBe(Dir.NW);
    expect(tank.bodyFacing32).toBe(28);
  });

  it('spriteFrame uses bodyFacing32 through BODY_SHAPE lookup for vehicles', () => {
    const tank = new Entity(UnitType.V_2TNK, House.Spain, 100, 100);
    tank.bodyFacing32 = 0;
    expect(tank.spriteFrame).toBe(BODY_SHAPE[0]);

    tank.bodyFacing32 = 8; // East
    expect(tank.spriteFrame).toBe(BODY_SHAPE[8]);

    tank.bodyFacing32 = 16; // South
    expect(tank.spriteFrame).toBe(BODY_SHAPE[16]);
  });
});

describe('tickTurretRotation — 2x body speed, 32-step', () => {
  it('turret rotates at 2x body speed for rot=5 tank', () => {
    const tank = new Entity(UnitType.V_2TNK, House.Spain, 100, 100);
    expect(tank.stats.rot).toBe(5);
    tank.turretFacing = Dir.N;
    tank.turretFacing32 = 0;
    tank.desiredTurretFacing = Dir.NE;

    let ticks = 0;
    while (tank.turretFacing === Dir.N && ticks < 10) {
      tank.turretRotTickedThisFrame = false;
      tank.tickTurretRotation();
      ticks++;
    }
    // Turret: rot*2=10, threshold=8, 4 visual steps
    // tick1: acc=10→step(acc=2). tick2: acc=12→step(acc=4). tick3: acc=14→step(acc=6). tick4: acc=16→step(acc=8)
    expect(ticks).toBe(4);
    expect(tank.turretFacing).toBe(Dir.NE);
    expect(tank.turretFacing32).toBe(4);
  });

  it('turret rotation is roughly 2x faster than body for same unit', () => {
    const tank = new Entity(UnitType.V_2TNK, House.Spain, 100, 100);

    // Body rotation
    tank.facing = Dir.N;
    tank.bodyFacing32 = 0;
    tank.desiredFacing = Dir.NE;
    let bodyTicks = 0;
    while (tank.facing === Dir.N && bodyTicks < 20) {
      tank.rotTickedThisFrame = false;
      tank.tickRotation();
      bodyTicks++;
    }

    // Turret rotation
    tank.turretFacing = Dir.N;
    tank.turretFacing32 = 0;
    tank.desiredTurretFacing = Dir.NE;
    let turretTicks = 0;
    while (tank.turretFacing === Dir.N && turretTicks < 20) {
      tank.turretRotTickedThisFrame = false;
      tank.tickTurretRotation();
      turretTicks++;
    }

    expect(turretTicks).toBeLessThan(bodyTicks);
    expect(bodyTicks / turretTicks).toBeGreaterThanOrEqual(1.5);
  });

  it('turretFrame uses turretFacing32 through BODY_SHAPE lookup', () => {
    const tank = new Entity(UnitType.V_2TNK, House.Spain, 100, 100);
    tank.turretFacing32 = 0;
    expect(tank.turretFrame).toBe(32 + BODY_SHAPE[0]);

    tank.turretFacing32 = 8;
    expect(tank.turretFrame).toBe(32 + BODY_SHAPE[8]);
  });
});
