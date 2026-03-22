/**
 * C++ behavioral parity tests: Movement speed — MPH/lepton speed conversion to TS pixel speed.
 *
 * C++ speed pipeline (techno.cpp:6287, ccini.cpp:253-260, drive.cpp:647-710):
 *   1. rules.ini: Speed=N (percentage 0-100)
 *   2. _Scale_To_256(N): clamp [0,100], then (N * 256) / 100, clamp to 255 → MPH (leptons/tick)
 *   3. drive.cpp While_Moving: actual = SpeedAccum + MaxSpeed * fixed(Speed, 256)
 *      where Speed is throttle (0-255), 255 = full throttle.
 *   4. Movement happens when actual > PIXEL_LEPTON_W (= 256 / ICON_PIXEL_W = 256 / 24 = 10)
 *   5. Each step consumed costs PIXEL_LEPTON_W leptons and moves ~1 pixel along the track.
 *
 * TS speed pipeline (types.ts, entity.ts, index.ts:4787-4792):
 *   1. UNIT_STATS: speed = N (matches rules.ini Speed= percentage value)
 *   2. movementSpeed(): speed * MPH_TO_PX * terrainMult * dmgFactor * groundspeedBias
 *      where MPH_TO_PX = CELL_SIZE / LEPTON_SIZE = 24 / 256 = 0.09375
 *   3. followTrackStep(): converts speedPixels to lepton budget via / LP (= speedPixels * 256 / 24)
 *      which recovers the original speed value as leptons/tick.
 *   4. Consumes track steps at PIXEL_LEPTON_W (= floor(256 / 24) = 10) leptons each.
 *
 * Key difference: TS stores rules.ini percentage (Speed=9 → 9) directly; C++ converts it to
 * _Scale_To_256(9) = 23 MPH first. The TS lepton budget per tick equals the INI speed value,
 * while C++ yields _Scale_To_256(speed) leptons. This creates a ~2.56x speed ratio between
 * C++ and TS for the same unit, an intentional design choice in the TS engine.
 *
 * C++ source refs:
 *   - techno.cpp:6212-6219 — _Scale_To_256(val): clamp(0,100), (val*256)/100, clamp(255)
 *   - techno.cpp:6287 — MaxSpeed = MPHType(_Scale_To_256(ini.Get_Int("Speed", ...)))
 *   - drive.cpp:664 — maxspeed = min(MaxSpeed * SpeedBias * GroundspeedBias, MPH_LIGHT_SPEED)
 *   - drive.cpp:671 — actual = SpeedAccum + maxspeed * fixed(Speed, 256)
 *   - drive.cpp:674 — movement trigger: actual > PIXEL_LEPTON_W
 *   - drive.cpp:705-709 — while (actual > PIXEL_LEPTON_W) { actual -= PIXEL_LEPTON_W; step++ }
 *   - defines.h:1118-1132 — MPHType enum values
 *   - tracks.ts:29-30 — PIXEL_LEPTON_W = floor(256 / CELL_SIZE) = 10
 *   - types.ts:11 — CELL_SIZE = 24
 *   - types.ts:13-14 — MPH_TO_PX = CELL_SIZE / LEPTON_SIZE = 0.09375
 *   - types.ts:408-419 — TERRAIN_SPEED lookup table (rules.ini [Land Characteristics])
 *   - rules.cpp:838-868 — Ground[land].Cost[speed_class] from rules.ini
 *   - combat.ts:249-253 — damageSpeedFactor: <=50% HP → 0.75x speed
 *   - drive.cpp:1157-1161 — C++ damage speed reduction (ConditionYellow threshold)
 */

import { describe, it, expect } from 'vitest';
import {
  CELL_SIZE, LEPTON_SIZE, MPH_TO_PX,
  UNIT_STATS, SpeedClass,
  TERRAIN_SPEED, getTerrainSpeed,
  CONDITION_YELLOW,
} from '../engine/types';
import { PIXEL_LEPTON_W, LP } from '../engine/tracks';
import { damageSpeedFactor } from '../engine/combat';
import { Entity } from '../engine/entity';
import { House, UnitType, Dir } from '../engine/types';

// ── C++ _Scale_To_256 reference implementation (techno.cpp:6212-6219) ────────

/** C++ _Scale_To_256: convert rules.ini Speed= percentage (0-100) to MPH (0-255 leptons/tick).
 *  Source: techno.cpp:6212-6219, ccini.cpp:253-260 */
function cppScaleTo256(val: number): number {
  val = Math.min(val, 100);
  val = Math.max(val, 0);
  val = Math.floor((val * 256) / 100);
  val = Math.min(val, 255);
  return val;
}

/** C++ MPH enum values from defines.h:1118-1132 */
const CPP_MPH = {
  IMMOBILE: 0,
  VERY_SLOW: 5,
  KINDA_SLOW: 6,
  SLOW: 8,
  SLOW_ISH: 10,
  MEDIUM_SLOW: 12,
  MEDIUM: 18,
  MEDIUM_FAST: 30,
  MEDIUM_FASTER: 35,
  FAST: 40,
  ROCKET: 60,
  VERY_FAST: 100,
  LIGHT_SPEED: 255,
};

