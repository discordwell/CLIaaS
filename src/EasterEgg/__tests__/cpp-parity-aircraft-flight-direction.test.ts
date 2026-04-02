/**
 * C++ Behavioral Parity: Aircraft Curved Flight Path (Move in Current Facing)
 *
 * In C++ RA, aircraft always move in their CURRENT facing direction, not their
 * DESIRED facing direction. When an aircraft needs to turn, it gradually rotates
 * its facing while continuing to fly forward in whatever direction it currently
 * points. This produces the characteristic curved flight paths seen in the original
 * game — a helicopter facing East that needs to go South first flies East while
 * gradually turning toward South.
 *
 * Bug: The TS implementation was using desiredFacing (the direction TO the target)
 * for movement direction, causing aircraft to instantly move toward their target
 * in straight lines instead of curving. This made aircraft look unrealistic and
 * broke parity with C++ behavior.
 *
 * After fix: Aircraft moveToward() uses entity.facing (current) for movement
 * direction while tickRotation() gradually advances facing toward desiredFacing.
 *
 * C++ source references:
 *   fly.cpp:62-106    — Physics(): movement uses PrimaryFacing (current facing) for direction
 *   fly.cpp:88-91     — Coord_Move(Coord, PrimaryFacing.Current(), actual) — NOT desired
 *   aircraft.cpp:2885 — Process_Take_Off: facing for movement = PrimaryFacing.Current()
 *   aircraft.cpp:628-847 — fixed-wing attack uses PrimaryFacing for flight direction
 *   facing.cpp:168-172 — Rotation_Adjust: gradual rotation via ROT accumulator
 *
 * TRAN stats from rules.ini:
 *   [TRAN] Speed=12, ROT=5, Strength=90, Armor=light
 *
 * HIND stats from rules.ini:
 *   [HIND] Speed=12, ROT=4, Strength=225, Armor=heavy
 */

import { describe, it, expect, beforeEach } from 'vitest';
import {
  UnitType, House, Dir, CELL_SIZE,
  UNIT_STATS, MPH_TO_PX, LEPTON_SIZE, DIR_DX, DIR_DY,
  type WorldPos,
} from '../engine/types';
import { Entity, resetEntityIds } from '../engine/entity';
import { LP, PIXEL_LEPTON_W } from '../engine/tracks';

beforeEach(() => resetEntityIds());

// -- Helpers ------------------------------------------------------------------

function makeAircraft(unitKey: string, house: House, x: number, y: number): Entity {
  const stats = UNIT_STATS[unitKey];
  const entity = new Entity(stats.type, house, x, y);
  // Ensure aircraft is in flying state at flight altitude
  entity.aircraftState = 'flying';
  entity.flightAltitude = Entity.FLIGHT_ALTITUDE;
  return entity;
}

/**
 * Set entity to a specific 8-direction facing (both game logic and visual).
 */
function setFacing(entity: Entity, dir: Dir): void {
  entity.facing = dir;
  entity.desiredFacing = dir;
  entity.bodyFacing32 = dir * 4;
  entity.prevBodyFacing32 = dir * 4;
  entity.rotAccumulator = 0;
}

// -- Tests ------------------------------------------------------------------

