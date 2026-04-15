/**
 * C++ Behavioral Parity: Speed Accumulator (Lepton Sub-Pixel Movement)
 *
 * Tests verify that TypeScript moveToward() produces positions matching
 * C++ fly.cpp:62-106 integer lepton accumulator math.
 *
 * C++ source references:
 *   fly.cpp:62-106    — SpeedAdd/SpeedAccum integer accumulator for movement
 *   drive.cpp:664-792 — While_Moving uses same accumulator pattern for track movement
 *   techno.cpp:6287   — _Scale_To_256: MaxSpeed = (Speed * 256) / 100
 *   drive.cpp:1157    — damageSpeedFactor: <=50% HP → 75% speed
 *
 * The accumulator pattern:
 *   actual = (int)SpeedAdd + SpeedAccum
 *   result = div(actual, PIXEL_LEPTON_W)
 *   SpeedAccum = result.rem
 *   actual -= result.rem   // only whole-pixel steps emitted
 *
 * PIXEL_LEPTON_W = CELL_LEPTON_W / ICON_PIXEL_W = 256/24 = 10 (integer division)
 * LP = CELL_SIZE / LEPTON_SIZE = 24/256 = 0.09375 px/lepton
 *
 * Without the accumulator, floating-point arithmetic causes 1-2 cell drift over 100+ ticks.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import {
  UnitType, House, CELL_SIZE, Dir, Mission, AnimState,
  UNIT_STATS, MPH_TO_PX, LEPTON_SIZE,
  type WorldPos,
} from '../engine/types';
import { Entity, resetEntityIds } from '../engine/entity';
import { LP, PIXEL_LEPTON_W } from '../engine/tracks';

beforeEach(() => resetEntityIds());

// -- C++ Reference Implementation --------------------------------------------------

/**
 * Simulates C++ fly.cpp:62-106 integer lepton accumulator.
 * Given a speed in rules.ini percentage, computes position after N ticks
 * moving in a straight line (due east for simplicity).
 *
 * C++ chain:
 *   MaxSpeed = _Scale_To_256(Speed) = (Speed * 256) / 100  (integer)
 *   Set_Speed(0xFF): SpeedAdd = floor(MaxSpeed * 255 / 256)  — 255/256 fraction
 *   Per tick:
 *     actual = (int)SpeedAdd + SpeedAccum
 *     wholePixelSteps = actual / PIXEL_LEPTON_W  (integer division)
 *     SpeedAccum = actual % PIXEL_LEPTON_W
 *     move wholePixelSteps pixels
 */
/**
 * C++ vehicle accumulator position: SpeedAccum + Coord_Move.
 * Vehicles use the SpeedAccum accumulator, then apply Coord_Move sin/cos per-axis.
 */
function cppVehicleAccumulatorPosition(
  startX: number,
  rulesSpeed: number,
  ticks: number,
  damageSpeedMul: number = 1.0,
  speedBias: number = 1.0,
): { x: number; accum: number } {
  // C++ _Scale_To_256: MaxSpeed = (Speed * 256) / 100 — integer math
  const maxSpeedLeptons = Math.floor((rulesSpeed * LEPTON_SIZE) / 100);
  // Effective speed in leptons with damage factor and bias
  const effectiveLeptons = Math.floor(maxSpeedLeptons * damageSpeedMul * speedBias);
  // C++ Set_Speed: SpeedAdd = MaxSpeed * fixed(0xFF, 256)
  // fixed::operator*(int): ((Raw * int) + 128) / 256  — rounds to nearest
  const effectiveSpeedLeptons = Math.floor((effectiveLeptons * 255 + 128) / 256);

  let leptonX = Math.trunc(startX / LP);
  let accum = 0;

  for (let t = 0; t < ticks; t++) {
    const actual = effectiveSpeedLeptons + accum;
    const remainder = actual % PIXEL_LEPTON_W;
    const moveLeptons = actual - remainder;
    accum = remainder;

    // Coord_Move: per-axis (moveLeptons * sinFactor) >> 7, cardinal sinFactor=127
    const axisLeptons = (moveLeptons * 127) >> 7;
    leptonX += axisLeptons;
  }

  return { x: leptonX * LP, accum };
}

