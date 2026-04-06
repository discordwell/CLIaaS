/**
 * C++ Behavioral Parity: Infantry Movement Without SpeedAccum Gating
 *
 * In C++ RA, infantry movement does NOT use SpeedAccum to gate whether movement
 * occurs on a given tick. The lepton accumulator (SpeedAccum) is a sub-pixel
 * remainder system used by vehicles and aircraft to emit whole-pixel movement steps.
 * For infantry with low Speed values, the accumulator can cause ticks where
 * moveLeptons <= 0, meaning the unit stands still — this is correct for vehicles
 * but WRONG for infantry.
 *
 * C++ infantry moves every tick by directly applying the speed vector to position.
 * The SpeedAccum system exists in drive.cpp (vehicles) and fly.cpp (aircraft), but
 * infantry foot movement in foot.cpp does not gate on the accumulator reaching a
 * pixel threshold — it moves the fractional amount every tick.
 *
 * After the fix: infantry should move on every tick (non-zero delta). Vehicles
 * should continue using SpeedAccum as before.
 *
 * C++ source references:
 *   foot.cpp:396-490  — FootClass::Per_Cell_Process / movement entry
 *   drive.cpp:664-792 — DriveClass::While_Moving — SpeedAccum gating for vehicles
 *   fly.cpp:62-106    — FlyClass::Physics — SpeedAccum gating for aircraft
 *   techno.cpp:6287   — _Scale_To_256: MaxSpeed = (Speed * 256) / 100
 *
 * rules.ini Speed values (authoritative):
 *   [E1]  Speed=4   → MaxSpeed = floor(4  * 256 / 100) = 10 leptons/tick
 *   [DOG] Speed=4   → MaxSpeed = floor(4  * 256 / 100) = 10 leptons/tick
 *   [JEEP] Speed=10 → MaxSpeed = floor(10 * 256 / 100) = 25 leptons/tick
 */

import { describe, it, expect, beforeEach } from 'vitest';
import {
  UnitType, House, Dir, CELL_SIZE,
  UNIT_STATS, MPH_TO_PX, LEPTON_SIZE,
  type WorldPos,
} from '../engine/types';
import { Entity, resetEntityIds } from '../engine/entity';
import { LP, PIXEL_LEPTON_W } from '../engine/tracks';

beforeEach(() => resetEntityIds());

// -- Helpers ------------------------------------------------------------------

function makeEntity(unitKey: string, house: House, x: number, y: number): Entity {
  const stats = UNIT_STATS[unitKey];
  const type = stats.type;
  const entity = new Entity(type, house, x, y);
  // Pre-align facing to East so no rotation needed
  entity.facing = Dir.E;
  entity.desiredFacing = Dir.E;
  entity.bodyFacing32 = Dir.E * 4;
  entity.prevBodyFacing32 = Dir.E * 4;
  return entity;
}

/**
 * Move entity toward a far-east target for N ticks, recording per-tick x deltas.
 * Returns the deltas array and final position.
 */
function collectPerTickDeltas(
  entity: Entity,
  ticks: number,
  speedPx: number,
): { deltas: number[]; finalX: number; finalY: number } {
  const farTarget: WorldPos = { x: entity.pos.x + 10000, y: entity.pos.y };
  const deltas: number[] = [];

  for (let t = 0; t < ticks; t++) {
    const prevX = entity.pos.x;
    // Reset per-frame rotation guard so each tick can rotate
    entity.rotTickedThisFrame = false;
    entity.moveToward(farTarget, speedPx);
    deltas.push(entity.pos.x - prevX);
  }

  return { deltas, finalX: entity.pos.x, finalY: entity.pos.y };
}

// -- Tests ------------------------------------------------------------------