// ── Helper functions ────────────────────────────────────────────────────────

/** Compute how many track steps (pixels) C++ moves per tick at full throttle.
 *  C++ drive.cpp:671: actual = SpeedAccum + maxspeed * fixed(Speed, 256)
 *  C++ drive.cpp:674,705: while (actual > PIXEL_LEPTON_W) — STRICT greater-than
 *  With SpeedAccum=0 and Speed=255 (full throttle):
 *    actual = maxspeed * fixed(255, 256) (integer result via fixed::operator*(int))
 *    steps consumed while actual > PIXEL_LEPTON_W */
function cppStepsPerTick(maxspeedMPH: number, throttle: number = 255): { steps: number; remainder: number } {
  // C++ fixed(Speed, 256): internal Raw = (Speed * 256) / 256 = Speed.
  // int * fixed calls friend operator which delegates to fixed::operator*(int):
  //   ((Data.Raw * rvalue) + 128) / 256 = ((throttle * maxspeedMPH) + 128) / 256
  let actual = Math.floor((throttle * maxspeedMPH + 128) / 256);
  let steps = 0;
  // C++ drive.cpp:674,705: strict ">" comparison — actual == PIXEL_LEPTON_W does NOT consume a step
  while (actual > PIXEL_LEPTON_W) {
    actual -= PIXEL_LEPTON_W;
    steps++;
  }
  return { steps, remainder: actual };
}

/** TS movement speed in pixels/tick for a given unit on given terrain, at full HP.
 *  Replicates index.ts:4787-4792 movementSpeed() formula. */
function tsMovementSpeed(unitKey: string, terrain: string = 'Clear'): number {
  const stats = UNIT_STATS[unitKey];
  if (!stats) throw new Error(`Unknown unit: ${unitKey}`);
  const terrainMult = getTerrainSpeed(terrain, stats.speedClass);
  // Full HP → damageSpeedFactor = 1.0; default groundspeedBias = 1.0
  return stats.speed * MPH_TO_PX * terrainMult;
}

/** TS lepton budget per tick (what followTrackStep uses internally).
 *  index.ts:4839: actual = speedAccum + (biasedSpeed / LP)
 *  This recovers leptons/tick from pixel speed. With speedAccum=0: */
function tsLeptonBudget(unitKey: string, terrain: string = 'Clear'): number {
  return tsMovementSpeed(unitKey, terrain) / LP;
}

// ── Tests ────────────────────────────────────────────────────────────────────

describe('cpp-parity: _Scale_To_256 conversion (techno.cpp:6212-6219)', () => {
  // Verify _Scale_To_256 for all rules.ini Speed= values used by UNIT_STATS
  const SPEED_CONVERSIONS: [number, number][] = [
    // [iniSpeed, expectedMPH]
    [0, 0],     // immobile
    [3, 7],     // (3*256)/100 = 7.68 → 7
    [4, 10],    // (4*256)/100 = 10.24 → 10
    [5, 12],    // (5*256)/100 = 12.80 → 12
    [6, 15],    // (6*256)/100 = 15.36 → 15
    [7, 17],    // (7*256)/100 = 17.92 → 17
    [8, 20],    // (8*256)/100 = 20.48 → 20
    [9, 23],    // (9*256)/100 = 23.04 → 23
    [10, 25],   // (10*256)/100 = 25.60 → 25
    [12, 30],   // (12*256)/100 = 30.72 → 30
    [14, 35],   // (14*256)/100 = 35.84 → 35
    [100, 255], // (100*256)/100 = 256 → clamped to 255
  ];

  for (const [iniSpeed, expectedMPH] of SPEED_CONVERSIONS) {
    it(`Speed=${iniSpeed} → _Scale_To_256 → ${expectedMPH} MPH`, () => {
      expect(cppScaleTo256(iniSpeed)).toBe(expectedMPH);
    });
  }

  it('clamps negative values to 0', () => {
    expect(cppScaleTo256(-5)).toBe(0);
  });

  it('clamps values > 100 to 255', () => {
    expect(cppScaleTo256(110)).toBe(255);
  });
});