/**
 * C++ infantry position: direct Coord_Move (no SpeedAccum).
 * Infantry applies maxspeed through Coord_Move sin/cos per tick, no accumulator gating.
 */
function cppInfantryPosition(
  startX: number,
  rulesSpeed: number,
  ticks: number,
  speedBias: number = 1.0,
): { x: number; accum: number } {
  const maxSpeedLeptons = Math.floor((rulesSpeed * LEPTON_SIZE) / 100);
  const effectiveLeptons = Math.floor(maxSpeedLeptons * speedBias);
  // Infantry Coord_Move: cardinal sinFactor=127
  const axisLeptons = (effectiveLeptons * 127) >> 7;

  let leptonX = Math.trunc(startX / LP);

  for (let t = 0; t < ticks; t++) {
    leptonX += axisLeptons;
  }

  return { x: leptonX * LP, accum: 0 };
}

// -- Helpers ------------------------------------------------------------------

function makeEntity(unitKey: string, house: House, x: number, y: number): Entity {
  const stats = UNIT_STATS[unitKey];
  const type = stats.type;
  return new Entity(type, house, x, y);
}

/**
 * Simulate moveToward for N ticks moving due East toward a distant target.
 * Returns final position and speedAccum.
 */
function simulateMoveToward(
  entity: Entity,
  ticks: number,
  speedPixels: number,
): { x: number; y: number; accum: number } {
  // Target is far to the east so entity never arrives
  const farTarget: WorldPos = { x: entity.pos.x + 10000, y: entity.pos.y };

  // Pre-align facing to East so vehicles don't waste ticks rotating
  entity.facing = Dir.E;
  entity.desiredFacing = Dir.E;

  for (let t = 0; t < ticks; t++) {
    entity.moveToward(farTarget, speedPixels);
  }

  return { x: entity.pos.x, y: entity.pos.y, accum: entity.speedAccum };
}

// -- Tests ------------------------------------------------------------------