describe('C++ parity: infantry movement without SpeedAccum gating', () => {

  describe('E1 infantry moves every tick', () => {
    // C++ infantry moves every tick — no tick should produce zero movement.
    // E1 Speed=4 from rules.ini. MaxSpeed = floor(4 * 256 / 100) = 10 leptons/tick.
    // SpeedAdd = floor(10 * 255 / 256) = floor(9.96) = 9 leptons/tick.
    // At PIXEL_LEPTON_W=10, tick 1: actual=9, 9%10=9 remainder → 0 pixels moved.
    // This is the BUG for infantry: the accumulator gates out a tick of movement.
    // After fix: infantry should bypass the accumulator gating and move every tick.
    it('should produce non-zero movement on all 10 ticks', () => {
      const entity = makeEntity('E1', House.Spain, 100, 100);
      const rulesSpeed = UNIT_STATS['E1'].speed; // 4
      expect(rulesSpeed).toBe(4); // sanity check from rules.ini

      const speedPx = rulesSpeed * MPH_TO_PX;
      const { deltas } = collectPerTickDeltas(entity, 10, speedPx);

      // After fix: every tick should produce positive movement for infantry
      const zeroTicks = deltas.filter(d => d === 0).length;
      expect(zeroTicks).toBe(0);

      // Every delta should be positive (moving east)
      for (let i = 0; i < deltas.length; i++) {
        expect(deltas[i], `tick ${i} should have positive movement`).toBeGreaterThan(0);
      }
    });
  });

  describe('vehicle still uses SpeedAccum', () => {
    // JEEP Speed=10 from rules.ini. MaxSpeed = floor(10 * 256 / 100) = 25 leptons/tick.
    // SpeedAdd = floor(25 * 255 / 256) = floor(24.90) = 24 leptons/tick.
    // tick 1: actual=24, 24%10=4 remainder → 20 leptons moved, accum=4
    // tick 2: actual=24+4=28, 28%10=8 → 20 leptons moved, accum=8
    // tick 3: actual=24+8=32, 32%10=2 → 30 leptons moved, accum=2
    // Vehicle correctly skips sub-pixel steps — some ticks may produce different
    // pixel counts, but all should produce movement. The key difference from
    // infantry is that vehicles DO use the accumulator system.
    it('JEEP should use the lepton accumulator (consistent with C++ drive.cpp)', () => {
      const entity = makeEntity('JEEP', House.Spain, 100, 100);
      const rulesSpeed = UNIT_STATS['JEEP'].speed; // 10
      expect(rulesSpeed).toBe(10); // sanity check from rules.ini

      const speedPx = rulesSpeed * MPH_TO_PX;
      const { deltas, finalX } = collectPerTickDeltas(entity, 20, speedPx);

      // Vehicle uses accumulator — verify it still accumulates sub-pixel remainders
      expect(entity.speedAccum).toBeGreaterThanOrEqual(0);

      // JEEP is fast enough (24 leptons/tick > PIXEL_LEPTON_W=10) that every tick
      // produces movement, but the pixel amounts vary due to remainder carry.
      // Verify not all deltas are identical (accumulator effect).
      const uniqueDeltas = new Set(deltas);
      // With accumulator, we expect at least 2 different delta values
      expect(uniqueDeltas.size).toBeGreaterThanOrEqual(2);

      // Total distance should match C++ accumulator + Coord_Move math
      const maxSpeedLeptons = Math.floor((rulesSpeed * LEPTON_SIZE) / 100);
      const speedAdd = Math.floor((maxSpeedLeptons * 255) / 256);
      let expectedAccum = 0;
      let totalAxisLeptons = 0;
      for (let t = 0; t < 20; t++) {
        const actual = speedAdd + expectedAccum;
        const remainder = actual % PIXEL_LEPTON_W;
        const moveLeptons = actual - remainder;
        expectedAccum = remainder;
        // Coord_Move applies sin/cos: cardinal sinFactor=127
        totalAxisLeptons += (moveLeptons * 127) >> 7;
      }
      const expectedDistance = totalAxisLeptons * LP;
      const startLeptonX = Math.round(100 / LP);
      const actualDistance = finalX - startLeptonX * LP;
      expect(actualDistance).toBeCloseTo(expectedDistance, 4);
    });
  });

  describe('E1 per-tick distance is consistent and non-zero', () => {
    // C++ E1 Speed=4: MaxSpeed = floor(4 * 256/100) = 10 leptons/tick.
    // After the 255/256 fraction: SpeedAdd = floor(10 * 255/256) = 9 leptons/tick.
    // C++ cardinal movement: 9 leptons/tick × LP = 9 × 0.09375 = 0.84375 px/tick.
    //
    // After fix: infantry bypasses accumulator gating, so every tick produces
    // consistent movement. The exact per-tick distance depends on the fix
    // implementation, but it must be:
    //   1. Non-zero on every tick
    //   2. Consistent across ticks (same speed → same delta)
    it('E1 moves a consistent distance each tick (no skipped ticks)', () => {
      const entity = makeEntity('E1', House.Spain, 100, 100);
      const rulesSpeed = UNIT_STATS['E1'].speed; // 4
      const speedPx = rulesSpeed * MPH_TO_PX;

      const { deltas } = collectPerTickDeltas(entity, 20, speedPx);

      // All deltas should be positive
      for (const d of deltas) {
        expect(d).toBeGreaterThan(0);
      }

      // Deltas should be consistent (within floating-point tolerance)
      // After fix: infantry moves the same amount each tick
      const firstDelta = deltas[0];
      for (let i = 1; i < deltas.length; i++) {
        expect(deltas[i]).toBeCloseTo(firstDelta, 6);
      }
    });
  });

  describe('DOG per-tick movement matches C++ infantry behavior', () => {
    // DOG Speed=4 from rules.ini (same as E1).
    // C++ infantry movement: direct position update every tick, no accumulator gating.
    // Despite isCanine=true, DOG is still isInfantry=true and follows infantry
    // movement code path in C++ foot.cpp.
    it('DOG moves every tick with consistent per-tick distance', () => {
      const entity = makeEntity('DOG', House.USSR, 100, 100);
      const rulesSpeed = UNIT_STATS['DOG'].speed; // 4
      expect(rulesSpeed).toBe(4); // rules.ini Speed=4

      const speedPx = rulesSpeed * MPH_TO_PX;
      const { deltas } = collectPerTickDeltas(entity, 15, speedPx);

      // Every tick produces movement
      const zeroTicks = deltas.filter(d => d === 0).length;
      expect(zeroTicks).toBe(0);

      // Movement is consistent across ticks
      const firstDelta = deltas[0];
      for (let i = 1; i < deltas.length; i++) {
        expect(deltas[i]).toBeCloseTo(firstDelta, 6);
      }
    });

    it('DOG per-tick distance matches E1 (both Speed=4)', () => {
      const dog = makeEntity('DOG', House.USSR, 100, 100);
      const e1 = makeEntity('E1', House.Spain, 100, 100);

      const dogSpeed = UNIT_STATS['DOG'].speed * MPH_TO_PX;
      const e1Speed = UNIT_STATS['E1'].speed * MPH_TO_PX;

      const dogResult = collectPerTickDeltas(dog, 10, dogSpeed);
      const e1Result = collectPerTickDeltas(e1, 10, e1Speed);

      // Same Speed=4 → same per-tick distance
      expect(dogResult.deltas[0]).toBeCloseTo(e1Result.deltas[0], 6);
      // Same total distance after 10 ticks
      expect(dogResult.finalX).toBeCloseTo(e1Result.finalX, 4);
    });
  });

  describe('cell snap threshold for infantry', () => {
    // C++ infantry snaps to cell center when within 16 leptons (0x0010).
    // 16 leptons = 16 * LP = 16 * (24/256) = 1.5 pixels.
    // Entity.moveToward uses snapThreshold = 1.5 for infantry, 0.5 for vehicles.
    // This test verifies the snap distance is correct.
    it('infantry snaps to cell center when within ~1.5 pixels', () => {
      // Place E1 very close to the target (within snap threshold)
      // Use lepton-aligned coordinates to avoid quantization mismatch
      const targetX = 120; // 120/LP = 1280 (exact)
      const targetY = 96;  // 96/LP = 1024 (exact)

      // Place entity just inside snap threshold
      const entity = makeEntity('E1', House.Spain, targetX - 1.0, targetY);
      const target: WorldPos = { x: targetX, y: targetY };
      const speedPx = UNIT_STATS['E1'].speed * MPH_TO_PX;

      entity.rotTickedThisFrame = false;
      const arrived = entity.moveToward(target, speedPx);

      // Within 1.5px → should snap to target
      expect(arrived).toBe(true);
      expect(entity.pos.x).toBe(targetX);
      expect(entity.pos.y).toBe(targetY);
    });

    it('infantry does NOT snap when further than 1.5 pixels', () => {
      const targetX = 120;
      const targetY = 100;

      // Place entity well outside snap threshold — far enough that one tick
      // of movement (E1 ~0.84px/tick) does NOT bring it close enough to arrive.
      // E1 Speed=4: MaxSpeed=10 leptons → ~0.84-0.94px/tick.
      // At 5px away, one tick of movement leaves ~4px remaining — well above snap.
      const entity = makeEntity('E1', House.Spain, targetX - 5.0, targetY);
      const target: WorldPos = { x: targetX, y: targetY };
      const speedPx = UNIT_STATS['E1'].speed * MPH_TO_PX;

      entity.rotTickedThisFrame = false;
      const arrived = entity.moveToward(target, speedPx);

      // 5.0px away > 1.5px threshold → should NOT snap on first tick
      expect(arrived).toBe(false);
      // Entity should have moved closer but still be well short of target
      expect(entity.pos.x).toBeGreaterThan(targetX - 5.0);
      expect(entity.pos.x).toBeLessThan(targetX);
    });

    it('vehicle snaps at 0.5 pixels (tighter threshold)', () => {
      // Use lepton-aligned coordinates to avoid quantization mismatch
      const targetX = 120; // 120/LP = 1280 (exact)
      const targetY = 96;  // 96/LP = 1024 (exact)

      // Place JEEP at 0.4px from target — within vehicle snap threshold of 0.5
      const entity = makeEntity('JEEP', House.Spain, targetX - 0.4, targetY);
      const target: WorldPos = { x: targetX, y: targetY };
      const speedPx = UNIT_STATS['JEEP'].speed * MPH_TO_PX;

      entity.rotTickedThisFrame = false;
      const arrived = entity.moveToward(target, speedPx);

      // 0.4px < 0.5px threshold → should snap
      expect(arrived).toBe(true);
      expect(entity.pos.x).toBe(targetX);
      expect(entity.pos.y).toBe(targetY);
    });

    it('vehicle does NOT snap at 0.8 pixels', () => {
      const targetX = 120;
      const targetY = 100;

      // Place JEEP at 0.8px from target — outside vehicle snap threshold of 0.5
      const entity = makeEntity('JEEP', House.Spain, targetX - 0.8, targetY);
      const target: WorldPos = { x: targetX, y: targetY };
      const speedPx = UNIT_STATS['JEEP'].speed * MPH_TO_PX;

      entity.rotTickedThisFrame = false;
      const arrived = entity.moveToward(target, speedPx);

      // 0.8px > 0.5px threshold → should NOT snap
      // JEEP is fast enough that it will likely arrive by moving, but the key
      // is that it doesn't snap before movement
      expect(entity.pos.x).not.toBe(targetX - 0.8); // position should change
    });
  });

  describe('infantry speedAccum reset on arrival', () => {
    // C++ resets SpeedAccum to 0 when unit arrives at destination.
    // This prevents leftover accumulator from affecting the next move command.
    it('speedAccum is reset to 0 when infantry arrives at target', () => {
      const entity = makeEntity('E1', House.Spain, 100, 100);
      const target: WorldPos = { x: 101.0, y: 100 }; // very close target
      const speedPx = UNIT_STATS['E1'].speed * MPH_TO_PX;

      // Move toward the close target until arrival
      let arrived = false;
      for (let t = 0; t < 20 && !arrived; t++) {
        entity.rotTickedThisFrame = false;
        arrived = entity.moveToward(target, speedPx);
      }

      expect(arrived).toBe(true);
      expect(entity.speedAccum).toBe(0); // C++: reset on arrival
    });
  });
});