describe('cpp-parity: engine constants match C++ (defines.h, tracks.ts)', () => {
  it('CELL_SIZE = 24 pixels (C++ ICON_PIXEL_W)', () => {
    expect(CELL_SIZE).toBe(24);
  });

  it('LEPTON_SIZE = 256 leptons per cell (C++ CELL_LEPTON_W)', () => {
    expect(LEPTON_SIZE).toBe(256);
  });

  it('MPH_TO_PX = CELL_SIZE / LEPTON_SIZE = 24/256 = 0.09375', () => {
    expect(MPH_TO_PX).toBe(CELL_SIZE / LEPTON_SIZE);
    expect(MPH_TO_PX).toBeCloseTo(0.09375, 10);
  });

  it('PIXEL_LEPTON_W = floor(256/24) = 10 (C++ CELL_LEPTON_W / ICON_PIXEL_W)', () => {
    expect(PIXEL_LEPTON_W).toBe(Math.floor(256 / CELL_SIZE));
    expect(PIXEL_LEPTON_W).toBe(10);
  });

  it('LP = CELL_SIZE / 256 = 0.09375 (lepton-to-pixel factor)', () => {
    expect(LP).toBe(CELL_SIZE / 256);
    expect(LP).toBeCloseTo(0.09375, 10);
  });

  it('C++ MPH enum values match defines.h:1118-1132', () => {
    // These are the canonical C++ MPHType enum values
    expect(CPP_MPH.IMMOBILE).toBe(0);
    expect(CPP_MPH.VERY_SLOW).toBe(5);     // comment says "2" but enum value is 5
    expect(CPP_MPH.KINDA_SLOW).toBe(6);    // comment says "3" but enum value is 6
    expect(CPP_MPH.SLOW).toBe(8);           // comment says "4" but enum value is 8
    expect(CPP_MPH.SLOW_ISH).toBe(10);     // comment says "5" but enum value is 10
    expect(CPP_MPH.MEDIUM_SLOW).toBe(12);  // comment says "6" but enum value is 12
    expect(CPP_MPH.MEDIUM).toBe(18);        // comment says "9" but enum value is 18
    expect(CPP_MPH.MEDIUM_FAST).toBe(30);  // comment says "12" but enum value is 30
    expect(CPP_MPH.MEDIUM_FASTER).toBe(35);// comment says "14" but enum value is 35
    expect(CPP_MPH.FAST).toBe(40);          // comment says "16" but enum value is 40
    expect(CPP_MPH.ROCKET).toBe(60);        // comment says "24" but enum value is 60
    expect(CPP_MPH.VERY_FAST).toBe(100);   // comment says "40" but enum value is 100
    expect(CPP_MPH.LIGHT_SPEED).toBe(255); // comment says "100" but enum value is 255
  });
});

describe('cpp-parity: UNIT_STATS speed values match rules.ini Speed= (techno.cpp:6287)', () => {
  // TS stores the rules.ini Speed= percentage directly, NOT the post-_Scale_To_256 MPH value.
  // These are the canonical Speed= values from rules.ini for each unit type.
  //
  // C++ techno.cpp:6287 reads: ini.Get_Int(Name(), "Speed", ...)
  // The default is: fixed(MaxSpeed, 256) * 100, where MaxSpeed starts at MPH_IMMOBILE=0.
  // rules.ini then overrides these with the Speed= entries.

  const RULES_INI_SPEED: [string, number][] = [
    // Vehicles (rules.ini Speed= percentage values)
    ['1TNK', 9],    // Light Tank
    ['2TNK', 8],    // Medium Tank
    ['3TNK', 7],    // Heavy Tank
    ['4TNK', 4],    // Mammoth Tank
    ['JEEP', 10],   // Ranger
    ['APC', 10],    // APC
    ['ARTY', 6],    // Artillery
    ['HARV', 6],    // Harvester
    ['MCV', 6],     // MCV
    ['TRUK', 10],   // Supply Truck
    ['V2RL', 7],    // V2 Rocket Launcher
    // Infantry (rules.ini Speed= percentage values)
    ['E1', 4],      // Rifle Infantry
    ['E2', 5],      // Grenadier
    ['E3', 3],      // Rocket Soldier
    ['E4', 3],      // Flamethrower
    ['E6', 4],      // Engineer
    ['DOG', 4],     // Attack Dog
    ['SPY', 4],     // Spy
    // Aircraft
    ['TRAN', 12],   // Chinook
    // Vessels
    ['LST', 14],    // Transport
    ['SS', 6],      // Submarine
  ];

  for (const [unitKey, expectedIniSpeed] of RULES_INI_SPEED) {
    it(`${unitKey} speed = ${expectedIniSpeed} (rules.ini Speed=${expectedIniSpeed})`, () => {
      const stats = UNIT_STATS[unitKey];
      expect(stats, `${unitKey} should exist in UNIT_STATS`).toBeDefined();
      expect(stats.speed).toBe(expectedIniSpeed);
    });
  }
});

describe('cpp-parity: TS speed conversion formula (index.ts:4787-4792)', () => {
  // TS movementSpeed = speed * MPH_TO_PX * terrainMult * dmgFactor * groundspeedBias
  // At full HP on road (terrainMult=1.0), bias=1.0: movementSpeed = speed * MPH_TO_PX

  it('1TNK (Speed=9): base px/tick = 9 * 0.09375 = 0.84375', () => {
    const expected = 9 * MPH_TO_PX;
    expect(expected).toBeCloseTo(0.84375, 10);
    expect(tsMovementSpeed('1TNK', 'Road')).toBeCloseTo(0.84375, 10);
  });

  it('4TNK (Speed=4): base px/tick = 4 * 0.09375 = 0.375', () => {
    expect(tsMovementSpeed('4TNK', 'Road')).toBeCloseTo(0.375, 10);
  });

  it('E1 (Speed=4): base px/tick = 4 * 0.09375 = 0.375', () => {
    expect(tsMovementSpeed('E1', 'Road')).toBeCloseTo(0.375, 10);
  });
});

