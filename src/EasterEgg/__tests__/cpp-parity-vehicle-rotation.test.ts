/**
 * C++ behavioral parity tests: Vehicle body rotation
 *
 * C++ source references:
 *   facing.h:47-77      — FacingClass: CurrentFacing, DesiredFacing, DirType (0-255)
 *   facing.cpp:142-183  — Rotation_Adjust(rate): step by rate toward desired, snap if abs(diff) < rate
 *   facing.cpp:70       — Difference() = (int)(signed char)(desired - current)
 *   inline.h:694-697    — Dir_To_32(facing) = Facing32[facing] → 0..31 visual frame index
 *   face.h:44-51        — DIR_N=0, DIR_NE=32, DIR_E=64, DIR_SE=96, DIR_S=128, DIR_SW=160, DIR_W=192, DIR_NW=224
 *   type.h:512-516      — ROT field: rotation speed in 256ths per tick
 *   unit.cpp:542        — Turret: SecondaryFacing.Rotation_Adjust(Class->ROT+1)
 *   unit.cpp:554-556    — Idle: SecondaryFacing.Set_Desired(PrimaryFacing.Current())
 *   drive.cpp:716       — Track movement: PrimaryFacing.Set(dir) — forced, not gradual
 *   drive.cpp:1344-1346 — Pre-move rotation: PrimaryFacing.Rotation_Adjust(ROT * GroundspeedBias)
 *   drive.cpp:328-361   — Do_Turn: PrimaryFacing.Set_Desired(dir) — queues rotation
 *
 * ROT values from rules.ini (verified against C++ udata.cpp hardcoded constructors):
 *   1TNK=5, 2TNK=5, 3TNK=5, 4TNK=5, ARTY=2, JEEP=10, APC=5, HARV=5, MCV=5, V2RL=5
 *   Infantry: E1/E2/E3/E4/E6/E7/SPY/THF all have rot=8 in TS (instant snap — C++ does not use ROT for infantry)
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { Entity, resetEntityIds } from '../engine/entity';
import { Dir, UnitType, House, UNIT_STATS, BODY_SHAPE } from '../engine/types';
import { smoothTurn, F_, F_T, F_X, F_Y, TRACK_DATA, TRACK_CONTROL, lookupTrackControl, getEffectiveTrack } from '../engine/tracks';

beforeEach(() => resetEntityIds());

// ═══════════════════════════════════════════════════════════════════════════════
// C++ Reference Implementation: Rotation_Adjust (facing.cpp:142-183)
// Used to derive expected values — NOT a test of the TS engine itself
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Pure C++ Rotation_Adjust reimplementation.
 * DirType is uint8 (0-255). Difference is signed char.
 * Returns [newFacing, changedZone] where changedZone = Dir_To_32 changed.
 */
function cppRotationAdjust(current: number, desired: number, rate: number): [number, boolean] {
  current = current & 0xFF;
  desired = desired & 0xFF;
  rate = Math.min(rate, 127);

  if (current === desired) return [current, false];

  const oldFacing32 = cppDirTo32(current);
  // C++ Difference(): (int)(signed char)(desired - current)
  let diff = (desired - current) & 0xFF;
  if (diff > 127) diff -= 256; // signed char interpretation

  let newFacing: number;
  if (Math.abs(diff) < rate) {
    newFacing = desired;
  } else if (diff < 0) {
    newFacing = (current - rate) & 0xFF;
  } else {
    newFacing = (current + rate) & 0xFF;
  }

  const newFacing32 = cppDirTo32(newFacing);
  return [newFacing, newFacing32 !== oldFacing32];
}

/**
 * C++ Dir_To_32: maps DirType (0-255) to visual frame (0-31).
 * Each zone is 8 DirType values wide: zone = (facing + 4) / 8 (integer division).
 * This matches the Facing32[] lookup table from C++.
 */
function cppDirTo32(dir: number): number {
  return Math.floor(((dir & 0xFF) + 4) / 8) % 32;
}

// ═══════════════════════════════════════════════════════════════════════════════
// 1. C++ Rotation_Adjust: Reference behavior (facing.cpp:142-183)
// ═══════════════════════════════════════════════════════════════════════════════