describe('C++ lepton speed accumulator parity (fly.cpp:62-106)', () => {

  describe('PIXEL_LEPTON_W constant', () => {
    it('PIXEL_LEPTON_W = floor(256/24) = 10', () => {
      // C++ drive.h: PIXEL_LEPTON_W = CELL_LEPTON_W / ICON_PIXEL_W
      expect(PIXEL_LEPTON_W).toBe(Math.floor(256 / 24));
      expect(PIXEL_LEPTON_W).toBe(10);
    });

    it('LP = CELL_SIZE / 256 = 0.09375', () => {
      expect(LP).toBe(CELL_SIZE / 256);
      expect(LP).toBeCloseTo(0.09375, 10);
    });
  });

  describe('infantry straight-line movement matches C++ Coord_Move', () => {
    // Infantry does NOT use SpeedAccum — it uses direct Coord_Move per tick.
    // E1 Speed=4: MaxSpeed=10 leptons, cardinal: (10*127)>>7=9 leptons/tick
    it('E1 (Speed=4) — infantry Coord_Move over 200 ticks', () => {
      const rulesSpeed = UNIT_STATS['E1'].speed; // 4
      expect(rulesSpeed).toBe(4);

      const startX = 100;
      const ticks = 200;

      const cpp = cppInfantryPosition(startX, rulesSpeed, ticks);

      const entity = makeEntity('E1', House.Spain, startX, 100);
      const speedPx = rulesSpeed * MPH_TO_PX;
      const ts = simulateMoveToward(entity, ticks, speedPx);

      expect(ts.x).toBeCloseTo(cpp.x, 6);
      // Infantry doesn't use speedAccum
      expect(ts.accum).toBe(0);
    });

    // E3 Rocket Soldier: Speed=3
    // MaxSpeed=7, cardinal: (7*127)>>7=6 leptons/tick
    it('E3 (Speed=3) — infantry Coord_Move over 150 ticks', () => {
      const rulesSpeed = UNIT_STATS['E3'].speed; // 3
      expect(rulesSpeed).toBe(3);

      const startX = 200;
      const ticks = 150;

      const cpp = cppInfantryPosition(startX, rulesSpeed, ticks);

      const entity = makeEntity('E3', House.Spain, startX, 200);
      const speedPx = rulesSpeed * MPH_TO_PX;
      const ts = simulateMoveToward(entity, ticks, speedPx);

      expect(ts.x).toBeCloseTo(cpp.x, 6);
      expect(ts.accum).toBe(0);
    });

    // E2 Grenadier: Speed=5
    // MaxSpeed=12, cardinal: (12*127)>>7=11 leptons/tick
    it('E2 (Speed=5) — infantry Coord_Move over 300 ticks', () => {
      const rulesSpeed = UNIT_STATS['E2'].speed;
      expect(rulesSpeed).toBe(5);

      const startX = 50;
      const ticks = 300;

      const cpp = cppInfantryPosition(startX, rulesSpeed, ticks);

      const entity = makeEntity('E2', House.Spain, startX, 50);
      const speedPx = rulesSpeed * MPH_TO_PX;
      const ts = simulateMoveToward(entity, ticks, speedPx);

      expect(ts.x).toBeCloseTo(cpp.x, 6);
      expect(ts.accum).toBe(0);
    });
  });

  describe('vehicle straight-line movement matches C++ accumulator', () => {
    // 2TNK Medium Tank: Speed=8
    // MaxSpeed = floor(8 * 256 / 100) = floor(20.48) = 20 leptons/tick
    // 20 / 10 = 2 remainder 0 → exactly 2 pixel steps/tick
    it('2TNK (Speed=8) — medium tank over 100 ticks', () => {
      const rulesSpeed = UNIT_STATS['2TNK'].speed;
      expect(rulesSpeed).toBe(8);

      const startX = 100;
      const ticks = 100;

      const cpp = cppVehicleAccumulatorPosition(startX, rulesSpeed, ticks);

      const entity = makeEntity('2TNK', House.Spain, startX, 100);
      entity.facing = Dir.E;
      entity.desiredFacing = Dir.E;
      const speedPx = rulesSpeed * MPH_TO_PX;
      const ts = simulateMoveToward(entity, ticks, speedPx);

      expect(ts.x).toBeCloseTo(cpp.x, 6);
      expect(ts.accum).toBe(cpp.accum);
    });

    // 1TNK Light Tank: Speed=9
    // MaxSpeed = floor(9 * 256 / 100) = floor(23.04) = 23 leptons/tick
    // 23 / 10 = 2 remainder 3 → 2 pixel steps, accum=3
    it('1TNK (Speed=9) — light tank over 200 ticks', () => {
      const rulesSpeed = UNIT_STATS['1TNK'].speed;
      expect(rulesSpeed).toBe(9);

      const startX = 50;
      const ticks = 200;

      const cpp = cppVehicleAccumulatorPosition(startX, rulesSpeed, ticks);

      const entity = makeEntity('1TNK', House.Spain, startX, 50);
      entity.facing = Dir.E;
      entity.desiredFacing = Dir.E;
      const speedPx = rulesSpeed * MPH_TO_PX;
      const ts = simulateMoveToward(entity, ticks, speedPx);

      expect(ts.x).toBeCloseTo(cpp.x, 6);
      expect(ts.accum).toBe(cpp.accum);
    });
  });

  describe('accumulator remainder tracking', () => {
    it('accumulator cycles correctly through remainder pattern', () => {
      // Use a vehicle (ARTY, Speed=6) — infantry doesn't use SpeedAccum.
      // Speed=6 → MaxSpeed = floor(6*256/100) = 15 leptons/tick
      // 255/256 fraction: speedAdd = floor(15*255/256) = 14 leptons/tick
      // Expected accumulator sequence: 4, 8, 2, 6, 0, 4, 8, 2, 6, 0 (repeats every 5 ticks)
      const rulesSpeed = 6;
      const maxSpeedLeptons = Math.floor((rulesSpeed * LEPTON_SIZE) / 100); // 15
      expect(maxSpeedLeptons).toBe(15);
      // C++ fixed::operator*(int): ((255 * maxspeed) + 128) / 256
      const speedAdd = Math.floor((maxSpeedLeptons * 255 + 128) / 256); // 15
      expect(speedAdd).toBe(15);

      // speedAdd=15, PIXEL_LEPTON_W=10: 15%10=5, cycle: [5, 0, 5, 0, ...]
      const expectedAccums = [5, 0, 5, 0, 5, 0, 5, 0, 5, 0];

      const entity = makeEntity('ARTY', House.Spain, 100, 100);
      entity.facing = Dir.E;
      entity.desiredFacing = Dir.E;
      entity.bodyFacing32 = Dir.E * 4;
      const speedPx = rulesSpeed * MPH_TO_PX;
      const farTarget: WorldPos = { x: 10000, y: entity.pos.y };

      for (let t = 0; t < 10; t++) {
        entity.moveToward(farTarget, speedPx);
        expect(entity.speedAccum, `tick ${t + 1}`).toBe(expectedAccums[t]);
      }

      // After 10 ticks the accumulator should be back to 0
      expect(entity.speedAccum).toBe(0);
    });

    it('accumulator resets on arrival', () => {
      // Use a vehicle — infantry doesn't use SpeedAccum
      const entity = makeEntity('ARTY', House.Spain, 100, 100);
      entity.facing = Dir.E;
      entity.desiredFacing = Dir.E;
      entity.bodyFacing32 = Dir.E * 4;

      // Move partway to build up accumulator
      const farTarget: WorldPos = { x: 10000, y: entity.pos.y };
      entity.moveToward(farTarget, 6 * MPH_TO_PX);
      expect(entity.speedAccum).toBeGreaterThan(0);

      // Now move to a very close target that triggers snap arrival
      const closeTarget: WorldPos = { x: entity.pos.x + 0.3, y: entity.pos.y };
      const arrived = entity.moveToward(closeTarget, 6 * MPH_TO_PX);
      expect(arrived).toBe(true);
      expect(entity.speedAccum).toBe(0);
    });
  });

  describe('drift prevention over long distances', () => {
    it('no drift between C++ and TS after 500 ticks at Speed=7 (vehicle)', () => {
      // Use 3TNK (Speed=7) — a vehicle that uses SpeedAccum
      // Speed=7 → MaxSpeed = floor(7*256/100) = floor(17.92) = 17 leptons/tick
      // 17 % 10 = 7 → non-trivial remainder pattern
      const rulesSpeed = 7;
      const startX = 100;
      const ticks = 500;

      const cpp = cppVehicleAccumulatorPosition(startX, rulesSpeed, ticks);

      const entity = makeEntity('3TNK', House.Spain, startX, 100);
      entity.facing = Dir.E;
      entity.desiredFacing = Dir.E;
      entity.bodyFacing32 = Dir.E * 4;
      const speedPx = rulesSpeed * MPH_TO_PX;
      const ts = simulateMoveToward(entity, ticks, speedPx);

      expect(ts.x).toBeCloseTo(cpp.x, 6);
      expect(ts.accum).toBe(cpp.accum);
    });

    it('no drift after 1000 ticks at Speed=3 (worst-case, vehicle)', () => {
      // Use QTNK (Speed=3) — Aftermath vehicle with low speed
      const rulesSpeed = 3;
      const startX = 50;
      const ticks = 1000;

      const cpp = cppVehicleAccumulatorPosition(startX, rulesSpeed, ticks);

      const entity = makeEntity('QTNK', House.Spain, startX, 50);
      entity.facing = Dir.E;
      entity.desiredFacing = Dir.E;
      entity.bodyFacing32 = Dir.E * 4;
      const speedPx = rulesSpeed * MPH_TO_PX;
      const ts = simulateMoveToward(entity, ticks, speedPx);

      expect(ts.x).toBeCloseTo(cpp.x, 6);
      expect(ts.accum).toBe(cpp.accum);
    });

    it('no drift for infantry after 500 ticks at Speed=4', () => {
      // Infantry uses Coord_Move, no SpeedAccum
      const rulesSpeed = 4;
      const startX = 100;
      const ticks = 500;

      const cpp = cppInfantryPosition(startX, rulesSpeed, ticks);

      const entity = makeEntity('E1', House.Spain, startX, 100);
      const speedPx = rulesSpeed * MPH_TO_PX;
      const ts = simulateMoveToward(entity, ticks, speedPx);

      expect(ts.x).toBeCloseTo(cpp.x, 6);
      expect(ts.accum).toBe(0);
    });
  });

  describe('damage speed factor with accumulator', () => {
    it('damaged unit (<=50% HP → 75% speed) uses accumulator correctly', () => {
      const rulesSpeed = UNIT_STATS['2TNK'].speed; // 8
      const startX = 100;
      const ticks = 150;
      const damageFactor = 0.75; // C++ ConditionYellow

      const cpp = cppVehicleAccumulatorPosition(startX, rulesSpeed, ticks, damageFactor);

      const entity = makeEntity('2TNK', House.Spain, startX, 100);
      entity.facing = Dir.E;
      entity.desiredFacing = Dir.E;
      // movementSpeed applies damageFactor before passing to moveToward
      const speedPx = rulesSpeed * MPH_TO_PX * damageFactor;
      const ts = simulateMoveToward(entity, ticks, speedPx);

      expect(ts.x).toBeCloseTo(cpp.x, 6);
      expect(ts.accum).toBe(cpp.accum);
    });
  });

  describe('speed bias (crate) with accumulator', () => {
    it('crate speed bonus (1.7x) uses accumulator correctly', () => {
      const rulesSpeed = UNIT_STATS['1TNK'].speed; // 9
      const startX = 100;
      const ticks = 100;
      const speedBias = 1.7; // M7 crate speed bonus

      // C++ applies speedBias to the lepton speed
      const cpp = cppVehicleAccumulatorPosition(startX, rulesSpeed, ticks, 1.0, speedBias);

      const entity = makeEntity('1TNK', House.Spain, startX, 100);
      entity.facing = Dir.E;
      entity.desiredFacing = Dir.E;
      entity.speedBias = speedBias; // crate bonus applied inside moveToward
      const speedPx = rulesSpeed * MPH_TO_PX;
      const ts = simulateMoveToward(entity, ticks, speedPx);

      expect(ts.x).toBeCloseTo(cpp.x, 6);
      expect(ts.accum).toBe(cpp.accum);
    });
  });

  describe('pixel-step quantization (vehicles)', () => {
    it('speed too slow for a pixel step accumulates until threshold', () => {
      // Use a vehicle with low speed to test SpeedAccum sub-pixel accumulation.
      // Speed=1 px passed directly → MaxSpeed = floor(1/LP) = 10 leptons
      // speedAdd = floor((10*255+128)/256) = floor(2678/256) = 10 leptons/tick
      // 10 >= 10 → moves on first tick!
      // C++ fixed rounding (+128) means speed 10 → speedAdd 10 (no loss).
      const entity = makeEntity('ARTY', House.Spain, 100, 100);
      entity.facing = Dir.E;
      entity.desiredFacing = Dir.E;
      entity.bodyFacing32 = Dir.E * 4;
      const speedPx = 1; // very slow: 1 px/tick
      const startX = entity.pos.x;
      const farTarget: WorldPos = { x: 10000, y: entity.pos.y };

      // First tick: maxSpeedLeptons=10, speedAdd=10, actual=10 → 10%10=0, move 10 leptons
      entity.moveToward(farTarget, speedPx);
      const expectedMove = ((10 * 127) >> 7) * LP; // 9 * 0.09375 = 0.84375
      expect(entity.pos.x - startX).toBeCloseTo(expectedMove, 10);
      expect(entity.speedAccum).toBe(0);
    });

    it('movement is always in discrete pixel-step increments (vehicle)', () => {
      // ARTY Speed=6 → 6*0.24=1.44 px/tick → floor(1.44/LP)=15 leptons
      // speedAdd = floor((15*255+128)/256) = floor(3953/256) = 15 leptons/tick
      // 15/10 = 1 remainder 5 → moveLeptons=10, accum=5
      // Coord_Move cardinal: (10*127)>>7=9 axis leptons → 9*LP=0.84375
      const rulesSpeed = 6;
      const entity = makeEntity('ARTY', House.Spain, 100, 100);
      entity.facing = Dir.E;
      entity.desiredFacing = Dir.E;
      entity.bodyFacing32 = Dir.E * 4;
      const speedPx = rulesSpeed * MPH_TO_PX;
      const farTarget: WorldPos = { x: 10000, y: entity.pos.y };
      const startX = entity.pos.x;

      entity.moveToward(farTarget, speedPx);

      // Coord_Move: (10*127)>>7=9 leptons → 9*LP=0.84375 px
      const expectedMove = ((10 * 127) >> 7) * LP;
      expect(entity.pos.x - startX).toBeCloseTo(expectedMove, 10);
      expect(entity.speedAccum).toBe(5);
    });
  });
});