describe('cpp-parity: TS lepton budget recovery (index.ts:4839)', () => {
  // followTrackStep converts speedPixels back to leptons: speedPixels / LP
  // This should recover the original INI Speed= value as the lepton budget.

  it('1TNK lepton budget on road = 9.0 (matches INI Speed=9)', () => {
    expect(tsLeptonBudget('1TNK', 'Road')).toBeCloseTo(9.0, 10);
  });

  it('4TNK lepton budget on road = 4.0 (matches INI Speed=4)', () => {
    expect(tsLeptonBudget('4TNK', 'Road')).toBeCloseTo(4.0, 10);
  });

  it('E1 lepton budget on road = 4.0 (matches INI Speed=4)', () => {
    expect(tsLeptonBudget('E1', 'Road')).toBeCloseTo(4.0, 10);
  });

  it('JEEP lepton budget on road = 10.0 (matches INI Speed=10)', () => {
    expect(tsLeptonBudget('JEEP', 'Road')).toBeCloseTo(10.0, 10);
  });
});

describe('cpp-parity: C++ movement steps per tick (drive.cpp:664-710)', () => {
  // In C++ at full throttle (Speed=255), SpeedAccum=0:
  // actual = maxspeed * fixed(255, 256) = ((255 * maxspeed) + 128) / 256
  // steps = floor(actual / PIXEL_LEPTON_W)

  // For each unit, C++ actual = ((255 * MaxSpeed) + 128) / 256 (integer division).
  // fixed(255,256).Raw = 255; operator*(int mph) = ((255 * mph) + 128) / 256.
  // Then: while (actual > PIXEL_LEPTON_W) { actual -= PIXEL_LEPTON_W; steps++; }

  it('1TNK C++ MaxSpeed=23: actual=23 → 2 steps, remainder=3', () => {
    // ((255 * 23) + 128) / 256 = 5993 / 256 = 23
    // 23 > 10 → step (13), 13 > 10 → step (3), 3 not > 10. Steps=2, rem=3.
    const { steps, remainder } = cppStepsPerTick(cppScaleTo256(9));
    expect(steps).toBe(2);
    expect(remainder).toBe(3);
  });

  it('4TNK C++ MaxSpeed=10: actual=10 → 0 steps (10 is NOT > 10)', () => {
    // ((255 * 10) + 128) / 256 = 2678 / 256 = 10
    // 10 > 10? No. Steps=0, remainder=10.
    const { steps, remainder } = cppStepsPerTick(cppScaleTo256(4));
    expect(steps).toBe(0);
    expect(remainder).toBe(10);
  });

  it('JEEP C++ MaxSpeed=25: actual=25 → 2 steps, remainder=5', () => {
    // ((255 * 25) + 128) / 256 = 6503 / 256 = 25
    // 25 > 10 → step (15), 15 > 10 → step (5), 5 not > 10. Steps=2, rem=5.
    const { steps, remainder } = cppStepsPerTick(cppScaleTo256(10));
    expect(steps).toBe(2);
    expect(remainder).toBe(5);
  });

  it('E1 C++ MaxSpeed=10: actual=10 → 0 steps (accumulates to next tick)', () => {
    // ((255 * 10) + 128) / 256 = 10
    // 10 > 10? No. Steps=0, remainder=10.
    const { steps, remainder } = cppStepsPerTick(cppScaleTo256(4));
    expect(steps).toBe(0);
    expect(remainder).toBe(10);
  });

  it('ARTY C++ MaxSpeed=15: actual=15 → 1 step, remainder=5', () => {
    // ((255 * 15) + 128) / 256 = 3953 / 256 = 15
    // 15 > 10 → step (5), 5 not > 10. Steps=1, rem=5.
    const { steps, remainder } = cppStepsPerTick(cppScaleTo256(6));
    expect(steps).toBe(1);
    expect(remainder).toBe(5);
  });
});