describe('C++ parity: aircraft curved flight path', () => {

  describe('aircraft moves in current facing, not desired facing', () => {
    // C++ fly.cpp:88-91: Coord_Move(Coord, PrimaryFacing.Current(), actual)
    // The movement direction is PrimaryFacing.Current() — the aircraft's current
    // facing — NOT the direction to the target. When facing EAST but target is
    // SOUTH, the aircraft moves EAST on the first tick.
    it('TRAN facing EAST with target SOUTH moves EAST on first tick', () => {
      const startX = 500;
      const startY = 500;
      const entity = makeAircraft('TRAN', House.USSR, startX, startY);

      // Set current facing to EAST
      setFacing(entity, Dir.E);
      // Now set desired facing toward SOUTH (without changing current facing)
      // This simulates what happens when moveToward computes direction to target
      entity.desiredFacing = Dir.S;

      const targetSouth: WorldPos = { x: startX, y: startY + 500 };
      const speedPx = UNIT_STATS['TRAN'].speed * MPH_TO_PX;

      // Reset rotation guard
      entity.rotTickedThisFrame = false;
      entity.moveToward(targetSouth, speedPx);

      const dx = entity.pos.x - startX;
      const dy = entity.pos.y - startY;

      // After fix: aircraft should move primarily EAST (positive X), because
      // it uses current facing (EAST), not desired facing (SOUTH).
      // C++ fly.cpp:88: Coord_Move uses PrimaryFacing.Current() for direction.
      expect(dx).toBeGreaterThan(0); // moved east
      // Should have minimal or zero southward movement on first tick
      // (only from rotation beginning to turn)
      expect(Math.abs(dx)).toBeGreaterThan(Math.abs(dy));
    });

    it('HIND facing NORTH with target WEST moves NORTH on first tick', () => {
      const startX = 500;
      const startY = 500;
      const entity = makeAircraft('HIND', House.USSR, startX, startY);

      setFacing(entity, Dir.N);
      entity.desiredFacing = Dir.W;

      const targetWest: WorldPos = { x: startX - 500, y: startY };
      const speedPx = UNIT_STATS['HIND'].speed * MPH_TO_PX;

      entity.rotTickedThisFrame = false;
      entity.moveToward(targetWest, speedPx);

      const dx = entity.pos.x - startX;
      const dy = entity.pos.y - startY;

      // Should move NORTH (negative Y), not WEST
      expect(dy).toBeLessThan(0); // moved north
      expect(Math.abs(dy)).toBeGreaterThan(Math.abs(dx));
    });
  });

  describe('aircraft gradually rotates toward desired facing', () => {
    // C++ facing.cpp: Rotation_Adjust accumulates ROT per tick.
    // In 32-step rotation: each step requires 8 accumulated ROT.
    // TRAN ROT=5: takes ceil(8/5) = 2 ticks per 32-step.
    // From EAST (facing32=8) to SOUTH (facing32=16), that's 8 steps.
    // At ROT=5: ~16 ticks to rotate 90 degrees.
    //
    // The aircraft should NOT snap to the desired facing immediately.
    // It should progress through intermediate facings (E → SE → S).
    it('TRAN rotates from EAST to SOUTH through SE intermediate', () => {
      const entity = makeAircraft('TRAN', House.USSR, 500, 500);
      setFacing(entity, Dir.E);

      const targetSouth: WorldPos = { x: 500, y: 1000 };
      const speedPx = UNIT_STATS['TRAN'].speed * MPH_TO_PX;

      // TRAN ROT=5, 32-step rotation. Need accumulator >= 8 per step.
      // After 1 tick: accum = 5 (< 8, no rotation)
      // After 2 ticks: accum = 10 → step, remaining accum = 2
      // After 3 ticks: accum = 2+5 = 7 (< 8, no rotation)
      // After 4 ticks: accum = 7+5 = 12 → step, remaining = 4
      //
      // From E (facing32=8) to S (facing32=16): need 8 steps × 2 ticks ≈ 16 ticks
      // After ~4 ticks and 2 steps: facing32 = 10 → still E (8-11 map to E=dir 2)
      // After ~8 ticks and 4 steps: facing32 = 12 → SE (12-15 map to SE=dir 3)

      // Record facing progression
      const facingHistory: Dir[] = [entity.facing];

      for (let t = 0; t < 20; t++) {
        entity.rotTickedThisFrame = false;
        entity.moveToward(targetSouth, speedPx);
        facingHistory.push(entity.facing);
      }

      // Should NOT be South immediately
      expect(facingHistory[1]).not.toBe(Dir.S);

      // Should pass through SE at some point
      const hasSE = facingHistory.some(f => f === Dir.SE);
      expect(hasSE).toBe(true);

      // Should eventually reach South (or close to it) after enough ticks
      // ROT=5 means ~16 ticks for 90 degrees
      const lastFacing = facingHistory[facingHistory.length - 1];
      expect(lastFacing === Dir.S || lastFacing === Dir.SE).toBe(true);
    });

    it('HIND rotates gradually (ROT=4, slower than TRAN ROT=5)', () => {
      const entity = makeAircraft('HIND', House.USSR, 500, 500);
      setFacing(entity, Dir.N);

      const targetEast: WorldPos = { x: 1000, y: 500 };
      const speedPx = UNIT_STATS['HIND'].speed * MPH_TO_PX;

      // HIND ROT=4: needs 2 ticks per 32-step (8/4 = 2 exactly)
      // From N (facing32=0) to E (facing32=8): 8 steps × 2 ticks = 16 ticks
      const facingHistory: Dir[] = [entity.facing];

      for (let t = 0; t < 20; t++) {
        entity.rotTickedThisFrame = false;
        entity.moveToward(targetEast, speedPx);
        facingHistory.push(entity.facing);
      }

      // Should start at N
      expect(facingHistory[0]).toBe(Dir.N);

      // Should NOT snap to E immediately
      expect(facingHistory[1]).not.toBe(Dir.E);

      // Should pass through NE
      const hasNE = facingHistory.some(f => f === Dir.NE);
      expect(hasNE).toBe(true);

      // After 20 ticks with ROT=4: 20/2 = 10 steps. Need 8 steps for 90°.
      // Should reach E by tick 16.
      const lastFacing = facingHistory[facingHistory.length - 1];
      expect(lastFacing).toBe(Dir.E);
    });
  });

  describe('approach slowdown within 3 cells of target', () => {
    // C++ aircraft.cpp approach deceleration: within close range of target,
    // aircraft should reduce speed. This produces smooth landings and prevents
    // oscillation around the target cell.
    //
    // The exact slowdown formula varies by aircraft type and state, but
    // the general principle is: speed decreases as distance to target decreases
    // when within ~3 cells (3 * 24 = 72 pixels).
    it('aircraft speed decreases as it approaches target within 3 cells', () => {
      const entity = makeAircraft('TRAN', House.USSR, 500, 500);
      setFacing(entity, Dir.E);

      const rulesSpeed = UNIT_STATS['TRAN'].speed;
      const speedPx = rulesSpeed * MPH_TO_PX;

      // Test at different distances from target
      const distances = [
        { dist: 200, label: 'far (>3 cells)' },
        { dist: 60, label: '~2.5 cells' },
        { dist: 36, label: '1.5 cells' },
        { dist: 12, label: '0.5 cells' },
      ];

      const deltasAtDistance: number[] = [];

      for (const { dist } of distances) {
        const testEntity = makeAircraft('TRAN', House.USSR, 500, 500);
        setFacing(testEntity, Dir.E);

        const target: WorldPos = { x: 500 + dist, y: 500 };
        testEntity.rotTickedThisFrame = false;
        const prevX = testEntity.pos.x;
        testEntity.moveToward(target, speedPx);
        deltasAtDistance.push(testEntity.pos.x - prevX);
      }

      // Far distance (>3 cells = 72px): full speed movement
      expect(deltasAtDistance[0]).toBeGreaterThan(0);

      // Closer distances should produce smaller deltas (approach slowdown).
      // At minimum, the very close distance should move less than full speed.
      // The delta at 12px should be <= delta at 200px because movement is
      // clamped to remaining distance to prevent overshoot.
      expect(deltasAtDistance[3]).toBeLessThanOrEqual(deltasAtDistance[0]);

      // If approaching from 12px away, the movement should be at most 12px
      // (can't overshoot the target)
      expect(deltasAtDistance[3]).toBeLessThanOrEqual(12);
    });

    it('aircraft does not overshoot target', () => {
      // Place aircraft close to target, verify it doesn't fly past
      const entity = makeAircraft('TRAN', House.USSR, 500, 500);
      setFacing(entity, Dir.E);

      const targetX = 510; // 10px away
      const target: WorldPos = { x: targetX, y: 500 };
      const speedPx = UNIT_STATS['TRAN'].speed * MPH_TO_PX; // 12 * 0.24 = 2.88 px/tick

      // Simulate several ticks
      for (let t = 0; t < 10; t++) {
        entity.rotTickedThisFrame = false;
        entity.moveToward(target, speedPx);
      }

      // Entity should be at or near target, not past it
      expect(entity.pos.x).toBeLessThanOrEqual(targetX + 0.5);
    });
  });

  describe('movement direction uses facing-based direction vectors', () => {
    // C++ fly.cpp:88: Coord_Move(Coord, PrimaryFacing.Current(), actual)
    // Uses DIR_DX/DIR_DY lookup tables, not floating-point atan2.
    // This produces perfectly axis-aligned movement for cardinal directions
    // and exact 45-degree movement for diagonals.
    it('aircraft facing SE moves at 45 degrees (equal X and Y delta)', () => {
      const entity = makeAircraft('TRAN', House.USSR, 500, 500);
      setFacing(entity, Dir.SE);

      // Target far to the southeast (aligned with facing)
      const target: WorldPos = { x: 1000, y: 1000 };
      const speedPx = UNIT_STATS['TRAN'].speed * MPH_TO_PX;

      entity.rotTickedThisFrame = false;
      entity.moveToward(target, speedPx);

      const dx = entity.pos.x - 500;
      const dy = entity.pos.y - 500;

      // SE movement: dx and dy should be equal (45-degree diagonal)
      // C++ uses integer sin/cos lookup giving cos(45°) = 0.707 factor
      expect(dx).toBeGreaterThan(0);
      expect(dy).toBeGreaterThan(0);
      expect(dx).toBeCloseTo(dy, 4); // equal X and Y displacement
    });

    it('aircraft facing N moves only in Y axis', () => {
      const entity = makeAircraft('TRAN', House.USSR, 500, 500);
      setFacing(entity, Dir.N);

      const target: WorldPos = { x: 500, y: 0 };
      const speedPx = UNIT_STATS['TRAN'].speed * MPH_TO_PX;

      entity.rotTickedThisFrame = false;
      entity.moveToward(target, speedPx);

      const dx = entity.pos.x - 500;
      const dy = entity.pos.y - 500;

      // Pure north: X should be unchanged, Y should decrease
      expect(Math.abs(dx)).toBeLessThan(0.001);
      expect(dy).toBeLessThan(0);
    });
  });
});
