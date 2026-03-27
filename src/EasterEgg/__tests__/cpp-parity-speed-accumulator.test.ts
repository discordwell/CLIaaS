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
function cppAccumulatorPosition(
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
  // C++ Set_Speed: SpeedAdd = MaxSpeed * fixed(0xFF, 256) — the 255/256 fraction
  const effectiveSpeedLeptons = Math.floor((effectiveLeptons * 255) / 256);

  let x = startX;
  let accum = 0;

  for (let t = 0; t < ticks; t++) {
    const actual = effectiveSpeedLeptons + accum;
    const remainder = actual % PIXEL_LEPTON_W;
    const moveLeptons = actual - remainder;
    accum = remainder;

    // Convert leptons to pixels: leptons * (CELL_SIZE / LEPTON_SIZE) = leptons * LP
    const movePixels = moveLeptons * LP;
    x += movePixels;
  }

  return { x, accum };
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

  describe('infantry straight-line movement matches C++ accumulator', () => {
    // E1 Rifle Infantry: Speed=4 in rules.ini (UNIT_STATS['E1'].speed)
    // MaxSpeed = floor(4 * 256 / 100) = floor(10.24) = 10 leptons/tick
    // At PIXEL_LEPTON_W=10: exactly 1 pixel step/tick, no remainder
    it('E1 (Speed=4) — exact pixel alignment, no accumulator drift', () => {
      const rulesSpeed = UNIT_STATS['E1'].speed; // 4
      expect(rulesSpeed).toBe(4);

      const startX = 100;
      const ticks = 200;

      const cpp = cppAccumulatorPosition(startX, rulesSpeed, ticks);

      const entity = makeEntity('E1', House.Spain, startX, 100);
      const speedPx = rulesSpeed * MPH_TO_PX; // 4 * 0.24 = 0.96 px/tick
      const ts = simulateMoveToward(entity, ticks, speedPx);

      // Both should produce identical positions
      expect(ts.x).toBeCloseTo(cpp.x, 6);
      expect(ts.accum).toBe(cpp.accum);
    });

    // E3 Rocket Soldier: Speed=3
    // MaxSpeed = floor(3 * 256 / 100) = floor(7.68) = 7 leptons/tick
    // 7 / 10 = 0 remainder 7 → first tick: 0 pixels, accum=7
    // tick 2: 7+7=14, 14/10=1 remainder 4 → 1 pixel step, accum=4
    // This produces a non-trivial accumulation pattern
    it('E3 (Speed=3) — sub-pixel accumulation over 150 ticks', () => {
      const rulesSpeed = UNIT_STATS['E3'].speed; // 3
      expect(rulesSpeed).toBe(3);

      const startX = 200;
      const ticks = 150;

      const cpp = cppAccumulatorPosition(startX, rulesSpeed, ticks);

      const entity = makeEntity('E3', House.Spain, startX, 200);
      const speedPx = rulesSpeed * MPH_TO_PX;
      const ts = simulateMoveToward(entity, ticks, speedPx);

      expect(ts.x).toBeCloseTo(cpp.x, 6);
      expect(ts.accum).toBe(cpp.accum);
    });

    // E2 Grenadier: Speed=5
    // MaxSpeed = floor(5 * 256 / 100) = floor(12.8) = 12 leptons/tick
    // 12 / 10 = 1 remainder 2 → 1 pixel step, accum=2
    it('E2 (Speed=5) — confirms accumulation pattern over 300 ticks', () => {
      const rulesSpeed = UNIT_STATS['E2'].speed;
      expect(rulesSpeed).toBe(5);

      const startX = 50;
      const ticks = 300;

      const cpp = cppAccumulatorPosition(startX, rulesSpeed, ticks);

      const entity = makeEntity('E2', House.Spain, startX, 50);
      const speedPx = rulesSpeed * MPH_TO_PX;
      const ts = simulateMoveToward(entity, ticks, speedPx);

      expect(ts.x).toBeCloseTo(cpp.x, 6);
      expect(ts.accum).toBe(cpp.accum);
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

      const cpp = cppAccumulatorPosition(startX, rulesSpeed, ticks);

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

      const cpp = cppAccumulatorPosition(startX, rulesSpeed, ticks);

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
      // Speed=3 → MaxSpeed = floor(3*256/100) = 7 leptons/tick
      // 255/256 fraction: speedAdd = floor(7*255/256) = 6 leptons/tick
      // Expected accumulator sequence: 0→6→2→8→4→0 (repeats every 5 ticks)
      const rulesSpeed = 3;
      const maxSpeedLeptons = Math.floor((rulesSpeed * LEPTON_SIZE) / 100); // 7
      expect(maxSpeedLeptons).toBe(7);
      const speedAdd = Math.floor((maxSpeedLeptons * 255) / 256); // 6
      expect(speedAdd).toBe(6);

      const expectedAccums = [6, 2, 8, 4, 0, 6, 2, 8, 4, 0];

      const entity = makeEntity('E3', House.Spain, 100, 100);
      entity.facing = Dir.E;
      entity.desiredFacing = Dir.E;
      const speedPx = rulesSpeed * MPH_TO_PX;
      const farTarget: WorldPos = { x: 10000, y: 100 };

      for (let t = 0; t < 10; t++) {
        entity.moveToward(farTarget, speedPx);
        expect(entity.speedAccum, `tick ${t + 1}`).toBe(expectedAccums[t]);
      }

      // After 10 ticks the accumulator should be back to 0
      expect(entity.speedAccum).toBe(0);
    });

    it('accumulator resets on arrival', () => {
      const entity = makeEntity('E3', House.Spain, 100, 100);
      entity.facing = Dir.E;
      entity.desiredFacing = Dir.E;

      // Move partway to build up accumulator
      const farTarget: WorldPos = { x: 10000, y: 100 };
      entity.moveToward(farTarget, 3 * MPH_TO_PX);
      expect(entity.speedAccum).toBeGreaterThan(0);

      // Now move to a very close target that triggers snap arrival
      const closeTarget: WorldPos = { x: entity.pos.x + 0.3, y: 100 };
      const arrived = entity.moveToward(closeTarget, 3 * MPH_TO_PX);
      expect(arrived).toBe(true);
      expect(entity.speedAccum).toBe(0);
    });
  });

  describe('drift prevention over long distances', () => {
    it('no drift between C++ and TS after 500 ticks at Speed=7', () => {
      // Speed=7 → MaxSpeed = floor(7*256/100) = floor(17.92) = 17 leptons/tick
      // 17 % 10 = 7 → non-trivial remainder pattern
      // Over 500 ticks, floating-point would accumulate measurable drift
      const rulesSpeed = 7;
      const startX = 100;
      const ticks = 500;

      const cpp = cppAccumulatorPosition(startX, rulesSpeed, ticks);

      const entity = makeEntity('E1', House.Spain, startX, 100);
      const speedPx = rulesSpeed * MPH_TO_PX;
      const ts = simulateMoveToward(entity, ticks, speedPx);

      // Position must match exactly (within floating-point representability of the pixel math)
      expect(ts.x).toBeCloseTo(cpp.x, 6);
      expect(ts.accum).toBe(cpp.accum);
    });

    it('no drift after 1000 ticks at Speed=3 (worst-case remainder pattern)', () => {
      // Speed=3 → MaxSpeed = 7 leptons/tick
      // 7 % 10 = 7 → needs multiple ticks to emit first step
      const rulesSpeed = 3;
      const startX = 50;
      const ticks = 1000;

      const cpp = cppAccumulatorPosition(startX, rulesSpeed, ticks);

      const entity = makeEntity('E3', House.Spain, startX, 50);
      const speedPx = rulesSpeed * MPH_TO_PX;
      const ts = simulateMoveToward(entity, ticks, speedPx);

      expect(ts.x).toBeCloseTo(cpp.x, 6);
      expect(ts.accum).toBe(cpp.accum);
    });
  });

  describe('damage speed factor with accumulator', () => {
    it('damaged unit (<=50% HP → 75% speed) uses accumulator correctly', () => {
      const rulesSpeed = UNIT_STATS['2TNK'].speed; // 8
      const startX = 100;
      const ticks = 150;
      const damageFactor = 0.75; // C++ ConditionYellow

      const cpp = cppAccumulatorPosition(startX, rulesSpeed, ticks, damageFactor);

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
      const cpp = cppAccumulatorPosition(startX, rulesSpeed, ticks, 1.0, speedBias);

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

  describe('pixel-step quantization', () => {
    it('speed too slow for a pixel step accumulates until threshold', () => {
      // Speed=1 → MaxSpeed = floor(1*256/100) = 2 leptons/tick
      // 255/256 fraction: speedAdd = floor(2*255/256) = 1 lepton/tick
      // PIXEL_LEPTON_W=10 → needs 10 ticks to emit 1 pixel step
      const rulesSpeed = 1;
      const entity = makeEntity('E1', House.Spain, 100, 100);
      entity.facing = Dir.E;
      entity.desiredFacing = Dir.E;
      const speedPx = rulesSpeed * MPH_TO_PX;
      const startX = entity.pos.x;
      const farTarget: WorldPos = { x: 10000, y: 100 };

      // Ticks 1-9: accumulate 1 lepton each, not enough for a pixel step
      for (let t = 0; t < 9; t++) {
        entity.moveToward(farTarget, speedPx);
        expect(entity.pos.x, `tick ${t + 1} should not move yet`).toBe(startX);
      }
      expect(entity.speedAccum).toBe(9); // 9 * 1 = 9 < 10

      // Tick 10: 9 + 1 = 10 → exactly 1 pixel step (10 leptons → 10 * 0.09375 = 0.9375 px)
      entity.moveToward(farTarget, speedPx);
      const onePixelStep = PIXEL_LEPTON_W * LP; // 10 * 0.09375 = 0.9375
      expect(entity.pos.x).toBeCloseTo(startX + onePixelStep, 10);
      expect(entity.speedAccum).toBe(0);
    });

    it('movement is always in discrete pixel-step increments', () => {
      // Speed=6 → MaxSpeed = floor(6*256/100) = 15 leptons/tick
      // 255/256 fraction: speedAdd = floor(15*255/256) = 14 leptons/tick
      // 14/10 = 1 remainder 4 → 1 pixel step, accum=4
      const rulesSpeed = 6;
      const entity = makeEntity('E1', House.Spain, 100, 100);
      entity.facing = Dir.E;
      entity.desiredFacing = Dir.E;
      const speedPx = rulesSpeed * MPH_TO_PX;
      const farTarget: WorldPos = { x: 10000, y: 100 };
      const startX = entity.pos.x;

      entity.moveToward(farTarget, speedPx);

      // Should move exactly 1 pixel step: 1 * 10 * LP = 10 * 0.09375 = 0.9375 px
      const expectedMove = 1 * PIXEL_LEPTON_W * LP;
      expect(entity.pos.x - startX).toBeCloseTo(expectedMove, 10);
      expect(entity.speedAccum).toBe(4);
    });
  });
});