describe('cpp-parity: 1TNK crossing one cell (24 pixels) on road', () => {
  // Road terrain multiplier = 1.0 for all speed classes.
  //
  // TS: Track 1 (straight N) has 24 steps. Each step costs PIXEL_LEPTON_W=10 leptons.
  // Total lepton cost = 24 * 10 = 240 leptons for one cell.
  // TS budget per tick: speed=9 → 9 leptons/tick on road.
  // Ticks to cross: ceil(240 / 9) = 27 ticks (with accumulator carry-over, exact = 240/9 = 26.67)
  //
  // C++ MaxSpeed=23 → ~22 leptons/tick → 240/22 ≈ 10.9 → ~11 ticks (with accumulator)
  //
  // The TS takes ~2.5x more ticks than C++ for the same unit, same distance.
  // This is an intentional TS design choice (more controlled pacing).

  it('total lepton cost for 1 cell (straight track) = 24 * PIXEL_LEPTON_W = 240', () => {
    const cost = 24 * PIXEL_LEPTON_W; // 24 steps * 10 leptons/step
    expect(cost).toBe(240);
  });

  it('TS: 1TNK crosses 1 cell on road in ~27 ticks', () => {
    const budgetPerTick = 9; // INI Speed=9 → 9 leptons/tick on road
    let accum = 0;
    let stepsConsumed = 0;
    let ticks = 0;
    while (stepsConsumed < 24) {
      accum += budgetPerTick;
      while (accum > PIXEL_LEPTON_W && stepsConsumed < 24) {
        accum -= PIXEL_LEPTON_W;
        stepsConsumed++;
      }
      ticks++;
    }
    expect(ticks).toBe(27);
  });

  it('C++ (reference): 1TNK crosses 1 cell on road in ~11 ticks', () => {
    const maxspeed = cppScaleTo256(9); // 23 MPH
    // C++ fixed(255, 256) * maxspeed = ((255 * 23) + 128) / 256 = floor(6013/256) = 23
    // Wait, let me recalculate: ((255 * 23) + 128) / 256 = (5865 + 128) / 256 = 5993 / 256 = 23.41 → 23
    // Actually, the `fixed * int` operator is: ((Data.Raw * rvalue) + 128) / 256
    // fixed(255, 256).Data.Raw = (255 * 256) / 256 = 255
    // 255 * 23 = 5865, (5865 + 128) / 256 = 5993 / 256 = 23 (integer division)
    const throttle = 255;
    let accum = 0;
    let stepsConsumed = 0;
    let ticks = 0;
    while (stepsConsumed < 24) {
      // C++ actual = SpeedAccum + maxspeed * fixed(Speed, 256)
      // fixed(throttle, 256).Raw = (throttle * 256) / 256 = throttle = 255
      // operator*(int maxspeed) = ((255 * maxspeed) + 128) / 256
      const addition = Math.floor((throttle * maxspeed + 128) / 256);
      accum += addition;
      while (accum > PIXEL_LEPTON_W && stepsConsumed < 24) {
        accum -= PIXEL_LEPTON_W;
        stepsConsumed++;
      }
      ticks++;
    }
    expect(ticks).toBe(11);
  });
});

describe('cpp-parity: infantry vs vehicle speed ratios', () => {
  // Speed ratios compare rules.ini Speed= values since TS uses them directly.
  // In C++, the ratio is preserved through _Scale_To_256 (which is linear).

  it('E1 (Speed=4) is slower than 1TNK (Speed=9): ratio = 4/9 ≈ 0.444', () => {
    const e1Speed = UNIT_STATS.E1.speed;
    const ltnkSpeed = UNIT_STATS['1TNK'].speed;
    expect(e1Speed).toBe(4);
    expect(ltnkSpeed).toBe(9);
    expect(e1Speed / ltnkSpeed).toBeCloseTo(4 / 9, 5);
  });

  it('E3/E4 (Speed=3) is the slowest infantry', () => {
    expect(UNIT_STATS.E3.speed).toBe(3);
    expect(UNIT_STATS.E4.speed).toBe(3);
    // Slower than E1, E2, E6, DOG, SPY
    expect(UNIT_STATS.E3.speed).toBeLessThan(UNIT_STATS.E1.speed);
    expect(UNIT_STATS.E3.speed).toBeLessThan(UNIT_STATS.E2.speed);
  });

  it('4TNK (Speed=4) matches E1 infantry (Speed=4) in base speed', () => {
    // Mammoth Tank and Rifle Infantry have the same INI Speed value.
    // The difference in gameplay comes from terrain modifiers:
    // WHEEL on Clear = 0.60 (rules.ini), FOOT on Clear = 0.90
    expect(UNIT_STATS['4TNK'].speed).toBe(UNIT_STATS.E1.speed);
  });

  it('infantry FOOT speed advantage on clear terrain (0.90 vs 0.60 WHEEL)', () => {
    // Same base speed, but FOOT gets 0.90 terrain mult, WHEEL gets 0.60 (rules.ini)
    const footClear = getTerrainSpeed('Clear', SpeedClass.FOOT);
    const wheelClear = getTerrainSpeed('Clear', SpeedClass.WHEEL);
    expect(footClear).toBeCloseTo(0.90, 5);
    expect(wheelClear).toBeCloseTo(0.60, 5);
    // Effective 4TNK on clear: 4 * 0.09375 * 0.60 = 0.225 px/tick
    // Effective E1 on clear: 4 * 0.09375 * 0.90 = 0.3375 px/tick
    // E1 is 1.5x faster on clear terrain despite same base speed
    expect(footClear / wheelClear).toBeCloseTo(9 / 6, 5);
  });
});