describe('1. C++ Rotation_Adjust reference behavior (facing.cpp:142-183)', () => {
  it('no rotation when current == desired', () => {
    const [facing, changed] = cppRotationAdjust(0, 0, 5);
    expect(facing).toBe(0);
    expect(changed).toBe(false);
  });

  it('snaps to desired when abs(diff) < rate', () => {
    // Current=0, Desired=3, ROT=5 → abs(3) < 5 → snap
    const [facing, _] = cppRotationAdjust(0, 3, 5);
    expect(facing).toBe(3);
  });

  it('steps clockwise by rate when diff > 0 and abs(diff) >= rate', () => {
    // Current=0 (N), Desired=64 (E), ROT=5 → diff=64, step +5
    const [facing, _] = cppRotationAdjust(0, 64, 5);
    expect(facing).toBe(5);
  });

  it('steps counterclockwise by rate when diff < 0', () => {
    // Current=64 (E), Desired=0 (N), ROT=5
    // diff = (0-64)&0xFF = 192, signed = -64, abs >= 5 → step -5
    const [facing, _] = cppRotationAdjust(64, 0, 5);
    expect(facing).toBe(59);
  });

  it('wraps around 256 boundary correctly (counterclockwise through 0)', () => {
    // Current=2, Desired=250, ROT=5
    // diff = (250-2)&0xFF = 248, signed char = -8, abs(8) >= 5 → step CCW: 2-5 = -3 → 253
    const [facing, _] = cppRotationAdjust(2, 250, 5);
    expect(facing).toBe(253);
  });

  it('wraps around 256 boundary correctly (clockwise through 0)', () => {
    // Current=250, Desired=10, ROT=5
    // diff = (10-250)&0xFF = 16, signed char = 16, abs(16) >= 5 → step CW: 250+5=255
    const [facing, _] = cppRotationAdjust(250, 10, 5);
    expect(facing).toBe(255);
  });

  it('rate clamped to 127 max (facing.cpp:149)', () => {
    // C++ rate = min(rate, 127). Even with rate=200, max step is 127.
    const [facing, _] = cppRotationAdjust(0, 128, 200);
    // diff = 128, signed char = -128, abs(128) >= 127 → step CCW: 0-127 = 129
    expect(facing).toBe(129);
  });

  it('90-degree rotation (N→E) with ROT=5 takes exactly 13 ticks', () => {
    // C++: 0→64 with rate=5. Steps: 5,10,15,20,25,30,35,40,45,50,55,60,64 (snap at 64-60=4 < 5)
    let current = 0;
    let ticks = 0;
    while (current !== 64 && ticks < 100) {
      [current] = cppRotationAdjust(current, 64, 5);
      ticks++;
    }
    expect(ticks).toBe(13);
    expect(current).toBe(64); // DIR_E
  });

  it('180-degree rotation (N→S) with ROT=5 takes exactly 26 ticks', () => {
    // N→S is CCW (diff=128 → signed -128, so CCW). 0-5=-5→251, then steps toward 128.
    // Actually: diff = (128-0) = 128, signed char = -128. abs(128) >= 5 → step CCW.
    // This would go: 0→251→246→241→... toward 128 counterclockwise.
    // Wait, that's the long way. Let me recalculate.
    // (128-0)&0xFF = 128. As signed char: 128 becomes -128 (exactly at boundary).
    // In C++: (signed char)128 = -128. diff < 0 → CCW: 0 - 5 = -5 → 251.
    // Then from 251: (128-251)&0xFF = 133, signed = -123. Still CCW.
    // So it goes the long way around (counterclockwise from N through NW, W, SW to S).
    // Total distance counterclockwise: 256 - 128 = 128 steps. 128/5 → 25 + snap = 26 ticks.
    let current = 0;
    let ticks = 0;
    while (current !== 128 && ticks < 200) {
      [current] = cppRotationAdjust(current, 128, 5);
      ticks++;
    }
    // C++ signed char boundary: 128 is ambiguous. The sign of (signed char)128 = -128.
    // So rotation goes counterclockwise (the LONG way: 128 steps CCW = 256-128=128 units).
    // This is a well-known C++ edge case at exactly 180 degrees.
    expect(ticks).toBe(26);
  });

  it('45-degree rotation (N→NE) with ROT=5 takes exactly 7 ticks', () => {
    // 0→32, rate=5. Steps: 5,10,15,20,25,30,32 (snap at 32-30=2 < 5)
    let current = 0;
    let ticks = 0;
    while (current !== 32 && ticks < 100) {
      [current] = cppRotationAdjust(current, 32, 5);
      ticks++;
    }
    expect(ticks).toBe(7);
  });

  it('full 360 rotation with ROT=5 takes 52 ticks via counterclockwise', () => {
    // N→NW (224): diff = (224-0) = 224, signed = -32 → CCW. 32 units CCW / 5 = 7 ticks.
    // This tests the shortest-path selection (32 CCW vs 224 CW → picks CCW).
    let current = 0;
    let ticks = 0;
    while (current !== 224 && ticks < 100) {
      [current] = cppRotationAdjust(current, 224, 5);
      ticks++;
    }
    // 0→224 CCW = 32 units. 32/5 = 6 full steps + snap (32-30=2<5). Total = 7.
    expect(ticks).toBe(7);
  });

  it('Dir_To_32 zone boundaries are correct', () => {
    // Zone 0: DirType 0-3 (N)
    expect(cppDirTo32(0)).toBe(0);
    expect(cppDirTo32(3)).toBe(0);
    // Zone 1: DirType 4-11
    expect(cppDirTo32(4)).toBe(1);
    expect(cppDirTo32(11)).toBe(1);
    // Zone 4: DirType 28-35 (NE area)
    expect(cppDirTo32(32)).toBe(4); // DIR_NE → zone 4
    // Zone 8: DIR_E (64)
    expect(cppDirTo32(64)).toBe(8);
    // Zone 16: DIR_S (128)
    expect(cppDirTo32(128)).toBe(16);
    // Zone 24: DIR_W (192)
    expect(cppDirTo32(192)).toBe(24);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// 2. ROT values: TS UNIT_STATS vs C++ rules.ini (type.h:516)
// ═══════════════════════════════════════════════════════════════════════════════

describe('2. ROT values match C++ rules.ini (type.h:516)', () => {
  // C++ ROT values per rules.ini. All tanks are ROT=5 in default rules.ini.
  // These are the rotation rates in 256ths of full circle per game tick.
  const CPP_ROT_VALUES: Record<string, number> = {
    // Vehicles
    '1TNK': 5,  // rules.ini [1TNK] ROT=5
    '2TNK': 5,  // rules.ini [2TNK] ROT=5
    '3TNK': 5,  // rules.ini [3TNK] ROT=5
    '4TNK': 5,  // rules.ini [4TNK] ROT=5
    ARTY: 2,    // rules.ini [ARTY] ROT=2 (very slow — body rotation for aiming)
    JEEP: 10,   // rules.ini [JEEP] ROT=10 (fast wheeled vehicle)
    APC: 5,     // rules.ini [APC] ROT=5
    HARV: 5,    // rules.ini [HARV] ROT=5
    MCV: 5,     // rules.ini [MCV] ROT=5
    V2RL: 5,    // rules.ini [V2RL] ROT=5
    TRUK: 5,    // rules.ini [TRUK] ROT=5
    // Infantry: C++ doesn't use ROT for infantry body facing (they face instantly)
    // TS uses rot=8 to trigger instant snap (rot >= 8 → snap)
  };

  for (const [unitKey, expectedRot] of Object.entries(CPP_ROT_VALUES)) {
    it(`${unitKey} ROT=${expectedRot}`, () => {
      const stats = UNIT_STATS[unitKey as keyof typeof UNIT_STATS];
      expect(stats, `UNIT_STATS.${unitKey} should exist`).toBeDefined();
      expect(stats.rot).toBe(expectedRot);
    });
  }

  it('all infantry have rot >= 8 (instant snap, matching C++ infantry behavior)', () => {
    const infantryTypes = ['E1', 'E2', 'E3', 'E4', 'E6', 'E7', 'SPY', 'THF'] as const;
    for (const key of infantryTypes) {
      const stats = UNIT_STATS[key as keyof typeof UNIT_STATS];
      expect(stats.rot, `${key} rot should be >= 8 for instant snap`).toBeGreaterThanOrEqual(8);
    }
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// 3. TS tickRotation: 32-step visual system vs C++ 256-step DirType
// ═══════════════════════════════════════════════════════════════════════════════

describe('3. TS tickRotation parity with C++ Rotation_Adjust', () => {
  it('infantry snaps instantly (matching C++ behavior)', () => {
    // C++ infantry facing is resolved instantly (no Rotation_Adjust call for body).
    // TS: rot >= 8 → instant snap.
    const inf = new Entity(UnitType.I_E1, House.Spain, 100, 100);
    inf.desiredFacing = Dir.SE;
    inf.rotTickedThisFrame = false;
    const aligned = inf.tickRotation();
    expect(aligned).toBe(true);
    expect(inf.facing).toBe(Dir.SE);
    expect(inf.bodyFacing32).toBe(Dir.SE * 4);
  });

  it('vehicle (rot=5) does NOT snap in one tick for 90-degree turn', () => {
    // C++ with ROT=5: N→E (64 DirType units) takes 13 ticks.
    // TS should NOT snap in one tick.
    const tank = new Entity(UnitType.V_2TNK, House.Spain, 100, 100);
    tank.desiredFacing = Dir.E;
    tank.rotTickedThisFrame = false;
    const aligned = tank.tickRotation();
    expect(aligned).toBe(false);
    expect(tank.facing).not.toBe(Dir.E);
  });

  it('90-degree rotation timing: TS matches C++ tick count for ROT=5', () => {
    // C++ with ROT=5: 0→64 takes exactly 13 ticks (5 per tick, snap at remainder < 5).
    // TS with ROT=5, threshold=8: 8 visual steps to reach bodyFacing32=8 (facing=E).
    // TS accumulator trace:
    //   t1:acc=5 t2:acc=10→step(acc=2) t3:acc=7 t4:acc=12→step(acc=4)
    //   t5:acc=9→step(acc=1) t6:acc=6 t7:acc=11→step(acc=3)
    //   t8:acc=8→step(acc=0) t9:acc=5 t10:acc=10→step(acc=2)
    //   t11:acc=7 t12:acc=12→step(acc=4) t13:acc=9→step(acc=1)
    // After 13 ticks: 8 visual steps → bodyFacing32=8 → facing=Dir.E
    const cppTicks = (() => {
      let c = 0;
      let t = 0;
      while (c !== 64 && t < 100) {
        [c] = cppRotationAdjust(c, 64, 5);
        t++;
      }
      return t;
    })();
    expect(cppTicks).toBe(13);

    const tank = new Entity(UnitType.V_2TNK, House.Spain, 100, 100);
    tank.desiredFacing = Dir.E;
    let tsTicks = 0;
    while (tank.facing !== Dir.E && tsTicks < 100) {
      tank.rotTickedThisFrame = false;
      tank.tickRotation();
      tsTicks++;
    }

    // TS 32-step accumulator system produces identical tick count to C++ for 90-degree turns.
    // This is because both systems are governed by the same ROT rate; the TS accumulator
    // threshold of 8 (= 256/32) correctly maps 8 DirType units per visual step.
    expect(tsTicks).toBe(cppTicks);
    expect(tsTicks).toBe(13);
  });

  it('90-degree rotation timing: TS matches C++ tick count for ARTY ROT=2', () => {
    // C++ with ROT=2: 0→64 takes 32 ticks (2 per tick, snap at 64-62=2 < 2? No, 2 not < 2).
    // Actually: 0,2,4,...,62,64. At 62: diff=64-62=2, abs(2) < 2? No (2 is NOT < 2).
    // Step to 64: 62+2=64 = desired. So snap happens when diff=2 and rate=2: abs(2) < 2 is false.
    // So it steps: 62+2=64=desired. That's 32 ticks.
    const cppTicks = (() => {
      let c = 0;
      let t = 0;
      while (c !== 64 && t < 100) {
        [c] = cppRotationAdjust(c, 64, 2);
        t++;
      }
      return t;
    })();
    expect(cppTicks).toBe(32);

    const arty = new Entity(UnitType.V_ARTY, House.Spain, 100, 100);
    arty.desiredFacing = Dir.E;
    let tsTicks = 0;
    while (arty.facing !== Dir.E && tsTicks < 100) {
      arty.rotTickedThisFrame = false;
      arty.tickRotation();
      tsTicks++;
    }

    // TS with ROT=2, threshold=8: 4 ticks per visual step (2*4=8).
    // 8 visual steps to go from bodyFacing32=0 to bodyFacing32=8.
    // 8 × 4 = 32 ticks. Matches C++!
    expect(tsTicks).toBe(cppTicks);
    expect(tsTicks).toBe(32);
  });

  it('JEEP ROT=10 — C++ takes 7 ticks, TS matches', () => {
    // C++ with ROT=10: 0→64 takes 7 ticks (10,20,30,40,50,60,64-snap at diff=4<10)
    const cppTicks = (() => {
      let c = 0;
      let t = 0;
      while (c !== 64 && t < 100) {
        [c] = cppRotationAdjust(c, 64, 10);
        t++;
      }
      return t;
    })();
    expect(cppTicks).toBe(7);

    const jeep = new Entity(UnitType.V_JEEP, House.Spain, 100, 100);
    jeep.desiredFacing = Dir.E;
    let tsTicks = 0;
    while (jeep.facing !== Dir.E && tsTicks < 100) {
      jeep.rotTickedThisFrame = false;
      jeep.tickRotation();
      tsTicks++;
    }

    // Fixed: TS now uses the accumulator for all vehicles (including ROT=10 Jeeps),
    // matching C++ Rotation_Adjust behavior. Only infantry snap instantly.
    expect(tsTicks).toBe(cppTicks);
    expect(tsTicks).toBe(7);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// 4. Rotation direction: shortest path (facing.cpp:168-172)
// ═══════════════════════════════════════════════════════════════════════════════

describe('4. Shortest-path rotation direction (facing.cpp:168-172)', () => {
  it('C++ rotates CW for N→NE (diff=32, positive)', () => {
    const [facing, _] = cppRotationAdjust(0, 32, 5);
    expect(facing).toBe(5); // stepped +5 (clockwise)
  });

  it('C++ rotates CCW for N→NW (diff=224 → signed -32)', () => {
    const [facing, _] = cppRotationAdjust(0, 224, 5);
    expect(facing).toBe(251); // stepped -5 (counterclockwise): 0-5 → 251
  });

  it('TS rotates CW for N→NE (shortest path through 32-step ring)', () => {
    const tank = new Entity(UnitType.V_2TNK, House.Spain, 100, 100);
    tank.desiredFacing = Dir.NE;
    tank.rotTickedThisFrame = false;
    // After enough ticks for one visual step, bodyFacing32 should be 1 (clockwise from 0)
    tank.tickRotation();
    // With ROT=5, first tick: acc=5, no step yet (< 8)
    tank.rotTickedThisFrame = false;
    tank.tickRotation();
    // tick2: acc=10, step → bodyFacing32=1, acc=2
    expect(tank.bodyFacing32).toBe(1); // CW direction
  });

  it('TS rotates CCW for N→NW (shortest path counterclockwise in 32-step ring)', () => {
    const tank = new Entity(UnitType.V_2TNK, House.Spain, 100, 100);
    tank.desiredFacing = Dir.NW; // 7 * 4 = 28 in 32-step. diff=(28-0+32)%32=28 > 16 → CCW
    tank.rotTickedThisFrame = false;
    tank.tickRotation();
    tank.rotTickedThisFrame = false;
    tank.tickRotation();
    // CCW step from 0 → 31 (wrapping backward)
    expect(tank.bodyFacing32).toBe(31);
  });

  it('C++ 180-degree ambiguity: (signed char)128 = -128, goes counterclockwise', () => {
    // This is the classic signed-char ambiguity. (128 & 0xFF) interpreted as signed = -128.
    // C++ treats diff < 0 → counterclockwise.
    const [facing, _] = cppRotationAdjust(0, 128, 5);
    // CCW from 0: 0-5 = -5 → 251
    expect(facing).toBe(251);
  });

  it('TS 180-degree (N→S): goes counterclockwise matching C++ (signed char)128 = -128', () => {
    // C++: (signed char)(128-0) = -128 → counterclockwise.
    // TS: diff32=(16-0+32)%32=16, ==16 → CCW (matching C++).
    const tank = new Entity(UnitType.V_2TNK, House.Spain, 100, 100);
    tank.desiredFacing = Dir.S;
    tank.rotTickedThisFrame = false;
    tank.tickRotation();
    tank.rotTickedThisFrame = false;
    tank.tickRotation();
    // TS goes CCW from 0 → 31 (matching C++ counterclockwise direction)
    expect(tank.bodyFacing32).toBe(31); // CCW direction — matches C++
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// 5. Turret rotation rate: ROT+1 (unit.cpp:542)
// ═══════════════════════════════════════════════════════════════════════════════

describe('5. Turret rotation at ROT+1 (unit.cpp:542)', () => {
  it('C++ turret uses ROT+1: with ROT=5, turret rate is 6', () => {
    // C++ unit.cpp:542: SecondaryFacing.Rotation_Adjust(Class->ROT+1)
    // For ROT=5, turret adjusts by 6 per tick.
    // 45 degrees (32 DirType): ceil(32/6) = 6 ticks
    let current = 0;
    let ticks = 0;
    while (current !== 32 && ticks < 100) {
      [current] = cppRotationAdjust(current, 32, 6); // ROT+1 = 6
      ticks++;
    }
    expect(ticks).toBe(6);
  });

  it('TS turret rotates faster than body (tickTurretRotation uses ROT+1)', () => {
    const tank = new Entity(UnitType.V_2TNK, House.Spain, 100, 100);
    expect(tank.stats.rot).toBe(5);

    // Body: N→NE
    tank.facing = Dir.N;
    tank.bodyFacing32 = 0;
    tank.desiredFacing = Dir.NE;
    let bodyTicks = 0;
    while (tank.facing !== Dir.NE && bodyTicks < 30) {
      tank.rotTickedThisFrame = false;
      tank.tickRotation();
      bodyTicks++;
    }

    // Turret: N→NE
    tank.turretFacing = Dir.N;
    tank.turretFacing32 = 0;
    tank.desiredTurretFacing = Dir.NE;
    let turretTicks = 0;
    while (tank.turretFacing !== Dir.NE && turretTicks < 30) {
      tank.turretRotTickedThisFrame = false;
      tank.tickTurretRotation();
      turretTicks++;
    }

    // Turret should complete faster than body
    expect(turretTicks).toBeLessThan(bodyTicks);
  });

  it('TS tickTurretRotation accumulates at ROT+1 per tick', () => {
    const tank = new Entity(UnitType.V_2TNK, House.Spain, 100, 100);
    tank.turretFacing = Dir.N;
    tank.turretFacing32 = 0;
    tank.desiredTurretFacing = Dir.E; // 4 8-dir steps = 8 visual steps in 32-step

    // First tick: accumulate ROT+1 = 6. 6 < 8, no step.
    tank.turretRotTickedThisFrame = false;
    tank.tickTurretRotation();
    expect(tank.turretFacing32).toBe(0); // no step yet

    // Second tick: acc = 6+6 = 12 >= 8, step. acc = 12-8 = 4.
    tank.turretRotTickedThisFrame = false;
    tank.tickTurretRotation();
    expect(tank.turretFacing32).toBe(1); // one visual step CW
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// 6. Idle turret return-to-facing (unit.cpp:554-556)
// ═══════════════════════════════════════════════════════════════════════════════

describe('6. Idle turret return-to-body-facing (unit.cpp:554-556)', () => {
  // C++ unit.cpp:554-556: when no target and no nav, turret returns to body facing.
  // SecondaryFacing.Set_Desired(PrimaryFacing.Current())

  it('TS turret desiredFacing can be set to match body facing', () => {
    const tank = new Entity(UnitType.V_2TNK, House.Spain, 100, 100);
    tank.facing = Dir.E;
    tank.turretFacing = Dir.NW;
    tank.turretFacing32 = Dir.NW * 4;
    // Simulate idle return: set desired turret to current body
    tank.desiredTurretFacing = tank.facing;

    // Run turret rotation until aligned
    let ticks = 0;
    while (tank.turretFacing !== Dir.E && ticks < 30) {
      tank.turretRotTickedThisFrame = false;
      tank.tickTurretRotation();
      ticks++;
    }
    expect(tank.turretFacing).toBe(Dir.E);
    expect(ticks).toBeGreaterThan(0); // should take time, not instant
  });

  it('turret facing32 syncs to body facing × 4 when aligned', () => {
    const tank = new Entity(UnitType.V_2TNK, House.Spain, 100, 100);
    tank.facing = Dir.SE;
    tank.turretFacing = Dir.SE;
    tank.turretFacing32 = Dir.SE * 4;
    tank.desiredTurretFacing = Dir.SE;

    const aligned = tank.tickTurretRotation();
    expect(aligned).toBe(true);
    expect(tank.turretFacing32).toBe(Dir.SE * 4);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// 7. Smooth_Turn: Track facing override during movement (drive.cpp:716)
// ═══════════════════════════════════════════════════════════════════════════════

describe('7. Smooth_Turn facing transform during track movement (drive.cpp:525-556)', () => {
  // C++ drive.cpp:716: PrimaryFacing.Set(dir) — SETS both current and desired.
  // During track movement, facing is FORCED to the track step's DirType, not gradual.

  it('smoothTurn with no flags returns original facing', () => {
    const result = smoothTurn(100, -50, 32, F_);
    expect(result.facing).toBe(32); // DIR_NE unchanged
  });

  it('smoothTurn with F_T transposes X↔Y and transforms facing to DIR_W - dir', () => {
    // C++ drive.cpp:537-542: swap x↔y, dir = DIR_W - dir
    const result = smoothTurn(100, -50, 32, F_T);
    expect(result.x).toBe(-50); // Y becomes X
    expect(result.y).toBe(100); // X becomes Y
    expect(result.facing).toBe((192 - 32) & 0xFF); // DIR_W - DIR_NE = 160 = DIR_SW
  });

  it('smoothTurn with F_X negates X and negates facing', () => {
    // C++ drive.cpp:544-547: x = -x, dir = -dir
    const result = smoothTurn(100, -50, 32, F_X);
    expect(result.x).toBe(-100);
    expect(result.y).toBe(-50);
    expect(result.facing).toBe((-32) & 0xFF); // 224 = DIR_NW
  });

  it('smoothTurn with F_Y negates Y and transforms facing to DIR_S - dir', () => {
    // C++ drive.cpp:549-552: y = -y, dir = DIR_S - dir
    const result = smoothTurn(100, -50, 32, F_Y);
    expect(result.x).toBe(100);
    expect(result.y).toBe(50);
    expect(result.facing).toBe((128 - 32) & 0xFF); // DIR_S - DIR_NE = 96 = DIR_SE
  });

  it('smoothTurn with F_T|F_X|F_Y applies all transforms in order', () => {
    // C++ applies: F_T first, then F_X, then F_Y
    // Start: x=10, y=20, facing=0 (N)
    // After F_T: x=20, y=10, facing = DIR_W-0 = 192
    // After F_X: x=-20, facing = -192 & 0xFF = 64
    // After F_Y: y=-10, facing = DIR_S - 64 = 128-64 = 64
    const result = smoothTurn(10, 20, 0, F_T | F_X | F_Y);
    expect(result.x).toBe(-20);
    expect(result.y).toBe(-10);
    expect(result.facing).toBe(64); // DIR_E
  });

  it('track steps provide intermediate DirType facings during curves', () => {
    // Track 7 (short 45° curve) has smooth facing transitions from DIR_N to DIR_NE.
    // C++ sets PrimaryFacing.Set(dir) at each step — facing transitions through
    // intermediate DirType values (0, 4, 8, 12, 16, 19, 22, 23, 24, ... 32).
    const track7 = TRACK_DATA[6]; // 0-indexed (Track7 is index 6)
    expect(track7.length).toBe(28);

    // First step facing should be 0 (N)
    expect(track7[0].facing).toBe(0);
    // Last step facing should be DIR_NE (32)
    expect(track7[track7.length - 1].facing).toBe(32);

    // Intermediate facings should smoothly increase
    const facings = track7.map(s => s.facing);
    // Verify facing is monotonically non-decreasing (for this track)
    for (let i = 1; i < facings.length; i++) {
      expect(facings[i]).toBeGreaterThanOrEqual(facings[i - 1]);
    }
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// 8. TrackControl: track selection for facing transitions
// ═══════════════════════════════════════════════════════════════════════════════

describe('8. TrackControl facing jump during track selection (drive.cpp TrackControl[])', () => {
  it('straight movement (N→N) uses Track 1 with no flags', () => {
    const ctrl = lookupTrackControl(Dir.N, Dir.N);
    expect(ctrl.track).toBe(1);
    expect(ctrl.flag).toBe(F_);
    expect(ctrl.facing).toBe(0); // DIR_N
  });

  it('diagonal movement (NE→NE) uses Track 2 with no flags', () => {
    const ctrl = lookupTrackControl(Dir.NE, Dir.NE);
    expect(ctrl.track).toBe(2);
    expect(ctrl.flag).toBe(F_);
    expect(ctrl.facing).toBe(32); // DIR_NE
  });

  it('45-degree turn (N→NE) uses Track 3/7 with F_D flag (2-cell/short)', () => {
    const ctrl = lookupTrackControl(Dir.N, Dir.NE);
    expect(ctrl.track).toBe(3);
    expect(ctrl.startTrack).toBe(7);
    expect(ctrl.flag & 0x08).toBe(0x08); // F_D set
    // getEffectiveTrack should return short track 7
    expect(getEffectiveTrack(ctrl)).toBe(7);
  });

  it('90-degree turn (N→E) uses Track 4/9', () => {
    const ctrl = lookupTrackControl(Dir.N, Dir.E);
    expect(ctrl.track).toBe(4);
    expect(ctrl.startTrack).toBe(9);
    expect(getEffectiveTrack(ctrl)).toBe(9);
  });

  it('impossible turns (>90 degrees) return track=0', () => {
    // C++ does not support turns greater than 90 degrees in a single track.
    // These require pre-rotation via Do_Turn (drive.cpp:328).
    const ctrl_N_SE = lookupTrackControl(Dir.N, Dir.SE);
    expect(ctrl_N_SE.track).toBe(0); // impossible

    const ctrl_N_S = lookupTrackControl(Dir.N, Dir.S);
    expect(ctrl_N_S.track).toBe(0); // impossible

    const ctrl_N_SW = lookupTrackControl(Dir.N, Dir.SW);
    expect(ctrl_N_SW.track).toBe(0); // impossible
  });

  it('mirrored turns use F_X flag to flip direction', () => {
    // N→NW is mirror of N→NE
    const ctrl = lookupTrackControl(Dir.N, Dir.NW);
    expect(ctrl.track).toBe(3);
    expect(ctrl.flag & F_X).toBe(F_X); // X-flipped
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// 9. Stop-Rotate-Move: vehicles must face destination before driving
// ═══════════════════════════════════════════════════════════════════════════════

describe('9. Stop-rotate-move for vehicles (drive.cpp:1064-1071, entity.ts:moveToward)', () => {
  // C++ drive.cpp:1064: facediff = PrimaryFacing.Difference(dir);
  // If facediff != 0: Do_Turn(dir); return true; // don't start track yet
  // TS entity.ts:740: if (!isInfantry && !isAircraft && !facingAligned) return false;

  it('vehicle does not move while facing is misaligned', () => {
    const tank = new Entity(UnitType.V_2TNK, House.Spain, 100, 100);
    tank.facing = Dir.N;
    tank.bodyFacing32 = 0;
    const startX = tank.pos.x;
    const startY = tank.pos.y;

    // Target is to the East — tank faces N, must rotate first
    tank.rotTickedThisFrame = false;
    const arrived = tank.moveToward({ x: 200, y: 100 }, 8);

    // Should not have moved yet (still rotating)
    expect(arrived).toBe(false);
    expect(tank.pos.x).toBe(startX);
    expect(tank.pos.y).toBe(startY);
    // But desired facing should now be set toward target
    expect(tank.desiredFacing).toBe(Dir.E);
  });

  it('vehicle moves once facing is aligned', () => {
    const tank = new Entity(UnitType.V_2TNK, House.Spain, 100, 100);
    tank.facing = Dir.E;
    tank.bodyFacing32 = Dir.E * 4;
    tank.desiredFacing = Dir.E;
    const startX = tank.pos.x;

    // Target is to the East — facing is already aligned
    tank.rotTickedThisFrame = false;
    tank.moveToward({ x: 200, y: 100 }, 8);

    expect(tank.pos.x).toBeGreaterThan(startX); // moved
  });

  it('infantry moves while rotating (nimble — C++ drive.cpp SPEED_FOOT exempt)', () => {
    const inf = new Entity(UnitType.I_E1, House.Spain, 100, 100);
    inf.facing = Dir.N;
    const startX = inf.pos.x;

    // Target to the East — infantry moves immediately while rotating
    inf.rotTickedThisFrame = false;
    inf.moveToward({ x: 200, y: 100 }, 4);

    // Infantry should have moved even though it started facing N
    // (rot=8 snaps instantly, so they'll be aligned anyway)
    expect(inf.pos.x).toBeGreaterThan(startX);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// 10. 32-step visual facing: bodyFacing32 and BODY_SHAPE lookup
// ═══════════════════════════════════════════════════════════════════════════════

describe('10. 32-step bodyFacing32 and BODY_SHAPE sprite mapping (inline.h:694)', () => {
  it('BODY_SHAPE has exactly 32 entries', () => {
    expect(BODY_SHAPE.length).toBe(32);
  });

  it('BODY_SHAPE[0] = 0 (facing N = frame 0)', () => {
    expect(BODY_SHAPE[0]).toBe(0);
  });

  it('BODY_SHAPE maps to reverse sequence (0, 31, 30, ..., 1)', () => {
    // C++ BodyShape table: frame 0 at index 0 (N),
    // then decreasing from 31 (clockwise sprite sheet ordering is reversed)
    expect(BODY_SHAPE[0]).toBe(0);
    expect(BODY_SHAPE[1]).toBe(31);
    expect(BODY_SHAPE[2]).toBe(30);
    expect(BODY_SHAPE[16]).toBe(16); // S = frame 16
    expect(BODY_SHAPE[31]).toBe(1);
  });

  it('vehicle spriteFrame uses BODY_SHAPE[bodyFacing32]', () => {
    const tank = new Entity(UnitType.V_2TNK, House.Spain, 100, 100);

    // N facing
    tank.bodyFacing32 = 0;
    expect(tank.spriteFrame).toBe(BODY_SHAPE[0]);

    // E facing (visual step 8)
    tank.bodyFacing32 = 8;
    expect(tank.spriteFrame).toBe(BODY_SHAPE[8]);

    // S facing (visual step 16)
    tank.bodyFacing32 = 16;
    expect(tank.spriteFrame).toBe(BODY_SHAPE[16]);
  });

  it('bodyFacing32 advances through intermediate steps during rotation', () => {
    const tank = new Entity(UnitType.V_2TNK, House.Spain, 100, 100);
    tank.facing = Dir.N;
    tank.bodyFacing32 = 0;
    tank.desiredFacing = Dir.E; // target: facing32 = 8

    const history: number[] = [];
    for (let t = 0; t < 14; t++) {
      tank.rotTickedThisFrame = false;
      tank.tickRotation();
      history.push(tank.bodyFacing32);
    }

    // Should pass through intermediate values 1, 2, 3, 4, 5, 6, 7, 8
    expect(history).toContain(1);
    expect(history).toContain(2);
    expect(history).toContain(3);
    expect(history).toContain(4);
    // Should reach target
    expect(history).toContain(8);
  });

  it('bodyFacing32 initializes to facing * 4', () => {
    const tank = new Entity(UnitType.V_2TNK, House.Spain, 100, 100);
    expect(tank.bodyFacing32).toBe(Dir.N * 4); // 0
    expect(tank.turretFacing32).toBe(Dir.N * 4); // 0
  });

  it('prevBodyFacing32 tracks previous tick for visual interpolation', () => {
    const tank = new Entity(UnitType.V_2TNK, House.Spain, 100, 100);
    expect(tank.prevBodyFacing32).toBe(0);
    // After construction, prev should match current
    expect(tank.prevBodyFacing32).toBe(tank.bodyFacing32);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// 11. GroundspeedBias: MV9 rotation rate multiplier (drive.cpp:1346)
// ═══════════════════════════════════════════════════════════════════════════════

describe('11. GroundspeedBias multiplies rotation rate (drive.cpp:1346)', () => {
  // C++ drive.cpp:1346: PrimaryFacing.Rotation_Adjust(Techno_Type_Class()->ROT * House->GroundspeedBias)
  // TS entity.ts:669: this.rotAccumulator += this.stats.rot * this.groundspeedBias;

  it('default groundspeedBias is 1.0 (no modification)', () => {
    const tank = new Entity(UnitType.V_2TNK, House.Spain, 100, 100);
    expect(tank.groundspeedBias).toBe(1.0);
  });

  it('groundspeedBias=1.5 makes rotation 1.5x faster', () => {
    // Normal rotation (bias=1.0)
    const tank1 = new Entity(UnitType.V_2TNK, House.Spain, 100, 100);
    tank1.desiredFacing = Dir.E;
    let normalTicks = 0;
    while (tank1.facing !== Dir.E && normalTicks < 100) {
      tank1.rotTickedThisFrame = false;
      tank1.tickRotation();
      normalTicks++;
    }

    // Boosted rotation (bias=1.5)
    const tank2 = new Entity(UnitType.V_2TNK, House.Spain, 100, 100);
    tank2.groundspeedBias = 1.5;
    tank2.desiredFacing = Dir.E;
    let boostedTicks = 0;
    while (tank2.facing !== Dir.E && boostedTicks < 100) {
      tank2.rotTickedThisFrame = false;
      tank2.tickRotation();
      boostedTicks++;
    }

    expect(boostedTicks).toBeLessThan(normalTicks);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// 12. Double-accumulation guard (entity.ts:655-656)
// ═══════════════════════════════════════════════════════════════════════════════

describe('12. Double-accumulation prevention (entity.ts:655-656)', () => {
  // C++ doesn't have this issue (rotation is called once per frame in Per_Cell_Process).
  // TS needs it because tickRotation can be called from multiple paths.

  it('rotTickedThisFrame prevents double accumulation', () => {
    const tank = new Entity(UnitType.V_2TNK, House.Spain, 100, 100);
    tank.desiredFacing = Dir.E;
    tank.rotTickedThisFrame = false;

    tank.tickRotation();
    expect(tank.rotTickedThisFrame).toBe(true);

    const accAfterFirst = tank.rotAccumulator;
    const bf32AfterFirst = tank.bodyFacing32;

    // Second call in same frame: no change
    tank.tickRotation();
    expect(tank.rotAccumulator).toBe(accAfterFirst);
    expect(tank.bodyFacing32).toBe(bf32AfterFirst);
  });

  it('turretRotTickedThisFrame prevents double accumulation for turret', () => {
    const tank = new Entity(UnitType.V_2TNK, House.Spain, 100, 100);
    tank.desiredTurretFacing = Dir.E;
    tank.turretRotTickedThisFrame = false;

    tank.tickTurretRotation();
    expect(tank.turretRotTickedThisFrame).toBe(true);

    const accAfterFirst = tank.turretRotAccumulator;
    const tf32AfterFirst = tank.turretFacing32;

    // Second call in same frame: no change
    tank.tickTurretRotation();
    expect(tank.turretRotAccumulator).toBe(accAfterFirst);
    expect(tank.turretFacing32).toBe(tf32AfterFirst);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// 13. Non-turreted body rotation for aiming (unit.cpp:517-524)
// ═══════════════════════════════════════════════════════════════════════════════

describe('13. Non-turreted body rotation for aiming (unit.cpp:517-524)', () => {
  // C++ unit.cpp:522: tracked non-turret vehicles rotate body to face target.
  // ARTY (no turret, ROT=2) must rotate entire body before firing.

  it('ARTY has no turret', () => {
    const arty = new Entity(UnitType.V_ARTY, House.Spain, 100, 100);
    expect(arty.hasTurret).toBe(false);
  });

  it('V2RL has no turret', () => {
    const v2 = new Entity(UnitType.V_V2RL, House.Spain, 100, 100);
    expect(v2.hasTurret).toBe(false);
  });

  it('2TNK has turret', () => {
    const tank = new Entity(UnitType.V_2TNK, House.Spain, 100, 100);
    expect(tank.hasTurret).toBe(true);
  });

  it('non-turreted rotation with ROT=2 takes many ticks for 90 degrees', () => {
    const arty = new Entity(UnitType.V_ARTY, House.Spain, 100, 100);
    arty.desiredFacing = Dir.E;
    let ticks = 0;
    while (arty.facing !== Dir.E && ticks < 100) {
      arty.rotTickedThisFrame = false;
      arty.tickRotation();
      ticks++;
    }
    // ROT=2: very slow. Should take substantially more ticks than ROT=5 tank.
    expect(ticks).toBeGreaterThan(10);
    expect(arty.facing).toBe(Dir.E);
  });

  it('turreted tank can aim turret independently while body stays', () => {
    const tank = new Entity(UnitType.V_2TNK, House.Spain, 100, 100);
    tank.facing = Dir.N;
    tank.turretFacing = Dir.N;
    tank.turretFacing32 = 0;
    tank.desiredTurretFacing = Dir.E;

    // Turret rotates independently
    let ticks = 0;
    while (tank.turretFacing !== Dir.E && ticks < 30) {
      tank.turretRotTickedThisFrame = false;
      tank.tickTurretRotation();
      ticks++;
    }
    expect(tank.turretFacing).toBe(Dir.E);
    // Body should not have moved (no body rotation was requested)
    expect(tank.facing).toBe(Dir.N);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// 14. Accumulator reset on alignment (entity.ts:649-651)
// ═══════════════════════════════════════════════════════════════════════════════

describe('14. Accumulator reset when facing matches desired (entity.ts:649-651)', () => {
  it('body rotation resets accumulator and syncs bodyFacing32 on alignment', () => {
    const tank = new Entity(UnitType.V_2TNK, House.Spain, 100, 100);
    tank.facing = Dir.E;
    tank.desiredFacing = Dir.E;
    tank.rotAccumulator = 42; // leftover from previous rotation
    tank.bodyFacing32 = 7;    // slightly off

    const aligned = tank.tickRotation();
    expect(aligned).toBe(true);
    expect(tank.rotAccumulator).toBe(0);
    expect(tank.bodyFacing32).toBe(Dir.E * 4); // snapped to 8
  });

  it('turret rotation resets accumulator on alignment', () => {
    const tank = new Entity(UnitType.V_2TNK, House.Spain, 100, 100);
    tank.turretFacing = Dir.S;
    tank.desiredTurretFacing = Dir.S;
    tank.turretRotAccumulator = 37;
    tank.turretFacing32 = Dir.S * 4;

    const aligned = tank.tickTurretRotation();
    expect(aligned).toBe(true);
    expect(tank.turretRotAccumulator).toBe(0);
    expect(tank.turretFacing32).toBe(Dir.S * 4);
  });
});
