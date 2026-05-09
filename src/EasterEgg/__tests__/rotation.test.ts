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

  it('Mammoth Tank (rot=5) takes 4 ticks to advance one 8-dir facing step', () => {
    // C++ FacingClass::Rotation_Adjust applies the full ROT in 256-dir space.
    // Dir_Facing rounds to the next 8-way facing once current reaches 16.
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
    expect(ticksForFirst).toBe(4);
    expect(mammoth.facing).toBe(Dir.NE);
    expect(mammoth.bodyFacing32).toBe(3);
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

  it('N→S rotation takes ~21 ticks for rot=5 (CCW path, 13 visual steps to facing match)', () => {
    // C++ parity: N→S (diff32=16) goes counterclockwise (signed char -128 → CCW).
    // CCW path: bf32 goes 0→31→30→...→19. At bf32=19, facing=floor(19/4)=4=Dir.S.
    // That's 13 visual steps. With ROT=5, step 13 occurs at tick 21.
    const tank = new Entity(UnitType.V_4TNK, House.Spain, 100, 100);
    tank.facing = Dir.N;
    tank.bodyFacing32 = 0;
    tank.desiredFacing = Dir.S;
    let ticks = 0;
    while (tank.facing !== Dir.S && ticks < 100) {
      tank.rotTickedThisFrame = false;
      tank.tickRotation();
      ticks++;
    }
    // 13 visual steps at ROT=5 = 21 ticks
    expect(ticks).toBeGreaterThanOrEqual(19);
    expect(ticks).toBeLessThanOrEqual(23);
  });

  it('Artillery (rot=2) rotates very slowly — 8 ticks per 8-dir facing step', () => {
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
    // rot=2 in 256-dir space: current=16 at tick 8, rounded to NE.
    expect(ticks).toBe(8);
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
  it('turret rotates at ROT+1 speed for rot=5 tank', () => {
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
    // Turret: rot+1=6 in 256-dir space, current=18 at tick 3, rounded to NE.
    expect(ticks).toBe(3);
    expect(tank.turretFacing).toBe(Dir.NE);
    expect(tank.turretFacing32).toBe(2);
  });

  it('turret rotation is faster than body for same unit (ROT+1 vs ROT)', () => {
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

    // C++ unit.cpp:542: turret uses ROT+1 (=6) vs body ROT (=5)
    // Body: 7 ticks, Turret: 6 ticks. Turret is faster but not 2x.
    expect(turretTicks).toBeLessThan(bodyTicks);
    expect(bodyTicks / turretTicks).toBeGreaterThanOrEqual(1.1);
  });

  it('turretFrame uses turretFacing32 through BODY_SHAPE lookup', () => {
    const tank = new Entity(UnitType.V_2TNK, House.Spain, 100, 100);
    tank.turretFacing32 = 0;
    expect(tank.turretFrame).toBe(32 + BODY_SHAPE[0]);

    tank.turretFacing32 = 8;
    expect(tank.turretFrame).toBe(32 + BODY_SHAPE[8]);
  });
});
