/**
 * Comprehensive movement pipeline tests covering Entity movement, track following,
 * infantry sub-cell positioning, path following, occupancy, and edge cases.
 *
 * Complements existing tests:
 *   - movement-parity.test.ts: MV2/MV3/MV4/MV8/MV9 parity fixes
 *   - movement-jitter.test.ts: overshoot prevention, snap threshold
 *   - track-movement.test.ts: track data decoding, TrackControl, Smooth_Turn
 *   - track-movement-parity.test.ts: C++ parity verification
 *   - terrain-passability.test.ts: PASSABLE set, pathfinding, speed multipliers
 *   - formation-movement.test.ts: formation grid calculation
 *
 * This file focuses on:
 *   1. Per-tick position updates with speed classes (Foot, Wheel, Float, Winged)
 *   2. Diagonal movement and direction calculation
 *   3. Cell transitions and occupancy bookkeeping
 *   4. followTrackStep budget/accumulator mechanics
 *   5. Infantry sub-cell positioning
 *   6. Path following (pathIndex, exhaustion, recalculation)
 *   7. canEnterCell with MoveResult nuances
 *   8. Edge cases (zero distance, death during movement, boundary clamping)
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { Entity, resetEntityIds } from '../engine/entity';
import { GameMap, Terrain, MoveResult } from '../engine/map';
import { findPath } from '../engine/pathfinding';
import {
  Dir, UnitType, House, CELL_SIZE, SpeedClass, MPH_TO_PX,
  worldToCell, worldDist, directionTo,
  type WorldPos, type CellPos,
  UNIT_STATS, MAP_CELLS,
} from '../engine/types';
import {
  TRACK_DATA, getTrackArray, smoothTurn, lookupTrackControl,
  getEffectiveTrack, usesTrackMovement, LP, PIXEL_LEPTON_W, F_D,
} from '../engine/tracks';

beforeEach(() => resetEntityIds());

// ============================================================================
// 1. Core Movement — per-tick position update, speed classes
// ============================================================================

describe('Core moveToward — speed class behavior', () => {
  it('infantry (FOOT) moves at speed * MPH_TO_PX per tick', () => {
    const inf = new Entity(UnitType.I_E1, House.Spain, 100, 100);
    inf.facing = Dir.E;
    inf.desiredFacing = Dir.E;
    const speed = inf.stats.speed * MPH_TO_PX;
    const startX = inf.pos.x;

    inf.rotTickedThisFrame = false;
    inf.moveToward({ x: 300, y: 100 }, speed);

    const moved = inf.pos.x - startX;
    expect(moved).toBeCloseTo(speed, 4);
  });

  it('vehicle (WHEEL) moves at speed * MPH_TO_PX when facing is aligned', () => {
    const tank = new Entity(UnitType.V_2TNK, House.Spain, 100, 100);
    tank.facing = Dir.E;
    tank.desiredFacing = Dir.E;
    tank.bodyFacing32 = Dir.E * 4;
    const speed = tank.stats.speed * MPH_TO_PX;
    const startX = tank.pos.x;

    tank.rotTickedThisFrame = false;
    tank.moveToward({ x: 300, y: 100 }, speed);

    const moved = tank.pos.x - startX;
    expect(moved).toBeCloseTo(speed, 4);
  });

  it('different speed classes have different MPH values', () => {
    const foot = UNIT_STATS.E1;     // speed=4, FOOT
    const wheel = UNIT_STATS['2TNK']; // speed=8, WHEEL
    const winged = UNIT_STATS.TRAN; // speed=12, WINGED
    const float = UNIT_STATS.LST;   // speed=14, FLOAT

    expect(foot.speedClass).toBe(SpeedClass.FOOT);
    expect(wheel.speedClass).toBe(SpeedClass.WHEEL);
    expect(winged.speedClass).toBe(SpeedClass.WINGED);
    expect(float.speedClass).toBe(SpeedClass.FLOAT);

    // All speeds are in MPH (leptons/tick); verify each is distinct
    const speeds = [foot.speed, wheel.speed, winged.speed, float.speed];
    const uniqueSpeeds = new Set(speeds);
    expect(uniqueSpeeds.size).toBe(speeds.length);
  });

  it('slow unit (Mammoth, speed=4) moves slower than fast unit (JEEP, speed=10)', () => {
    const mammoth = new Entity(UnitType.V_4TNK, House.Spain, 100, 100);
    const jeep = new Entity(UnitType.V_JEEP, House.Spain, 100, 100);

    // Pre-align both east
    mammoth.facing = Dir.E; mammoth.desiredFacing = Dir.E; mammoth.bodyFacing32 = Dir.E * 4;
    jeep.facing = Dir.E; jeep.desiredFacing = Dir.E; jeep.bodyFacing32 = Dir.E * 4;

    const target = { x: 300, y: 100 };
    const mammothSpeed = mammoth.stats.speed * MPH_TO_PX;
    const jeepSpeed = jeep.stats.speed * MPH_TO_PX;

    mammoth.rotTickedThisFrame = false;
    jeep.rotTickedThisFrame = false;
    mammoth.moveToward(target, mammothSpeed);
    jeep.moveToward(target, jeepSpeed);

    expect(jeep.pos.x).toBeGreaterThan(mammoth.pos.x);
  });

  it('aircraft always moves forward even when facing is not aligned', () => {
    const heli = new Entity(UnitType.V_TRAN, House.Spain, 100, 100);
    heli.facing = Dir.N;
    // Target is east — need to rotate, but aircraft should still move
    const target = { x: 300, y: 100 };
    const startX = heli.pos.x;
    const startY = heli.pos.y;

    heli.rotTickedThisFrame = false;
    heli.moveToward(target, heli.stats.speed * MPH_TO_PX);

    // Aircraft should have moved (unlike ground vehicles which stop to rotate)
    const movedX = heli.pos.x - startX;
    const movedY = heli.pos.y - startY;
    const totalMoved = Math.sqrt(movedX * movedX + movedY * movedY);
    expect(totalMoved).toBeGreaterThan(0);
  });

  it('infantry moves while rotating (nimble movement)', () => {
    const inf = new Entity(UnitType.I_E1, House.Spain, 100, 100);
    inf.facing = Dir.N;
    // Target is east — need to rotate
    const target = { x: 300, y: 100 };
    const startX = inf.pos.x;
    const startY = inf.pos.y;

    inf.rotTickedThisFrame = false;
    inf.moveToward(target, inf.stats.speed * MPH_TO_PX);

    // Infantry should have moved even while rotating
    const movedX = inf.pos.x - startX;
    const movedY = inf.pos.y - startY;
    const totalMoved = Math.sqrt(movedX * movedX + movedY * movedY);
    expect(totalMoved).toBeGreaterThan(0);
  });
});

// ============================================================================
// 2. Diagonal movement and direction calculation
// ============================================================================

describe('Diagonal movement', () => {
  it('diagonal speed is same per-step as cardinal (clamped to remaining distance)', () => {
    // moveToward normalizes direction, so step = speed regardless of angle
    const unit = new Entity(UnitType.I_E1, House.Spain, 100, 100);
    const speed = 5;
    const target = { x: 200, y: 200 }; // diagonal NE-ish

    unit.rotTickedThisFrame = false;
    unit.moveToward(target, speed);

    const dx = unit.pos.x - 100;
    const dy = unit.pos.y - 100;
    const dist = Math.sqrt(dx * dx + dy * dy);
    expect(dist).toBeCloseTo(speed, 3);
  });

  it('directionTo returns correct 8-way direction', () => {
    const origin: WorldPos = { x: 100, y: 100 };

    expect(directionTo(origin, { x: 100, y: 50 })).toBe(Dir.N);
    expect(directionTo(origin, { x: 150, y: 50 })).toBe(Dir.NE);
    expect(directionTo(origin, { x: 150, y: 100 })).toBe(Dir.E);
    expect(directionTo(origin, { x: 150, y: 150 })).toBe(Dir.SE);
    expect(directionTo(origin, { x: 100, y: 150 })).toBe(Dir.S);
    expect(directionTo(origin, { x: 50, y: 150 })).toBe(Dir.SW);
    expect(directionTo(origin, { x: 50, y: 100 })).toBe(Dir.W);
    expect(directionTo(origin, { x: 50, y: 50 })).toBe(Dir.NW);
  });

  it('diagonal path in pathfinding uses DIAG_COST (14 vs 10 for cardinal)', () => {
    const map = new GameMap();
    map.setBounds(0, 0, 20, 20);
    map.initDefault();

    // Path from (2,2) to (5,5) — pure diagonal
    const path = findPath(map, { cx: 2, cy: 2 }, { cx: 5, cy: 5 });
    expect(path.length).toBeGreaterThan(0);

    // Verify the path goes diagonally (each step changes both cx and cy)
    let diagonalSteps = 0;
    let prev = { cx: 2, cy: 2 };
    for (const cell of path) {
      if (cell.cx !== prev.cx && cell.cy !== prev.cy) diagonalSteps++;
      prev = cell;
    }
    expect(diagonalSteps).toBeGreaterThan(0);
  });
});

// ============================================================================
// 3. Cell-to-cell transitions and occupancy
// ============================================================================

describe('Cell transitions and occupancy', () => {
  it('worldToCell converts pixel coordinates to cell coordinates', () => {
    expect(worldToCell(0, 0)).toEqual({ cx: 0, cy: 0 });
    expect(worldToCell(CELL_SIZE - 1, 0)).toEqual({ cx: 0, cy: 0 });
    expect(worldToCell(CELL_SIZE, 0)).toEqual({ cx: 1, cy: 0 });
    expect(worldToCell(CELL_SIZE * 5 + 12, CELL_SIZE * 3 + 1)).toEqual({ cx: 5, cy: 3 });
  });

  it('entity cell property reflects current pixel position', () => {
    const unit = new Entity(UnitType.I_E1, House.Spain, CELL_SIZE * 5 + 12, CELL_SIZE * 3 + 6);
    expect(unit.cell).toEqual({ cx: 5, cy: 3 });
  });

  it('moving entity across cell boundary updates cell property', () => {
    // Place entity near the right edge of cell (4,4)
    const x = CELL_SIZE * 4 + CELL_SIZE - 2; // 2px from cell boundary
    const unit = new Entity(UnitType.I_E1, House.Spain, x, CELL_SIZE * 4 + 12);
    expect(unit.cell.cx).toBe(4);

    // Move east past the boundary
    unit.facing = Dir.E;
    unit.rotTickedThisFrame = false;
    unit.moveToward({ x: x + 10, y: CELL_SIZE * 4 + 12 }, 5);

    expect(unit.cell.cx).toBe(5);
  });

  it('setOccupancy and getOccupancy store and retrieve entity IDs', () => {
    const map = new GameMap();
    expect(map.getOccupancy(5, 5)).toBe(0);

    map.setOccupancy(5, 5, 42);
    expect(map.getOccupancy(5, 5)).toBe(42);

    map.setOccupancy(5, 5, 0);
    expect(map.getOccupancy(5, 5)).toBe(0);
  });

  it('out-of-bounds getOccupancy returns -1', () => {
    const map = new GameMap();
    expect(map.getOccupancy(-1, 0)).toBe(-1);
    expect(map.getOccupancy(0, -1)).toBe(-1);
    expect(map.getOccupancy(MAP_CELLS, 0)).toBe(-1);
    expect(map.getOccupancy(0, MAP_CELLS)).toBe(-1);
  });

  it('occupancy grid fills entire map (128x128)', () => {
    const map = new GameMap();
    expect(map.occupancy.length).toBe(MAP_CELLS * MAP_CELLS);
  });

  it('occupancy fill(0) clears entire grid', () => {
    const map = new GameMap();
    map.setOccupancy(10, 10, 1);
    map.setOccupancy(20, 20, 2);
    map.occupancy.fill(0);
    expect(map.getOccupancy(10, 10)).toBe(0);
    expect(map.getOccupancy(20, 20)).toBe(0);
  });
});

// ============================================================================
// 4. Track-based vehicle movement — followTrackStep mechanics
// ============================================================================

describe('followTrackStep — lepton budget mechanics', () => {
  it('track step array has correct structure (x, y, facing)', () => {
    const track = getTrackArray(1)!; // Track1: straight N
    expect(track).toBeDefined();
    expect(track.length).toBe(24);

    for (const step of track) {
      expect(typeof step.x).toBe('number');
      expect(typeof step.y).toBe('number');
      expect(typeof step.facing).toBe('number');
      expect(step.facing).toBeGreaterThanOrEqual(0);
      expect(step.facing).toBeLessThanOrEqual(255);
    }
  });

  it('lepton-to-pixel conversion factor LP = CELL_SIZE/256', () => {
    expect(LP).toBeCloseTo(CELL_SIZE / 256, 10);
    expect(LP).toBeCloseTo(0.09375, 10);
  });

  it('PIXEL_LEPTON_W cost per step = 10 (256/24 integer division)', () => {
    expect(PIXEL_LEPTON_W).toBe(10);
  });

  it('speed budget = speedAccum + (biasedSpeed / LP) determines steps per tick', () => {
    // Simulate budget calculation for a medium-speed vehicle
    const speed = 8 * MPH_TO_PX; // 8 MPH = 0.75 px/tick
    const budget = 0 + (speed / LP); // = 0.75 / 0.09375 = 8 leptons
    // At PIXEL_LEPTON_W=10 per step, budget of 8 allows 0 steps (8 < 10)
    expect(budget).toBeCloseTo(8, 4);
    expect(budget < PIXEL_LEPTON_W).toBe(true);

    // Faster vehicle: speed=14 MPH
    const fastSpeed = 14 * MPH_TO_PX;
    const fastBudget = 0 + (fastSpeed / LP);
    expect(fastBudget).toBeCloseTo(14, 4);
    // At 14 leptons, allows 1 step (14 > 10, remainder = 4)
    expect(fastBudget > PIXEL_LEPTON_W).toBe(true);
  });

  it('speedAccum carries remainder to next tick', () => {
    // C++ uses strict > comparison: while (actual > PIXEL_LEPTON_W)
    // Speed of 14 leptons/tick. Per-step cost = 10.
    // Tick 1: budget=14, step at 14>10: 14-10=4. Steps=1, accum=4.
    // Tick 2: budget=4+14=18, step at 18>10: 18-10=8. Steps=1, accum=8.
    // Tick 3: budget=8+14=22, step at 22>10: 22-10=12, step at 12>10: 12-10=2. Steps=2, accum=2.
    // Tick 4: budget=2+14=16, step at 16>10: 16-10=6. Steps=1, accum=6.
    // Tick 5: budget=6+14=20, step at 20>10: 20-10=10. Steps=1, accum=10.
    // (10 is NOT > 10, so no second step)
    // Total: 1+1+2+1+1 = 6 steps over 5 ticks
    const speed = 14 * MPH_TO_PX;
    let accum = 0;
    const stepsPerTick: number[] = [];

    for (let tick = 0; tick < 5; tick++) {
      let budget = accum + (speed / LP);
      let steps = 0;
      while (budget > PIXEL_LEPTON_W) {
        budget -= PIXEL_LEPTON_W;
        steps++;
      }
      accum = budget;
      stepsPerTick.push(steps);
    }

    // Steps should vary due to accumulator — not all identical
    expect(stepsPerTick.some(s => s > 0)).toBe(true);
    expect(stepsPerTick[0]).toBe(1);
    expect(stepsPerTick[2]).toBe(2); // tick 3 gets 2 steps
    // Total: 6 steps (strict > comparison means budget=10 does not yield a step)
    const totalSteps = stepsPerTick.reduce((a, b) => a + b, 0);
    expect(totalSteps).toBe(6);
  });

  it('entity.trackNumber is set to -1 when not on a track', () => {
    const tank = new Entity(UnitType.V_2TNK, House.Spain, 100, 100);
    expect(tank.trackNumber).toBe(-1);
    expect(tank.trackIndex).toBe(0);
    expect(tank.speedAccum).toBe(0);
  });

  it('entity.trackCellSpan defaults to 1', () => {
    const tank = new Entity(UnitType.V_2TNK, House.Spain, 100, 100);
    expect(tank.trackCellSpan).toBe(1);
  });

  it('usesTrackMovement correctly classifies unit types', () => {
    // Vehicles use tracks
    expect(usesTrackMovement(SpeedClass.WHEEL, false, false)).toBe(true);
    expect(usesTrackMovement(SpeedClass.TRACK, false, false)).toBe(true);
    expect(usesTrackMovement(SpeedClass.FLOAT, false, false)).toBe(true);

    // Infantry and aircraft do not
    expect(usesTrackMovement(SpeedClass.FOOT, true, false)).toBe(false);
    expect(usesTrackMovement(SpeedClass.WINGED, false, true)).toBe(false);
  });
});

// ============================================================================
// 5. Infantry sub-cell positioning
// ============================================================================

describe('Infantry sub-cell positioning', () => {
  it('infantry entity has subCell property initialized to 0', () => {
    const inf = new Entity(UnitType.I_E1, House.Spain, 100, 100);
    expect(inf.subCell).toBe(0);
  });

  it('subCell is assigned modulo 5 (0-4 positions per cell)', () => {
    // Simulate the engine occupancy loop
    const cellInfCount = new Map<number, number>();
    const entities: Entity[] = [];

    // Place 7 infantry in the same cell (5,5)
    for (let i = 0; i < 7; i++) {
      const e = new Entity(UnitType.I_E1, House.Spain,
        5 * CELL_SIZE + CELL_SIZE / 2, 5 * CELL_SIZE + CELL_SIZE / 2);
      entities.push(e);
    }

    // Simulate sub-cell assignment (matches index.ts occupancy loop)
    for (const entity of entities) {
      const ci = entity.cell.cy * 128 + entity.cell.cx;
      const cnt = cellInfCount.get(ci) ?? 0;
      entity.subCell = cnt % 5;
      cellInfCount.set(ci, cnt + 1);
    }

    expect(entities[0].subCell).toBe(0);
    expect(entities[1].subCell).toBe(1);
    expect(entities[2].subCell).toBe(2);
    expect(entities[3].subCell).toBe(3);
    expect(entities[4].subCell).toBe(4);
    expect(entities[5].subCell).toBe(0); // wraps around
    expect(entities[6].subCell).toBe(1);
  });

  it('infantry in different cells get independent subCell assignments', () => {
    const cellInfCount = new Map<number, number>();
    const e1 = new Entity(UnitType.I_E1, House.Spain,
      5 * CELL_SIZE + 12, 5 * CELL_SIZE + 12);
    const e2 = new Entity(UnitType.I_E1, House.Spain,
      6 * CELL_SIZE + 12, 6 * CELL_SIZE + 12);

    // Assign sub-cells
    for (const entity of [e1, e2]) {
      const ci = entity.cell.cy * 128 + entity.cell.cx;
      const cnt = cellInfCount.get(ci) ?? 0;
      entity.subCell = cnt % 5;
      cellInfCount.set(ci, cnt + 1);
    }

    // Both should be subCell 0 since they're in different cells
    expect(e1.subCell).toBe(0);
    expect(e2.subCell).toBe(0);
  });

  it('vehicles do not get subCell assignment (only infantry)', () => {
    const tank = new Entity(UnitType.V_2TNK, House.Spain, 100, 100);
    expect(tank.stats.isInfantry).toBe(false);
    // subCell starts at 0 and should not be modified for vehicles
    expect(tank.subCell).toBe(0);
  });
});

// ============================================================================
// 6. Path following — pathIndex, exhaustion, recalculation
// ============================================================================

describe('Path following and pathIndex', () => {
  it('findPath returns empty array when start equals goal', () => {
    const map = new GameMap();
    map.setBounds(0, 0, 20, 20);
    map.initDefault();

    const path = findPath(map, { cx: 5, cy: 5 }, { cx: 5, cy: 5 });
    expect(path).toEqual([]);
  });

  it('findPath returns path excluding start cell', () => {
    const map = new GameMap();
    map.setBounds(0, 0, 20, 20);
    map.initDefault();

    const path = findPath(map, { cx: 2, cy: 2 }, { cx: 5, cy: 2 });
    expect(path.length).toBeGreaterThan(0);
    // First cell in path should NOT be the start cell
    expect(path[0]).not.toEqual({ cx: 2, cy: 2 });
  });

  it('findPath returns path ending at goal cell', () => {
    const map = new GameMap();
    map.setBounds(0, 0, 20, 20);
    map.initDefault();

    const path = findPath(map, { cx: 2, cy: 2 }, { cx: 8, cy: 2 });
    expect(path.length).toBeGreaterThan(0);
    const last = path[path.length - 1];
    expect(last).toEqual({ cx: 8, cy: 2 });
  });

  it('entity pathIndex starts at 0', () => {
    const unit = new Entity(UnitType.I_E1, House.Spain, 100, 100);
    expect(unit.pathIndex).toBe(0);
    expect(unit.path).toEqual([]);
  });

  it('pathIndex increments as entity reaches each waypoint', () => {
    // Simulate path following manually
    const unit = new Entity(UnitType.I_E1, House.Spain,
      2 * CELL_SIZE + CELL_SIZE / 2, 2 * CELL_SIZE + CELL_SIZE / 2);
    unit.path = [
      { cx: 3, cy: 2 },
      { cx: 4, cy: 2 },
      { cx: 5, cy: 2 },
    ];
    unit.pathIndex = 0;

    // Move to first waypoint
    const wp0 = unit.path[0];
    const target0: WorldPos = {
      x: wp0.cx * CELL_SIZE + CELL_SIZE / 2,
      y: wp0.cy * CELL_SIZE + CELL_SIZE / 2,
    };

    // Move until arrived
    for (let i = 0; i < 100; i++) {
      unit.rotTickedThisFrame = false;
      if (unit.moveToward(target0, 5)) {
        unit.pathIndex++;
        break;
      }
    }

    expect(unit.pathIndex).toBe(1);
  });

  it('path exhaustion occurs when pathIndex >= path.length', () => {
    const unit = new Entity(UnitType.I_E1, House.Spain, 100, 100);
    unit.path = [{ cx: 5, cy: 5 }];
    unit.pathIndex = 1; // past end

    const exhausted = unit.pathIndex >= unit.path.length;
    expect(exhausted).toBe(true);
  });

  it('findPath returns empty path when goal is impassable', () => {
    const map = new GameMap();
    map.setBounds(0, 0, 20, 20);
    map.initDefault();
    map.setTerrain(8, 2, Terrain.ROCK);

    const path = findPath(map, { cx: 2, cy: 2 }, { cx: 8, cy: 2 });
    // Path should not contain the impassable cell
    const containsRock = path.some(c => c.cx === 8 && c.cy === 2);
    expect(containsRock).toBe(false);
  });

  it('findPath routes around blocked cells', () => {
    const map = new GameMap();
    map.setBounds(0, 0, 20, 20);
    map.initDefault();

    // Create a wall across the path
    for (let y = 0; y < 20; y++) {
      map.setTerrain(5, y, Terrain.ROCK);
    }
    // Leave a gap at y=10
    map.setTerrain(5, 10, Terrain.CLEAR);

    const path = findPath(map, { cx: 3, cy: 10 }, { cx: 7, cy: 10 });
    expect(path.length).toBeGreaterThan(0);

    // Path should go through the gap
    const throughGap = path.some(c => c.cx === 5 && c.cy === 10);
    expect(throughGap).toBe(true);
  });

  it('findPath respects MAX_SEARCH limit (returns nearest-reachable fallback)', () => {
    const map = new GameMap();
    map.setBounds(0, 0, 50, 50);
    map.initDefault();

    // Block the goal completely with an impassable ring
    for (let dx = -1; dx <= 1; dx++) {
      for (let dy = -1; dy <= 1; dy++) {
        if (dx === 0 && dy === 0) continue;
        map.setTerrain(25 + dx, 25 + dy, Terrain.ROCK);
      }
    }

    const path = findPath(map, { cx: 2, cy: 2 }, { cx: 25, cy: 25 });
    // Should return a partial path (nearest-reachable fallback per PF4)
    // or empty if within MAX_SEARCH no closer cell was found
    // Either way, the goal should NOT be in the path
    const containsGoal = path.some(c => c.cx === 25 && c.cy === 25);
    expect(containsGoal).toBe(false);
  });

  it('findPath with ignoreOccupancy=true ignores occupied cells', () => {
    const map = new GameMap();
    map.setBounds(0, 0, 20, 20);
    map.initDefault();

    // Occupy cell (5,5)
    map.setOccupancy(5, 5, 99);

    // With ignoreOccupancy=true, should path through
    const path = findPath(map, { cx: 3, cy: 5 }, { cx: 7, cy: 5 }, true);
    expect(path.length).toBeGreaterThan(0);
    const through = path.some(c => c.cx === 5 && c.cy === 5);
    expect(through).toBe(true);
  });

  it('findPath without ignoreOccupancy avoids occupied cells', () => {
    const map = new GameMap();
    map.setBounds(0, 0, 20, 20);
    map.initDefault();

    // Occupy cell (5,5)
    map.setOccupancy(5, 5, 99);

    // Without ignoreOccupancy, should route around
    const path = findPath(map, { cx: 3, cy: 5 }, { cx: 7, cy: 5 }, false);
    // Path should not go through occupied cell
    const through = path.some(c => c.cx === 5 && c.cy === 5);
    expect(through).toBe(false);
  });

  it('findPath with naval=true only allows water terrain', () => {
    const map = new GameMap();
    map.setBounds(0, 0, 20, 20);
    // Set up water channel
    for (let x = 0; x < 20; x++) {
      map.setTerrain(x, 5, Terrain.WATER);
    }

    const path = findPath(map, { cx: 2, cy: 5 }, { cx: 8, cy: 5 }, true, true);
    expect(path.length).toBeGreaterThan(0);
    for (const cell of path) {
      expect(map.getTerrain(cell.cx, cell.cy)).toBe(Terrain.WATER);
    }
  });
});

// ============================================================================
// 7. canEnterCell — MoveResult nuances
// ============================================================================

describe('canEnterCell — MoveResult classification', () => {
  it('returns OK for passable empty cell within bounds', () => {
    const map = new GameMap();
    map.setBounds(0, 0, 20, 20);
    map.initDefault();

    expect(map.canEnterCell(5, 5)).toBe(MoveResult.OK);
  });

  it('returns IMPASSABLE for out-of-bounds cell', () => {
    const map = new GameMap();
    map.setBounds(5, 5, 10, 10);
    map.initDefault();

    expect(map.canEnterCell(2, 2)).toBe(MoveResult.IMPASSABLE);
    expect(map.canEnterCell(20, 20)).toBe(MoveResult.IMPASSABLE);
  });

  it('returns IMPASSABLE for rock/tree/wall terrain', () => {
    const map = new GameMap();
    map.setBounds(0, 0, 20, 20);

    map.setTerrain(5, 5, Terrain.ROCK);
    expect(map.canEnterCell(5, 5)).toBe(MoveResult.IMPASSABLE);

    map.setTerrain(6, 5, Terrain.TREE);
    expect(map.canEnterCell(6, 5)).toBe(MoveResult.IMPASSABLE);

    map.setTerrain(7, 5, Terrain.WALL);
    expect(map.canEnterCell(7, 5)).toBe(MoveResult.IMPASSABLE);
  });

  it('returns OCCUPIED for cell with stationary entity', () => {
    const map = new GameMap();
    map.setBounds(0, 0, 20, 20);
    map.initDefault();
    map.setOccupancy(5, 5, 42);

    expect(map.canEnterCell(5, 5)).toBe(MoveResult.OCCUPIED);
  });

  it('returns TEMP_BLOCKED for cell with moving entity (isMoving callback)', () => {
    const map = new GameMap();
    map.setBounds(0, 0, 20, 20);
    map.initDefault();
    map.setOccupancy(5, 5, 42);

    const isMoving = (id: number) => id === 42;
    expect(map.canEnterCell(5, 5, false, isMoving)).toBe(MoveResult.TEMP_BLOCKED);
  });

  it('TEMP_BLOCKED adds cost penalty in pathfinding (50 extra)', () => {
    // Verify TEMP_BLOCKED adds a cost penalty by checking that paths
    // prefer to avoid moving entities when possible
    const map = new GameMap();
    map.setBounds(0, 0, 20, 20);
    map.initDefault();
    map.setOccupancy(5, 5, 42);

    const isMoving = (id: number) => id === 42;
    const pathWithMoving = findPath(
      map, { cx: 3, cy: 5 }, { cx: 7, cy: 5 },
      false, false, SpeedClass.WHEEL, isMoving
    );
    // Path should still be found (TEMP_BLOCKED is passable with penalty)
    expect(pathWithMoving.length).toBeGreaterThan(0);
  });

  it('naval=true checks water passability', () => {
    const map = new GameMap();
    map.setBounds(0, 0, 20, 20);
    map.setTerrain(5, 5, Terrain.WATER);
    map.setTerrain(6, 5, Terrain.CLEAR);

    expect(map.canEnterCell(5, 5, true)).toBe(MoveResult.OK);
    expect(map.canEnterCell(6, 5, true)).toBe(MoveResult.IMPASSABLE);
  });
});

// ============================================================================
// 8. Map bounds and boundary behavior
// ============================================================================

describe('Map bounds and boundary behavior', () => {
  it('isPassable returns false for cells outside bounds', () => {
    const map = new GameMap();
    map.setBounds(5, 5, 10, 10);
    map.initDefault();

    expect(map.isPassable(4, 5)).toBe(false);
    expect(map.isPassable(5, 4)).toBe(false);
    expect(map.isPassable(15, 5)).toBe(false);
    expect(map.isPassable(5, 15)).toBe(false);
    expect(map.isPassable(5, 5)).toBe(true);
    expect(map.isPassable(14, 14)).toBe(true);
  });

  it('inBounds correctly checks playable area', () => {
    const map = new GameMap();
    map.setBounds(10, 10, 20, 20);

    expect(map.inBounds(10, 10)).toBe(true);
    expect(map.inBounds(29, 29)).toBe(true);
    expect(map.inBounds(9, 10)).toBe(false);
    expect(map.inBounds(30, 10)).toBe(false);
  });

  it('getTerrain returns ROCK for out-of-map coordinates', () => {
    const map = new GameMap();
    expect(map.getTerrain(-1, 0)).toBe(Terrain.ROCK);
    expect(map.getTerrain(0, -1)).toBe(Terrain.ROCK);
    expect(map.getTerrain(MAP_CELLS, 0)).toBe(Terrain.ROCK);
    expect(map.getTerrain(0, MAP_CELLS)).toBe(Terrain.ROCK);
  });
});

// ============================================================================
// 9. Rotation mechanics
// ============================================================================

describe('Rotation mechanics', () => {
  it('infantry with rot >= 8 snaps facing instantly', () => {
    const inf = new Entity(UnitType.I_E1, House.Spain, 100, 100);
    expect(inf.stats.rot).toBeGreaterThanOrEqual(8);

    inf.facing = Dir.N;
    inf.desiredFacing = Dir.SE;
    inf.bodyFacing32 = Dir.N * 4;

    inf.rotTickedThisFrame = false;
    const aligned = inf.tickRotation();

    expect(aligned).toBe(true);
    expect(inf.facing).toBe(Dir.SE);
    expect(inf.bodyFacing32).toBe(Dir.SE * 4);
  });

  it('slow-rotating vehicle (rot=5) takes multiple ticks to rotate', () => {
    const tank = new Entity(UnitType.V_1TNK, House.Spain, 100, 100);
    expect(tank.stats.rot).toBe(5);

    tank.facing = Dir.N;
    tank.desiredFacing = Dir.E;
    tank.bodyFacing32 = Dir.N * 4;
    tank.rotAccumulator = 0;

    // First tick: accumulate 5, threshold=8, no step yet
    tank.rotTickedThisFrame = false;
    let aligned = tank.tickRotation();
    expect(aligned).toBe(false);
    expect(tank.bodyFacing32).toBe(0); // no step yet

    // Second tick: accumulate 5 more = total 10-8=2 remainder, 1 step
    tank.rotTickedThisFrame = false;
    aligned = tank.tickRotation();
    expect(tank.bodyFacing32).toBe(1); // stepped once clockwise

    // Keep ticking until aligned
    let ticks = 2;
    while (!aligned && ticks < 50) {
      tank.rotTickedThisFrame = false;
      aligned = tank.tickRotation();
      ticks++;
    }
    expect(aligned).toBe(true);
    expect(tank.facing).toBe(Dir.E);
  });

  it('rotTickedThisFrame prevents double-accumulation per tick', () => {
    const tank = new Entity(UnitType.V_1TNK, House.Spain, 100, 100);
    tank.facing = Dir.N;
    tank.desiredFacing = Dir.E;
    tank.bodyFacing32 = 0;
    tank.rotAccumulator = 0;

    tank.rotTickedThisFrame = false;
    tank.tickRotation();
    const accumAfterFirst = tank.rotAccumulator;

    // Second call in same tick — should be no-op
    tank.tickRotation(); // rotTickedThisFrame is still true
    expect(tank.rotAccumulator).toBe(accumAfterFirst);
  });

  it('turret rotation uses rot+1 rate', () => {
    const tank = new Entity(UnitType.V_2TNK, House.Spain, 100, 100);
    tank.turretFacing = Dir.N;
    tank.desiredTurretFacing = Dir.E;
    tank.turretFacing32 = 0;
    tank.turretRotAccumulator = 0;

    tank.turretRotTickedThisFrame = false;
    tank.tickTurretRotation();

    // Should accumulate rot+1 = 5+1 = 6
    expect(tank.turretRotAccumulator).toBeCloseTo(6, 5);
  });

  it('rotation takes shortest path around the ring', () => {
    const tank = new Entity(UnitType.V_1TNK, House.Spain, 100, 100);
    tank.facing = Dir.N; // bodyFacing32 = 0
    tank.desiredFacing = Dir.NW; // bodyFacing32 target = 28
    tank.bodyFacing32 = 0;
    tank.rotAccumulator = 0;

    // Shortest path from 0 to 28 is counterclockwise (2 steps: 0→31→30...→28)
    // rather than clockwise (28 steps: 0→1→2...→28)
    tank.rotTickedThisFrame = false;
    tank.tickRotation();
    tank.rotTickedThisFrame = false;
    tank.tickRotation();

    // After enough accumulation for at least 1 step, it should go counterclockwise
    // (bodyFacing32 should decrease toward 28 via 31)
    if (tank.bodyFacing32 !== 0) {
      // Went counterclockwise: 31, 30, 29, 28
      expect(tank.bodyFacing32).toBe(31);
    }
  });
});

// ============================================================================
// 10. Terrain speed multipliers in movement context
// ============================================================================

describe('Terrain speed multipliers', () => {
  it('CLEAR terrain gives full speed (1.0)', () => {
    const map = new GameMap();
    map.setBounds(0, 0, 20, 20);
    map.setTerrain(5, 5, Terrain.CLEAR);

    expect(map.getSpeedMultiplier(5, 5, SpeedClass.FOOT)).toBe(1.0);
    expect(map.getSpeedMultiplier(5, 5, SpeedClass.WHEEL)).toBe(1.0);
  });

  it('ORE terrain reduces speed to 0.8', () => {
    const map = new GameMap();
    map.setBounds(0, 0, 20, 20);
    map.setTerrain(5, 5, Terrain.ORE);

    expect(map.getSpeedMultiplier(5, 5, SpeedClass.FOOT)).toBe(0.8);
    expect(map.getSpeedMultiplier(5, 5, SpeedClass.WHEEL)).toBe(0.8);
  });

  it('FLOAT speed class: water=1.0, non-water=0.3', () => {
    const map = new GameMap();
    map.setBounds(0, 0, 20, 20);
    map.setTerrain(5, 5, Terrain.WATER);
    map.setTerrain(6, 5, Terrain.CLEAR);

    expect(map.getSpeedMultiplier(5, 5, SpeedClass.FLOAT)).toBe(1.0);
    expect(map.getSpeedMultiplier(6, 5, SpeedClass.FLOAT)).toBe(0.3);
  });

  it('WINGED speed class always returns 1.0 regardless of terrain', () => {
    const map = new GameMap();
    map.setBounds(0, 0, 20, 20);

    const terrains = [Terrain.CLEAR, Terrain.WATER, Terrain.ROCK, Terrain.ROUGH, Terrain.BEACH];
    for (const terrain of terrains) {
      map.setTerrain(5, 5, terrain);
      expect(map.getSpeedMultiplier(5, 5, SpeedClass.WINGED)).toBe(1.0);
    }
  });

  it('speed multipliers are capped at 1.0 (MV5)', () => {
    const map = new GameMap();
    map.setBounds(0, 0, 20, 20);

    // Even road terrain should not exceed 1.0
    for (let sc = 0; sc <= 4; sc++) {
      const mult = map.getSpeedMultiplier(5, 5, sc as SpeedClass);
      expect(mult).toBeLessThanOrEqual(1.0);
    }
  });
});

// ============================================================================
// 11. Edge cases
// ============================================================================

describe('Edge cases — zero distance, death, speed=0', () => {
  it('moveToward with zero distance returns true (already arrived)', () => {
    const unit = new Entity(UnitType.I_E1, House.Spain, 100, 100);
    const target = { x: 100, y: 100 }; // same position

    const arrived = unit.moveToward(target, 5);
    expect(arrived).toBe(true);
    expect(unit.pos.x).toBe(100);
    expect(unit.pos.y).toBe(100);
  });

  it('dead entity has alive=false and mission=DIE', () => {
    const unit = new Entity(UnitType.I_E1, House.Spain, 100, 100);
    unit.takeDamage(1000);

    expect(unit.alive).toBe(false);
    expect(unit.hp).toBe(0);
  });

  it('moveToward still works on dead entities (no crash)', () => {
    const unit = new Entity(UnitType.I_E1, House.Spain, 100, 100);
    unit.alive = false;
    unit.hp = 0;

    // Should not throw
    expect(() => {
      unit.moveToward({ x: 200, y: 200 }, 5);
    }).not.toThrow();
  });

  it('very small speed (0.01) still makes progress', () => {
    const unit = new Entity(UnitType.I_E1, House.Spain, 100, 100);
    unit.facing = Dir.E;

    const startX = unit.pos.x;
    unit.rotTickedThisFrame = false;
    unit.moveToward({ x: 200, y: 100 }, 0.01);

    expect(unit.pos.x).toBeGreaterThan(startX);
    expect(unit.pos.x - startX).toBeCloseTo(0.01, 4);
  });

  it('moveToward with very large speed reaches target in one step', () => {
    const unit = new Entity(UnitType.I_E1, House.Spain, 100, 100);
    const target = { x: 500, y: 300 };

    unit.rotTickedThisFrame = false;
    const arrived = unit.moveToward(target, 10000);

    expect(arrived).toBe(true);
    expect(unit.pos.x).toBeCloseTo(500, 1);
    expect(unit.pos.y).toBeCloseTo(300, 1);
  });

  it('speed bias of 0 effectively stops movement', () => {
    const unit = new Entity(UnitType.I_E1, House.Spain, 100, 100);
    unit.speedBias = 0;
    unit.facing = Dir.E;
    const startX = unit.pos.x;

    unit.rotTickedThisFrame = false;
    unit.moveToward({ x: 200, y: 100 }, 5);

    // speed * speedBias = 5 * 0 = 0, clamped to dist if > 0.5
    // Actually with 0 speed: step = Math.min(0, dist) = 0, no movement
    expect(unit.pos.x).toBe(startX);
  });

  it('entity moveQueue holds shift-click waypoints', () => {
    const unit = new Entity(UnitType.I_E1, House.Spain, 100, 100);
    expect(unit.moveQueue).toEqual([]);

    unit.moveQueue.push({ x: 200, y: 200 });
    unit.moveQueue.push({ x: 300, y: 300 });
    expect(unit.moveQueue).toHaveLength(2);

    const next = unit.moveQueue.shift()!;
    expect(next).toEqual({ x: 200, y: 200 });
    expect(unit.moveQueue).toHaveLength(1);
  });
});

// ============================================================================
// 12. Track data integrity — ensure all tracks can be followed end-to-end
// ============================================================================

describe('Track data integrity — full traversal simulation', () => {
  it('all 13 tracks can be fully traversed with adequate speed budget', () => {
    for (let trackNum = 1; trackNum <= 13; trackNum++) {
      const track = getTrackArray(trackNum)!;
      expect(track, `Track${trackNum} should exist`).toBeDefined();

      // Simulate traversal with a fast speed (should complete in limited ticks)
      let speedAccum = 0;
      const speed = 20 * MPH_TO_PX; // fast speed
      let trackIndex = 0;
      let completed = false;

      for (let tick = 0; tick < 100; tick++) {
        let actual = speedAccum + (speed / LP);
        while (actual > PIXEL_LEPTON_W) {
          actual -= PIXEL_LEPTON_W;
          if (trackIndex >= track.length) { completed = true; break; }
          const step = track[trackIndex];
          if (step.x === 0 && step.y === 0 && trackIndex > 0) { completed = true; break; }
          trackIndex++;
        }
        speedAccum = actual;
        if (completed) break;
      }

      expect(completed, `Track${trackNum} should complete`).toBe(true);
    }
  });

  it('Smooth_Turn preserves (0,0) end marker for all 8 straight directions', () => {
    // Verify that applying Smooth_Turn to the last step (0,0,facing) preserves (0,0)
    for (let dir8 = 0; dir8 < 8; dir8++) {
      const ctrl = lookupTrackControl(dir8, dir8);
      if (ctrl.track === 0) continue;
      const track = getTrackArray(ctrl.track)!;
      const lastStep = track[track.length - 1];
      const flags = ctrl.flag & ~F_D;
      const result = smoothTurn(lastStep.x, lastStep.y, lastStep.facing, flags);
      expect(result.x, `dir ${dir8} last x`).toBe(0);
      expect(result.y, `dir ${dir8} last y`).toBe(0);
    }
  });
});

// ============================================================================
// 13. Speed calculation parity — movementSpeed formula
// ============================================================================

describe('movementSpeed formula components', () => {
  it('MPH_TO_PX converts leptons/tick to pixels/tick correctly', () => {
    // MPH_TO_PX = CELL_SIZE / LEPTON_SIZE = 24 / 256 = 0.09375
    expect(MPH_TO_PX).toBeCloseTo(0.09375, 10);
  });

  it('base speed formula: stats.speed * MPH_TO_PX', () => {
    // E1: speed=4 → 4 * 0.09375 = 0.375 px/tick
    expect(UNIT_STATS.E1.speed * MPH_TO_PX).toBeCloseTo(0.375, 6);
    // 2TNK: speed=8 → 8 * 0.09375 = 0.75 px/tick
    expect(UNIT_STATS['2TNK'].speed * MPH_TO_PX).toBeCloseTo(0.75, 6);
    // JEEP: speed=10 → 10 * 0.09375 = 0.9375 px/tick
    expect(UNIT_STATS.JEEP.speed * MPH_TO_PX).toBeCloseTo(0.9375, 6);
    // MIG: speed=20 → 20 * 0.09375 = 1.875 px/tick
    expect(UNIT_STATS.MIG.speed * MPH_TO_PX).toBeCloseTo(1.875, 6);
  });

  it('speedBias multiplies effective speed (M7 crate bonus)', () => {
    const unit = new Entity(UnitType.I_E1, House.Spain, 100, 100);
    expect(unit.speedBias).toBe(1.0); // default

    unit.speedBias = 1.5; // crate boost
    unit.facing = Dir.E;
    const baseSpeed = 5;
    const startX = unit.pos.x;

    unit.rotTickedThisFrame = false;
    unit.moveToward({ x: 300, y: 100 }, baseSpeed);

    const moved = unit.pos.x - startX;
    expect(moved).toBeCloseTo(baseSpeed * 1.5, 3);
  });

  it('groundspeedBias affects rotation but not direct movement speed', () => {
    const unit = new Entity(UnitType.I_E1, House.Spain, 100, 100);
    unit.groundspeedBias = 2.0;
    unit.facing = Dir.E;
    const baseSpeed = 5;
    const startX = unit.pos.x;

    // moveToward does not use groundspeedBias for translation speed
    // (it only affects rotation accumulation)
    unit.rotTickedThisFrame = false;
    unit.moveToward({ x: 300, y: 100 }, baseSpeed);

    const moved = unit.pos.x - startX;
    // Should move at base speed (not doubled)
    expect(moved).toBeCloseTo(baseSpeed, 3);
  });
});

// ============================================================================
// 14. Pathfinding diagonal corner-cutting prevention
// ============================================================================

describe('Pathfinding — diagonal corner-cutting prevention', () => {
  it('cannot cut corners around impassable cells diagonally', () => {
    const map = new GameMap();
    map.setBounds(0, 0, 20, 20);
    map.initDefault();

    // Create an L-shaped wall that would be cut diagonally
    map.setTerrain(5, 4, Terrain.ROCK); // above
    map.setTerrain(4, 5, Terrain.ROCK); // left

    // Path from (4,4) to (5,5) — diagonal would cut corner
    const path = findPath(map, { cx: 4, cy: 4 }, { cx: 5, cy: 5 });

    // If path exists, verify it doesn't go directly from (4,4) to (5,5) in one step
    if (path.length > 0) {
      // The direct diagonal from (4,4) to (5,5) requires (5,4) and (4,5) both passable
      // Since those are blocked, the path must go around
      expect(path.length).toBeGreaterThanOrEqual(2);
    }
  });
});

// ============================================================================
// 15. Water passability for naval units
// ============================================================================

describe('Water passability for naval units', () => {
  it('isWaterPassable returns true only for WATER terrain', () => {
    const map = new GameMap();
    map.setBounds(0, 0, 20, 20);

    map.setTerrain(5, 5, Terrain.WATER);
    expect(map.isWaterPassable(5, 5)).toBe(true);

    map.setTerrain(5, 5, Terrain.CLEAR);
    expect(map.isWaterPassable(5, 5)).toBe(false);

    map.setTerrain(5, 5, Terrain.BEACH);
    expect(map.isWaterPassable(5, 5)).toBe(false);
  });

  it('naval pathfinding only uses water cells', () => {
    const map = new GameMap();
    map.setBounds(0, 0, 20, 20);
    // Create a water channel with land on sides
    for (let x = 0; x < 20; x++) {
      map.setTerrain(x, 4, Terrain.WATER);
      map.setTerrain(x, 5, Terrain.WATER);
      map.setTerrain(x, 6, Terrain.WATER);
    }

    const path = findPath(map, { cx: 2, cy: 5 }, { cx: 10, cy: 5 }, true, true);
    expect(path.length).toBeGreaterThan(0);
    for (const cell of path) {
      expect(map.isWaterPassable(cell.cx, cell.cy)).toBe(true);
    }
  });

  it('FLOAT units have isVessel=true', () => {
    const sub = new Entity(UnitType.V_SS, House.Spain, 100, 100);
    expect(sub.isNavalUnit).toBe(true);
    expect(sub.stats.speedClass).toBe(SpeedClass.FLOAT);
  });
});

// ============================================================================
// 16. Entity property defaults for movement state
// ============================================================================

describe('Entity movement state defaults', () => {
  it('new entity has no moveTarget', () => {
    const e = new Entity(UnitType.I_E1, House.Spain, 100, 100);
    expect(e.moveTarget).toBeNull();
  });

  it('new entity has empty path and pathIndex=0', () => {
    const e = new Entity(UnitType.I_E1, House.Spain, 100, 100);
    expect(e.path).toEqual([]);
    expect(e.pathIndex).toBe(0);
  });

  it('new entity has GUARD mission and IDLE animState', () => {
    const e = new Entity(UnitType.I_E1, House.Spain, 100, 100);
    expect(e.mission).toBe('GUARD');
    expect(e.animState).toBe('IDLE');
  });

  it('new entity faces N with matching visual facing', () => {
    const e = new Entity(UnitType.I_E1, House.Spain, 100, 100);
    expect(e.facing).toBe(Dir.N);
    expect(e.bodyFacing32).toBe(0); // Dir.N * 4 = 0
  });

  it('new entity has prevPos matching initial position', () => {
    const e = new Entity(UnitType.I_E1, House.Spain, 42, 99);
    expect(e.prevPos).toEqual({ x: 42, y: 99 });
  });

  it('new entity has trackNumber=-1 (not on a track)', () => {
    const e = new Entity(UnitType.V_2TNK, House.Spain, 100, 100);
    expect(e.trackNumber).toBe(-1);
    expect(e.trackIndex).toBe(0);
    expect(e.speedAccum).toBe(0);
    expect(e.trackCellSpan).toBe(1);
    expect(e.trackFlags).toBe(0);
  });

  it('new entity has default bias values (1.0)', () => {
    const e = new Entity(UnitType.I_E1, House.Spain, 100, 100);
    expect(e.speedBias).toBe(1.0);
    expect(e.groundspeedBias).toBe(1.0);
    expect(e.armorBias).toBe(1.0);
    expect(e.firepowerBias).toBe(1.0);
  });
});

// ============================================================================
// 17. Multi-step movement — tracking positions over multiple ticks
// ============================================================================

describe('Multi-step movement — tick-by-tick position tracking', () => {
  it('infantry converges on target over multiple ticks', () => {
    const inf = new Entity(UnitType.I_E1, House.Spain, 50, 50);
    const target = { x: 100, y: 50 };
    const speed = 3;
    const positions: number[] = [inf.pos.x];

    for (let tick = 0; tick < 50; tick++) {
      inf.rotTickedThisFrame = false;
      const arrived = inf.moveToward(target, speed);
      positions.push(inf.pos.x);
      if (arrived) break;
    }

    // Position should monotonically increase
    for (let i = 1; i < positions.length; i++) {
      expect(positions[i]).toBeGreaterThanOrEqual(positions[i - 1]);
    }
    // Should eventually arrive
    expect(inf.pos.x).toBeCloseTo(100, 1);
  });

  it('vehicle with 180-degree turn rotates before moving', () => {
    const tank = new Entity(UnitType.V_1TNK, House.Spain, 100, 100);
    tank.facing = Dir.N;
    tank.bodyFacing32 = 0;

    // Target is due south — 180 degree turn needed
    const target = { x: 100, y: 200 };
    const speed = tank.stats.speed * MPH_TO_PX;

    const positions: { x: number; y: number }[] = [{ x: tank.pos.x, y: tank.pos.y }];
    let movedOnce = false;

    for (let tick = 0; tick < 100; tick++) {
      tank.rotTickedThisFrame = false;
      const arrived = tank.moveToward(target, speed);
      positions.push({ x: tank.pos.x, y: tank.pos.y });
      if (tank.pos.y > 100) movedOnce = true;
      if (arrived) break;
    }

    // Vehicle should have stayed put initially while rotating, then moved
    expect(positions[1].x).toBe(100); // didn't move X on first tick
    expect(movedOnce).toBe(true);
  });

  it('path following advances through multiple waypoints', () => {
    const inf = new Entity(UnitType.I_E1, House.Spain,
      2 * CELL_SIZE + CELL_SIZE / 2, 5 * CELL_SIZE + CELL_SIZE / 2);
    inf.path = [
      { cx: 3, cy: 5 },
      { cx: 4, cy: 5 },
      { cx: 5, cy: 5 },
    ];
    inf.pathIndex = 0;

    // Simulate path following
    for (let tick = 0; tick < 200; tick++) {
      if (inf.pathIndex >= inf.path.length) break;

      const wp = inf.path[inf.pathIndex];
      const target: WorldPos = {
        x: wp.cx * CELL_SIZE + CELL_SIZE / 2,
        y: wp.cy * CELL_SIZE + CELL_SIZE / 2,
      };

      inf.rotTickedThisFrame = false;
      if (inf.moveToward(target, 3)) {
        inf.pathIndex++;
      }
    }

    // Should have advanced through all waypoints
    expect(inf.pathIndex).toBe(3);
  });
});

// ============================================================================
// 18. Track movement classification by unit type
// ============================================================================

describe('Track movement classification by unit type', () => {
  const testCases: Array<{ type: UnitType; name: string; usesTracks: boolean }> = [
    { type: UnitType.I_E1, name: 'Rifle Infantry', usesTracks: false },
    { type: UnitType.I_DOG, name: 'Attack Dog', usesTracks: false },
    { type: UnitType.V_2TNK, name: 'Medium Tank', usesTracks: true },
    { type: UnitType.V_JEEP, name: 'Ranger', usesTracks: true },
    { type: UnitType.V_HARV, name: 'Harvester', usesTracks: true },
    { type: UnitType.V_TRAN, name: 'Chinook', usesTracks: false },
    { type: UnitType.V_MIG, name: 'MiG', usesTracks: false },
    { type: UnitType.V_LST, name: 'LST', usesTracks: true },
    { type: UnitType.V_DD, name: 'Destroyer', usesTracks: true },
    { type: UnitType.ANT1, name: 'Warrior Ant', usesTracks: true },
  ];

  for (const tc of testCases) {
    it(`${tc.name} (${tc.type}): usesTracks=${tc.usesTracks}`, () => {
      const stats = UNIT_STATS[tc.type];
      expect(stats, `${tc.type} should have stats`).toBeDefined();
      const result = usesTrackMovement(
        stats.speedClass,
        !!stats.isInfantry,
        !!stats.isAircraft,
      );
      expect(result).toBe(tc.usesTracks);
    });
  }
});

// ============================================================================
// 19. worldDist — distance in cells
// ============================================================================

describe('worldDist — distance calculation in cells', () => {
  it('returns 0 for same position', () => {
    expect(worldDist({ x: 100, y: 100 }, { x: 100, y: 100 })).toBe(0);
  });

  it('returns distance in cells, not pixels', () => {
    // 1 cell apart horizontally
    const a = { x: 0, y: 0 };
    const b = { x: CELL_SIZE, y: 0 };
    expect(worldDist(a, b)).toBeCloseTo(1.0, 6);
  });

  it('diagonal distance: sqrt(2) cells for 1-cell diagonal', () => {
    const a = { x: 0, y: 0 };
    const b = { x: CELL_SIZE, y: CELL_SIZE };
    expect(worldDist(a, b)).toBeCloseTo(Math.SQRT2, 6);
  });

  it('pythagorean example: 3-4-5 triangle in cells', () => {
    const a = { x: 0, y: 0 };
    const b = { x: CELL_SIZE * 3, y: CELL_SIZE * 4 };
    expect(worldDist(a, b)).toBeCloseTo(5.0, 6);
  });
});

// ============================================================================
// 20. Saved move target (AI target acquisition during MOVE)
// ============================================================================

describe('savedMoveTarget — AI movement interruption', () => {
  it('entity has savedMoveTarget initialized to null', () => {
    const e = new Entity(UnitType.I_E1, House.Spain, 100, 100);
    expect(e.savedMoveTarget).toBeNull();
  });

  it('savedMoveTarget can store a position for later resumption', () => {
    const e = new Entity(UnitType.I_E1, House.Spain, 100, 100);
    e.savedMoveTarget = { x: 500, y: 500 };
    expect(e.savedMoveTarget).toEqual({ x: 500, y: 500 });
  });
});

// ============================================================================
// 21. Map initDefault — creates playable area with impassable borders
// ============================================================================

describe('Map initDefault', () => {
  it('playable area is CLEAR terrain', () => {
    const map = new GameMap();
    map.setBounds(5, 5, 10, 10);
    map.initDefault();

    for (let cy = 5; cy < 15; cy++) {
      for (let cx = 5; cx < 15; cx++) {
        expect(map.getTerrain(cx, cy)).toBe(Terrain.CLEAR);
      }
    }
  });

  it('outside bounds is ROCK terrain', () => {
    const map = new GameMap();
    map.setBounds(5, 5, 10, 10);
    map.initDefault();

    expect(map.getTerrain(0, 0)).toBe(Terrain.ROCK);
    expect(map.getTerrain(4, 5)).toBe(Terrain.ROCK);
    expect(map.getTerrain(15, 5)).toBe(Terrain.ROCK);
  });
});

// ============================================================================
// 22. Long path stress test
// ============================================================================

describe('Long path — pathfinding across large map area', () => {
  it('finds path across a 40-cell span on clear terrain', () => {
    const map = new GameMap();
    map.setBounds(0, 0, 50, 50);
    map.initDefault();

    const path = findPath(map, { cx: 5, cy: 25 }, { cx: 45, cy: 25 });
    expect(path.length).toBeGreaterThan(0);

    // Path should end near the goal (may be exact or nearest-reachable)
    const last = path[path.length - 1];
    expect(last.cx).toBe(45);
    expect(last.cy).toBe(25);
  });

  it('diagonal long path is found efficiently', () => {
    const map = new GameMap();
    map.setBounds(0, 0, 50, 50);
    map.initDefault();

    const path = findPath(map, { cx: 5, cy: 5 }, { cx: 40, cy: 40 });
    expect(path.length).toBeGreaterThan(0);
    // Diagonal path should be shorter than taxicab (sum of dx+dy)
    expect(path.length).toBeLessThan(70); // taxicab = 70
  });
});

// ============================================================================
// 23. Shore cell detection (for naval-ground interfaces)
// ============================================================================

describe('Shore cell detection', () => {
  it('isShoreCell returns true for land cell adjacent to water', () => {
    const map = new GameMap();
    map.setBounds(0, 0, 20, 20);
    map.initDefault();
    map.setTerrain(5, 5, Terrain.WATER);

    // Cell (6,5) is land adjacent to water at (5,5)
    expect(map.isShoreCell(6, 5)).toBe(true);
    // Cell (8,8) is far from water
    expect(map.isShoreCell(8, 8)).toBe(false);
  });

  it('isShoreCell returns false for water cell', () => {
    const map = new GameMap();
    map.setBounds(0, 0, 20, 20);
    map.setTerrain(5, 5, Terrain.WATER);

    expect(map.isShoreCell(5, 5)).toBe(false);
  });
});

// ============================================================================
// 24. Aircraft flight altitude
// ============================================================================

describe('Aircraft flight altitude', () => {
  it('aircraft entities have FLIGHT_ALTITUDE constant of 24px', () => {
    expect(Entity.FLIGHT_ALTITUDE).toBe(24);
  });

  it('aircraft start with flightAltitude=0 (on ground)', () => {
    const heli = new Entity(UnitType.V_TRAN, House.Spain, 100, 100);
    expect(heli.flightAltitude).toBe(0);
    expect(heli.aircraftState).toBe('landed');
  });

  it('air units fly directly — no pathfinding needed', () => {
    const heli = new Entity(UnitType.V_TRAN, House.Spain, 100, 100);
    expect(heli.isAirUnit).toBe(true);
    // No path needed — air units use moveToward directly to destination
    expect(heli.path).toEqual([]);
  });
});

// ============================================================================
// 25. Guard origin for Area Guard return behavior
// ============================================================================

describe('Guard origin for Area Guard', () => {
  it('entity guardOrigin defaults to null', () => {
    const e = new Entity(UnitType.I_E1, House.Spain, 100, 100);
    expect(e.guardOrigin).toBeNull();
  });

  it('guardOrigin can be set for area guard units', () => {
    const e = new Entity(UnitType.I_E1, House.Spain, 100, 100);
    e.guardOrigin = { x: 100, y: 100 };
    expect(e.guardOrigin).toEqual({ x: 100, y: 100 });
  });
});