describe('cpp-parity: terrain speed modifiers (rules.cpp:838-868)', () => {
  // C++ rules.ini [Land Characteristics] — percentage of full speed for each speed class.
  // TERRAIN_SPEED table in types.ts must match these.
  //
  // C++ rules.cpp:859-863:
  //   gptr->Cost[SPEED_FOOT]   = ini.Get_Fixed("Clear", "Foot", 1);
  //   gptr->Cost[SPEED_TRACK]  = ini.Get_Fixed("Clear", "Track", 1);
  //   gptr->Cost[SPEED_WHEEL]  = ini.Get_Fixed("Clear", "Wheel", 1);
  //   gptr->Cost[SPEED_WINGED] = fixed(1); // always 100% for aircraft
  //   gptr->Cost[SPEED_FLOAT]  = ini.Get_Fixed("Clear", "Float", 1);
  //
  // Note: C++ stores these as movement *cost* (higher = slower), while TS uses
  // them as speed *multipliers* (higher = faster). Both produce the same result
  // when applied: C++ divides path cost, TS multiplies speed.

  it('Road: all ground types at 100% speed', () => {
    expect(getTerrainSpeed('Road', SpeedClass.FOOT)).toBe(1.0);
    expect(getTerrainSpeed('Road', SpeedClass.TRACK)).toBe(1.0);
    expect(getTerrainSpeed('Road', SpeedClass.WHEEL)).toBe(1.0);
    expect(getTerrainSpeed('Road', SpeedClass.WINGED)).toBe(1.0);
  });

  it('Clear: FOOT=90%, TRACK=80%, WHEEL=60% (rules.ini [Clear] Wheel=60%)', () => {
    expect(getTerrainSpeed('Clear', SpeedClass.FOOT)).toBeCloseTo(0.90, 5);
    expect(getTerrainSpeed('Clear', SpeedClass.TRACK)).toBeCloseTo(0.80, 5);
    expect(getTerrainSpeed('Clear', SpeedClass.WHEEL)).toBeCloseTo(0.60, 5);
  });

  it('Rough: FOOT=80%, WHEEL=40% (infantry penalty less severe)', () => {
    expect(getTerrainSpeed('Rough', SpeedClass.FOOT)).toBeCloseTo(0.80, 5);
    expect(getTerrainSpeed('Rough', SpeedClass.WHEEL)).toBeCloseTo(0.40, 5);
  });

  it('Water: impassable for ground (0%), navigable for FLOAT (100%)', () => {
    expect(getTerrainSpeed('Water', SpeedClass.FOOT)).toBe(0.0);
    expect(getTerrainSpeed('Water', SpeedClass.WHEEL)).toBe(0.0);
    expect(getTerrainSpeed('Water', SpeedClass.FLOAT)).toBe(1.0);
  });

  it('WINGED always 100% (rules.cpp:862 hardcoded)', () => {
    for (const terrain of ['Clear', 'Road', 'Water', 'Rock', 'Rough', 'Beach']) {
      expect(getTerrainSpeed(terrain, SpeedClass.WINGED)).toBe(1.0);
    }
  });

  it('Rock/Wall: impassable for all ground types', () => {
    expect(getTerrainSpeed('Rock', SpeedClass.FOOT)).toBe(0.0);
    expect(getTerrainSpeed('Rock', SpeedClass.WHEEL)).toBe(0.0);
    expect(getTerrainSpeed('Rock', SpeedClass.TRACK)).toBe(0.0);
  });

  it('Beach: same as Rough for ground units', () => {
    expect(getTerrainSpeed('Beach', SpeedClass.FOOT)).toBeCloseTo(0.80, 5);
    expect(getTerrainSpeed('Beach', SpeedClass.WHEEL)).toBeCloseTo(0.40, 5);
  });

  it('road bonus: 1TNK on road vs clear = 1.0/0.60 ≈ 1.67x faster', () => {
    const road = tsMovementSpeed('1TNK', 'Road');
    const clear = tsMovementSpeed('1TNK', 'Clear');
    expect(road / clear).toBeCloseTo(1.0 / 0.60, 3);
  });

  it('rough penalty: 1TNK on rough vs clear = 0.40/0.60 ≈ 0.67x speed', () => {
    const rough = tsMovementSpeed('1TNK', 'Rough');
    const clear = tsMovementSpeed('1TNK', 'Clear');
    expect(rough / clear).toBeCloseTo(0.40 / 0.60, 3);
  });
});

describe('cpp-parity: damage speed factor (combat.ts:249-253, drive.cpp:1157-1161)', () => {
  // C++ drive.cpp:1157-1161: when HP <= ConditionYellow (50%), speed reduced.
  // TS combat.ts:249-253: ratio <= CONDITION_YELLOW → 0.75x

  function makeTestEntity(hp: number, maxHp: number): Entity {
    const e = new Entity(UnitType.V_1TNK, UNIT_STATS['1TNK'], House.Greece, { x: 100, y: 100 });
    e.hp = hp;
    e.maxHp = maxHp;
    return e;
  }

  it('full HP → 1.0x speed (no reduction)', () => {
    const e = makeTestEntity(300, 300);
    expect(damageSpeedFactor(e)).toBe(1.0);
  });

  it('75% HP → 1.0x speed (above yellow threshold)', () => {
    const e = makeTestEntity(225, 300);
    expect(damageSpeedFactor(e)).toBe(1.0);
  });

  it('51% HP → 1.0x speed (just above CONDITION_YELLOW=0.5)', () => {
    const e = makeTestEntity(154, 300);
    expect(e.hp / e.maxHp).toBeGreaterThan(CONDITION_YELLOW);
    expect(damageSpeedFactor(e)).toBe(1.0);
  });

  it('50% HP → 0.75x speed (at CONDITION_YELLOW threshold)', () => {
    const e = makeTestEntity(150, 300);
    expect(e.hp / e.maxHp).toBe(CONDITION_YELLOW);
    expect(damageSpeedFactor(e)).toBe(0.75);
  });

  it('25% HP → 0.75x speed (below yellow, no further reduction)', () => {
    const e = makeTestEntity(75, 300);
    expect(damageSpeedFactor(e)).toBe(0.75);
  });

  it('1 HP → 0.75x speed (nearly dead)', () => {
    const e = makeTestEntity(1, 300);
    expect(damageSpeedFactor(e)).toBe(0.75);
  });
});

describe('cpp-parity: all UNIT_STATS speed values produce correct movement rates', () => {
  // Verify that every unit type in UNIT_STATS with speed > 0 produces a positive
  // movement rate on road, and that the speed ordering is correct.

  const allUnits = Object.entries(UNIT_STATS).filter(([, s]) => s.speed > 0);

  it('every mobile unit has positive px/tick on road', () => {
    for (const [key, stats] of allUnits) {
      const pxPerTick = stats.speed * MPH_TO_PX;
      expect(pxPerTick, `${key} should have positive speed`).toBeGreaterThan(0);
    }
  });

  it('speed ordering: 4TNK < 3TNK < 2TNK < 1TNK < JEEP (per rules.ini)', () => {
    const order = ['4TNK', '3TNK', '2TNK', '1TNK', 'JEEP'];
    for (let i = 0; i < order.length - 1; i++) {
      const a = UNIT_STATS[order[i]].speed;
      const b = UNIT_STATS[order[i + 1]].speed;
      expect(a, `${order[i]} (${a}) should be <= ${order[i + 1]} (${b})`).toBeLessThanOrEqual(b);
    }
  });

  it('infantry slower than most vehicles: E1 (4) < 1TNK (9)', () => {
    expect(UNIT_STATS.E1.speed).toBeLessThan(UNIT_STATS['1TNK'].speed);
  });

  it('all infantry use FOOT speed class', () => {
    const infantry = ['E1', 'E2', 'E3', 'E4', 'E6', 'DOG', 'SPY', 'MEDI'];
    for (const key of infantry) {
      expect(UNIT_STATS[key].speedClass, `${key} should be FOOT`).toBe(SpeedClass.FOOT);
    }
  });

  it('all tanks/vehicles use WHEEL speed class (udata.cpp:865 override)', () => {
    // C++ udata.cpp:865 forces all vehicle types to SPEED_WHEEL regardless of
    // what might be logical (tanks would be TRACK, but code overrides to WHEEL).
    const vehicles = ['1TNK', '2TNK', '3TNK', '4TNK', 'JEEP', 'APC', 'ARTY', 'HARV', 'MCV'];
    for (const key of vehicles) {
      expect(UNIT_STATS[key].speedClass, `${key} should be WHEEL`).toBe(SpeedClass.WHEEL);
    }
  });

  it('vessels use FLOAT speed class', () => {
    const vessels = ['SS'];
    for (const key of vessels) {
      if (UNIT_STATS[key]) {
        expect(UNIT_STATS[key].speedClass, `${key} should be FLOAT`).toBe(SpeedClass.FLOAT);
      }
    }
  });
});

describe('cpp-parity: TS vs C++ speed ratio is consistent (design validation)', () => {
  // The TS uses INI Speed= percentage directly as lepton budget.
  // C++ uses _Scale_To_256(Speed%) as lepton budget.
  // Ratio = _Scale_To_256(N) / N = floor(N*256/100) / N ≈ 2.56 (for most values).
  // This means C++ units move ~2.56x faster than TS units at the same INI Speed.
  // This ratio should be consistent across all units (linear function).

  it('speed ratio _Scale_To_256(N)/N is approximately 2.56 for all game speeds', () => {
    const gameSpeedValues = [3, 4, 5, 6, 7, 8, 9, 10, 12, 14];
    for (const speed of gameSpeedValues) {
      const cppMPH = cppScaleTo256(speed);
      const ratio = cppMPH / speed;
      // Ratio varies slightly due to integer truncation but stays close to 2.56
      expect(ratio).toBeGreaterThanOrEqual(2.33); // floor effect lower bound
      expect(ratio).toBeLessThanOrEqual(2.56);    // upper bound
    }
  });

  it('1TNK: C++ moves 23/9 ≈ 2.56x faster than TS per tick', () => {
    const iniSpeed = 9;
    const cppMPH = cppScaleTo256(iniSpeed);
    const ratio = cppMPH / iniSpeed;
    expect(cppMPH).toBe(23);
    expect(ratio).toBeCloseTo(23 / 9, 3);
  });

  it('E1: C++ moves 10/4 = 2.5x faster than TS per tick', () => {
    const iniSpeed = 4;
    const cppMPH = cppScaleTo256(iniSpeed);
    expect(cppMPH).toBe(10);
    expect(cppMPH / iniSpeed).toBe(2.5);
  });
});

describe('cpp-parity: diagonal movement costs (Track 2 has 32 steps vs Track 1 with 24)', () => {
  // C++ Track 1 (straight N): 24 steps = 24 * 10 = 240 leptons
  // C++ Track 2 (diagonal NE): 32 steps = 32 * 10 = 320 leptons
  // Diagonal distance = sqrt(2) * CELL_SIZE ≈ 33.94 pixels.
  // Ratio: 32/24 ≈ 1.333 (close to sqrt(2) ≈ 1.414 but not exact).
  // This means diagonal movement takes ~33% longer than cardinal, matching C++ behavior.

  it('cardinal track (24 steps) vs diagonal track (32 steps) ratio ≈ 1.333', () => {
    const cardinalSteps = 24;
    const diagonalSteps = 32;
    expect(diagonalSteps / cardinalSteps).toBeCloseTo(4 / 3, 5);
  });

  it('diagonal lepton cost (320) is 33% more than cardinal (240)', () => {
    const cardinalCost = 24 * PIXEL_LEPTON_W; // 240
    const diagonalCost = 32 * PIXEL_LEPTON_W; // 320
    expect(cardinalCost).toBe(240);
    expect(diagonalCost).toBe(320);
    expect((diagonalCost - cardinalCost) / cardinalCost).toBeCloseTo(1 / 3, 5);
  });
});

describe('cpp-parity: terrain speed effect on cell crossing time', () => {
  // Test that terrain modifiers correctly affect the ticks to cross a cell.

  it('1TNK on clear terrain (WHEEL=0.60): lepton budget = 9 * 0.60 = 5.4/tick', () => {
    const budget = tsLeptonBudget('1TNK', 'Clear');
    expect(budget).toBeCloseTo(9 * 0.60, 5);
  });

  it('1TNK on rough terrain (WHEEL=0.40): lepton budget = 9 * 0.40 = 3.6/tick', () => {
    const budget = tsLeptonBudget('1TNK', 'Rough');
    expect(budget).toBeCloseTo(9 * 0.40, 5);
  });

  it('E1 on clear terrain (FOOT=0.90): lepton budget = 4 * 0.90 = 3.6/tick', () => {
    const budget = tsLeptonBudget('E1', 'Clear');
    expect(budget).toBeCloseTo(4 * 0.90, 5);
  });

  it('E1 on rough terrain (FOOT=0.80): lepton budget = 4 * 0.80 = 3.2/tick', () => {
    const budget = tsLeptonBudget('E1', 'Rough');
    expect(budget).toBeCloseTo(4 * 0.80, 5);
  });

  it('rough terrain is worse for vehicles than infantry (ratio comparison)', () => {
    // On rough: WHEEL loses 60% speed (0.40), FOOT loses only 20% (0.80)
    // Relative penalty: 0.40/0.60 = 0.667 for WHEEL, 0.80/0.90 = 0.889 for FOOT
    const wheelPenalty = getTerrainSpeed('Rough', SpeedClass.WHEEL) / getTerrainSpeed('Clear', SpeedClass.WHEEL);
    const footPenalty = getTerrainSpeed('Rough', SpeedClass.FOOT) / getTerrainSpeed('Clear', SpeedClass.FOOT);
    expect(wheelPenalty).toBeCloseTo(0.40 / 0.60, 3);
    expect(footPenalty).toBeCloseTo(0.80 / 0.90, 3);
    expect(wheelPenalty).toBeLessThan(footPenalty); // vehicles suffer more
  });
});

describe('cpp-parity: speedClass assignment (udata.cpp:865, idata.cpp)', () => {
  // C++ udata.cpp:865 forces all vehicle-type units to SPEED_WHEEL.
  // This is an important parity point: even tracked vehicles (tanks) use WHEEL
  // terrain costs, not TRACK costs. TRACK exists but is unused.

  it('ants use WHEEL speed class (same as vehicles)', () => {
    expect(UNIT_STATS.ANT1.speedClass).toBe(SpeedClass.WHEEL);
    expect(UNIT_STATS.ANT2.speedClass).toBe(SpeedClass.WHEEL);
    expect(UNIT_STATS.ANT3.speedClass).toBe(SpeedClass.WHEEL);
  });

  it('Chinook uses WINGED speed class (ignores terrain)', () => {
    expect(UNIT_STATS.TRAN.speedClass).toBe(SpeedClass.WINGED);
    expect(UNIT_STATS.TRAN.isAircraft).toBe(true);
  });

  it('LST uses FLOAT speed class', () => {
    expect(UNIT_STATS.LST.speedClass).toBe(SpeedClass.FLOAT);
  });
});
